package scan

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/ehsanul-haque-siam/eventarc/internal/model"
	"github.com/ehsanul-haque-siam/eventarc/internal/qr"
)

// ProcessFoodScan is the main food scan pipeline:
// 1. Decode QR payload (HMAC verification) via qr.DecodePayload
// 2. Validate QR type is QRTypeFood (0x02) or QRTypeUnified (0x03)
// 3. Determine food mode from event config (Redis: event:{eventId} -> foodQrMode field)
// 4. Resolve identity and guest category:
//   - Guest-linked: Redis HGET guest:{eventId}:{guestId} -> "category" field
//   - Anonymous: Redis HGET anontoken:{eventId}:{guestId} -> "category" field
//
// 5. Build Redis keys based on mode:
//   - Guest-linked: food:{eventId}:{guestId}
//   - Anonymous: food:{eventId}:anon:{guestId}
//
// 6. Execute foodScanLua atomically
// 7. Parse Lua result and build FoodScanResult
// 8. On rejection: read consumption log from Redis for history entries
func (s *Service) ProcessFoodScan(ctx context.Context, req FoodScanRequest) (FoodScanResult, error) {
	// Step 1: Decode and verify QR payload HMAC
	payload, err := qr.DecodePayload(req.QRPayload, s.hmacSecret)
	if err != nil {
		return FoodScanResult{}, err
	}

	// Step 2: Validate QR type -- only food and unified QR codes allowed at food stalls
	if payload.QRType != qr.QRTypeFood && payload.QRType != qr.QRTypeUnified {
		return FoodScanResult{}, fmt.Errorf("%w: expected food or unified QR, got %s", qr.ErrInvalidQRType, qr.QRTypeName(payload.QRType))
	}
	if req.SessionEventID != "" && req.SessionEventID != payload.EventID {
		return FoodScanResult{}, ErrSessionScopeMismatch
	}

	if err := s.ensureFoodCountersRecovered(ctx, payload.EventID); err != nil {
		return FoodScanResult{}, err
	}

	// Step 3: Determine food mode from event config
	foodQrMode, err := s.redis.HGet(ctx, EventKey(payload.EventID), "foodQrMode").Result()
	if err != nil {
		return FoodScanResult{}, fmt.Errorf("event config not synced (foodQrMode missing): %w", err)
	}

	// Step 4: Resolve identity and guest category based on mode
	var guestCategoryID string
	var guest *GuestInfo
	var consumptionKey string
	var logKey string

	if foodQrMode == "anonymous" {
		// Anonymous mode: lookup token metadata
		tokenKey := AnonTokenKey(payload.EventID, payload.GuestID)
		tokenData, tokenErr := s.redis.HGetAll(ctx, tokenKey).Result()
		if tokenErr != nil {
			return FoodScanResult{}, fmt.Errorf("redis anonymous token lookup failed: %w", tokenErr)
		}
		if len(tokenData) == 0 {
			return FoodScanResult{}, model.ErrNotFound
		}
		guestCategoryID = tokenData["category"]

		// Anonymous consumption key
		consumptionKey = AnonFoodConsumptionKey(payload.EventID, payload.GuestID)
		logKey = AnonFoodLogKey(payload.EventID, payload.GuestID)
	} else {
		// Guest-linked mode (default)
		guestKey := GuestKey(payload.EventID, payload.GuestID)
		guestData, guestErr := s.redis.HGetAll(ctx, guestKey).Result()
		if guestErr != nil {
			return FoodScanResult{}, fmt.Errorf("redis guest lookup failed: %w", guestErr)
		}
		if len(guestData) == 0 {
			return FoodScanResult{}, model.ErrNotFound
		}
		guestCategoryID = guestData["category"]
		guest = &GuestInfo{
			Name:     guestData["name"],
			Category: guestData["categoryLabel"],
		}

		// Guest-linked consumption key
		consumptionKey = FoodConsumptionKey(payload.EventID, payload.GuestID)
		logKey = FoodLogKey(payload.EventID, payload.GuestID)
	}

	// Step 5: Build Redis keys
	rulesKey := FoodRulesKey(payload.EventID)
	countersKey := CountersKey(payload.EventID)

	// Get stall name for log entry
	stallName := s.GetStallName(ctx, payload.EventID, req.StallID)

	// Step 6: Execute Lua script atomically
	now := time.Now().UTC().Format(time.RFC3339)
	result, err := foodScanScript.Run(ctx, s.redis,
		[]string{consumptionKey, rulesKey, countersKey, logKey},
		guestCategoryID, req.FoodCategoryID, req.StallID, now, req.DeviceID, stallName,
	).StringSlice()
	if err != nil {
		return FoodScanResult{}, fmt.Errorf("redis food scan script failed: %w", err)
	}

	// Step 7: Parse result
	foodCatInfo := &FoodCategoryInfo{
		ID:   req.FoodCategoryID,
		Name: s.GetFoodCategoryName(ctx, payload.EventID, req.FoodCategoryID),
	}

	scanInfo := &ScanInfo{
		CheckedInAt: now,
		StallID:     req.StallID,
		DeviceID:    req.DeviceID,
	}

	switch result[0] {
	case "NO_RULE":
		s.publishCounterUpdate(ctx, payload.EventID, "scans_total")
		return FoodScanResult{}, fmt.Errorf("%w: no food rule configured for category %s and food %s",
			model.ErrNotFound, guestCategoryID, req.FoodCategoryID)

	case "LIMIT_REACHED":
		s.publishCounterUpdate(ctx, payload.EventID, "scans_total", "scans_duplicate")
		current, _ := strconv.Atoi(result[1])
		limit, _ := strconv.Atoi(result[2])

		// Step 8: Read consumption history on rejection
		history := s.readConsumptionHistory(ctx, logKey)

		return FoodScanResult{
			Status:       "limit_reached",
			FoodCategory: foodCatInfo,
			Consumption: &ConsumptionInfo{
				Current:   current,
				Limit:     limit,
				Remaining: 0,
			},
			Guest:   guest,
			Message: fmt.Sprintf("%s limit reached (%d/%d)", foodCatInfo.Name, current, limit),
			History: history,
		}, nil

	case "OK":
		s.publishCounterUpdate(
			ctx,
			payload.EventID,
			"scans_total",
			fmt.Sprintf("food:%s:served", req.FoodCategoryID),
			fmt.Sprintf("stall:%s:served", req.StallID),
		)
		current, _ := strconv.Atoi(result[1])
		limit, _ := strconv.Atoi(result[2])

		remaining := -1
		if limit >= 0 {
			remaining = limit - current
		}

		idempotencyKey := fmt.Sprintf(
			"food:%s:%s:%s:%d",
			payload.EventID,
			payload.GuestID,
			req.FoodCategoryID,
			current,
		)

		// Persist accepted scans durably (asynq first, then direct fallback).
		isAnonymous := foodQrMode == "anonymous"
		pgPayload := FoodScanPGPayload{
			IdempotencyKey:   idempotencyKey,
			EventID:          payload.EventID,
			GuestID:          payload.GuestID,
			FoodCategoryID:   req.FoodCategoryID,
			StallID:          req.StallID,
			ScannedAt:        now,
			DeviceID:         req.DeviceID,
			GuestCategory:    guestCategoryID,
			IsAnonymous:      isAnonymous,
			ConsumptionCount: current,
			Status:           "valid",
		}
		convexPayload := FoodScanConvexPayload{
			IdempotencyKey:   idempotencyKey,
			EventID:          payload.EventID,
			GuestID:          payload.GuestID,
			FoodCategoryID:   req.FoodCategoryID,
			StallID:          req.StallID,
			ScannedAt:        now,
			DeviceID:         req.DeviceID,
			GuestCategory:    guestCategoryID,
			IsAnonymous:      isAnonymous,
			ConsumptionCount: current,
			Status:           "valid",
		}
		if err := s.persistFoodScanDurably(ctx, pgPayload, convexPayload); err != nil {
			return FoodScanResult{}, err
		}

		return FoodScanResult{
			Status:       "valid",
			FoodCategory: foodCatInfo,
			Consumption: &ConsumptionInfo{
				Current:   current,
				Limit:     limit,
				Remaining: remaining,
			},
			Guest: guest,
			Scan:  scanInfo,
		}, nil

	default:
		return FoodScanResult{}, fmt.Errorf("unexpected Lua script result: %s", result[0])
	}
}

