package scan

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"time"
)

// EventSyncRequest is the full event dataset payload pushed from Convex at go-live.
type EventSyncRequest struct {
	Type    string `json:"type"`
	EventID string `json:"event_id"`
	Event   struct {
		ID           string `json:"id"`
		Name         string `json:"name"`
		Status       string `json:"status"`
		QRStrategy   string `json:"qr_strategy"`
		FoodQRMode   string `json:"food_qr_mode"`
		FoodQRTiming string `json:"food_qr_timing"`
	} `json:"event"`
	GuestCategories []EventGuestCategorySync `json:"guest_categories"`
	FoodCategories  []EventFoodCategorySync  `json:"food_categories"`
	Stalls          []EventStallSync         `json:"stalls"`
	Guests          []EventGuestSync         `json:"guests"`
	Counters        struct {
		TotalInvited int64 `json:"total_invited"`
	} `json:"counters"`
}

// EventGuestCategorySync is guest-category metadata for cache preloading.
type EventGuestCategorySync struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// EventFoodCategorySync is food-category metadata for cache preloading.
type EventFoodCategorySync struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// EventStallSync is stall metadata for cache preloading.
type EventStallSync struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CategoryID string `json:"category_id"`
	IsActive   bool   `json:"is_active"`
}

// EventGuestSync is guest metadata for cache preloading.
type EventGuestSync struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	CategoryID    string `json:"category_id"`
	CategoryLabel string `json:"category_label"`
	Phone         string `json:"phone"`
	Status        string `json:"status"`
	PhotoURL      string `json:"photo_url"`
}

// SyncEventDataset performs a full dataset sync for a single event into Redis.
//
// It updates these keyspaces:
//   - event:{eventId}
//   - counters:{eventId}
//   - guest:{eventId}:{guestId}
//   - foodcategory:{eventId}:{foodCategoryId}
//   - stall:{eventId}:{stallId}
func (s *Service) SyncEventDataset(ctx context.Context, req EventSyncRequest) error {
	if req.EventID == "" {
		return fmt.Errorf("event sync: event_id is required")
	}

	totalInvited := req.Counters.TotalInvited
	if totalInvited <= 0 {
		totalInvited = int64(len(req.Guests))
	}

	if err := s.deleteByPattern(ctx, GuestPattern(req.EventID)); err != nil {
		return fmt.Errorf("event sync: clear guests: %w", err)
	}
	if err := s.deleteByPattern(ctx, StallPattern(req.EventID)); err != nil {
		return fmt.Errorf("event sync: clear stalls: %w", err)
	}
	if err := s.deleteByPattern(ctx, FoodCategoryPattern(req.EventID)); err != nil {
		return fmt.Errorf("event sync: clear food categories: %w", err)
	}

	eventKey := EventKey(req.EventID)
	countersKey := CountersKey(req.EventID)

	pipe := s.redis.Pipeline()
	pipe.HSet(ctx, eventKey, map[string]any{
		"id":           req.Event.ID,
		"name":         req.Event.Name,
		"status":       req.Event.Status,
		"qrStrategy":   req.Event.QRStrategy,
		"foodQrMode":   req.Event.FoodQRMode,
		"foodQrTiming": req.Event.FoodQRTiming,
		"syncedAt":     time.Now().UTC().Format(time.RFC3339),
	})
	pipe.HSet(ctx, countersKey, "total_invited", totalInvited)
	pipe.HSetNX(ctx, countersKey, "attendance", 0)
	pipe.HSetNX(ctx, countersKey, "scans_total", 0)
	pipe.HSetNX(ctx, countersKey, "scans_duplicate", 0)

	for _, guest := range req.Guests {
		guestKey := GuestKey(req.EventID, guest.ID)
		pipe.HSet(ctx, guestKey, map[string]any{
			"name":          guest.Name,
			"category":      guest.CategoryID,
			"categoryLabel": guest.CategoryLabel,
			"phone":         guest.Phone,
			"status":        guest.Status,
			"photoUrl":      guest.PhotoURL,
		})
	}

	for _, category := range req.FoodCategories {
		key := FoodCategoryKey(req.EventID, category.ID)
		pipe.HSet(ctx, key, map[string]any{"name": category.Name})
	}

	for _, stall := range req.Stalls {
		key := StallKey(req.EventID, stall.ID)
		pipe.HSet(ctx, key, map[string]any{
			"name":       stall.Name,
			"categoryId": stall.CategoryID,
			"isActive":   strconv.FormatBool(stall.IsActive),
		})
	}

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("event sync: pipeline exec: %w", err)
	}

	slog.Info("event dataset synced",
		"event_id", req.EventID,
		"guests", len(req.Guests),
		"stalls", len(req.Stalls),
		"food_categories", len(req.FoodCategories),
		"total_invited", totalInvited,
	)
	return nil
}

func (s *Service) deleteByPattern(ctx context.Context, pattern string) error {
	iter := s.redis.Scan(ctx, 0, pattern, 1000).Iterator()
	batch := make([]string, 0, 500)

	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		if err := s.redis.Del(ctx, batch...).Err(); err != nil {
			return err
		}
		batch = batch[:0]
		return nil
	}

	for iter.Next(ctx) {
		batch = append(batch, iter.Val())
		if len(batch) >= 500 {
			if err := flush(); err != nil {
				return err
			}
		}
	}

	if err := iter.Err(); err != nil {
		return err
	}
	return flush()
}
