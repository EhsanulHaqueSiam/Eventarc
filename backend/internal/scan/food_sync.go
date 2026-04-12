package scan

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/redis/go-redis/v9"
)

// FoodRuleSync represents a single food rule from Convex for Redis sync.
type FoodRuleSync struct {
	GuestCategoryID string `json:"guest_category_id"`
	FoodCategoryID  string `json:"food_category_id"`
	Limit           int    `json:"limit"`
}

// AnonTokenSync represents an anonymous token from Convex for Redis sync.
type AnonTokenSync struct {
	TokenID         string `json:"token_id"`
	GuestCategoryID string `json:"guest_category_id"`
}

// SyncFoodRules receives food rules from Convex and writes to Redis.
// Called by the sync endpoint when it receives a "food_rules" type payload.
//
// Redis writes:
//
//	DEL foodrules:{eventId}  (clean slate — full replace)
//	HSET foodrules:{eventId} {guestCategoryId}:{foodCategoryId} {limit}
//	for each rule in the payload
func (s *Service) SyncFoodRules(ctx context.Context, eventID string, rules []FoodRuleSync) error {
	key := fmt.Sprintf("foodrules:%s", eventID)

	// Delete existing rules (clean slate on full sync)
	if err := s.redis.Del(ctx, key).Err(); err != nil {
		return fmt.Errorf("food rules sync: del existing: %w", err)
	}

	if len(rules) == 0 {
		slog.Info("food rules synced (empty)", "event_id", eventID)
		return nil
	}

	// Use pipeline for batch writes
	pipe := s.redis.Pipeline()
	for _, rule := range rules {
		field := fmt.Sprintf("%s:%s", rule.GuestCategoryID, rule.FoodCategoryID)
		pipe.HSet(ctx, key, field, rule.Limit)
	}
	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("food rules sync: pipeline exec: %w", err)
	}

	slog.Info("food rules synced", "event_id", eventID, "rule_count", len(rules))
	return nil
}

// SyncAnonymousTokens receives anonymous token metadata from Convex and writes to Redis.
// Called during go-live sync when event uses anonymous food mode.
//
// Redis writes:
//
//	HSET anontoken:{eventId}:{tokenId} category {guestCategoryId}
func (s *Service) SyncAnonymousTokens(ctx context.Context, eventID string, tokens []AnonTokenSync) error {
	if len(tokens) == 0 {
		slog.Info("anonymous tokens synced (empty)", "event_id", eventID)
		return nil
	}

	pipe := s.redis.Pipeline()
	for _, token := range tokens {
		key := fmt.Sprintf("anontoken:%s:%s", eventID, token.TokenID)
		pipe.HSet(ctx, key, "category", token.GuestCategoryID)
	}
	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("anonymous tokens sync: pipeline exec: %w", err)
	}

	slog.Info("anonymous tokens synced", "event_id", eventID, "token_count", len(tokens))
	return nil
}

// SyncFoodRulesHandler is the HTTP-compatible entry point for food rules sync.
// Wraps SyncFoodRules with request parsing.
type FoodRulesSyncRequest struct {
	Type    string         `json:"type"`
	EventID string         `json:"event_id"`
	Rules   []FoodRuleSync `json:"rules"`
}

// AnonTokensSyncRequest is the request body for anonymous token sync.
type AnonTokensSyncRequest struct {
	Type    string          `json:"type"`
	EventID string          `json:"event_id"`
	Tokens  []AnonTokenSync `json:"tokens"`
}

// Ensure redis is used (avoid unused import with interface satisfaction)
var _ redis.Cmdable = (*redis.Client)(nil)