// readConsumptionHistory reads the last 10 entries from the food consumption log.
// Each entry is pipe-delimited: "timestamp|stallId|stallName"
func (s *Service) readConsumptionHistory(ctx context.Context, logKey string) []HistoryEntry {
	entries, err := s.redis.LRange(ctx, logKey, 0, 9).Result()
	if err != nil || len(entries) == 0 {
		return nil
	}

	history := make([]HistoryEntry, 0, len(entries))
	for _, entry := range entries {
		parts := strings.SplitN(entry, "|", 3)
		if len(parts) != 3 {
			continue
		}
		history = append(history, HistoryEntry{
			ConsumedAt: parts[0],
			StallID:    parts[1],
			StallName:  parts[2],
		})
	}
	return history
}

// GetStallName retrieves human-readable stall name from Redis cache.
// Key: stall:{eventId}:{stallId} -> "name" field.
// Falls back to stallID if not cached.
func (s *Service) GetStallName(ctx context.Context, eventID, stallID string) string {
	key := StallKey(eventID, stallID)
	name, err := s.redis.HGet(ctx, key, "name").Result()
	if err != nil || name == "" {
		return stallID
	}
	return name
}

// GetFoodCategoryName retrieves human-readable food category name from Redis cache.
// Key: foodcategory:{eventId}:{categoryId} -> "name" field.
// Falls back to categoryID if not cached.
func (s *Service) GetFoodCategoryName(ctx context.Context, eventID, categoryID string) string {
	key := FoodCategoryKey(eventID, categoryID)
	name, err := s.redis.HGet(ctx, key, "name").Result()
	if err != nil || name == "" {
		return categoryID
	}
	return name
}
