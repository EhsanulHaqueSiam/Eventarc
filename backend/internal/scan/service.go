package scan

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/model"
	"github.com/ehsanul-haque-siam/eventarc/internal/qr"
)

// Service handles entry scan processing with atomic Redis operations.
type Service struct {
	redis      *redis.Client
	pgPool     *pgxpool.Pool
	hmacSecret []byte
}

// NewService creates a new scan processing service.
func NewService(redisClient *redis.Client, pgPool *pgxpool.Pool, hmacSecret []byte) *Service {
	return &Service{
		redis:      redisClient,
		pgPool:     pgPool,
		hmacSecret: hmacSecret,
	}
}

// ProcessEntryScan is the main scan pipeline:
// 1. Decode QR payload (HMAC verification)
// 2. Validate QR type (must be entry or unified)
// 3. Lookup guest in Redis (HGETALL guest:{eventId}:{guestId})
// 4. If Redis miss: return model.ErrNotFound (PG fallback in Plan 04-02)
// 5. Execute Lua check-in script atomically
// 6. Return ScanResult with guest info + check-in details
func (s *Service) ProcessEntryScan(ctx context.Context, req ScanRequest) (ScanResult, error) {
	// Step 1: Decode and verify QR payload HMAC
	payload, err := qr.DecodePayload(req.QRPayload, s.hmacSecret)
	if err != nil {
		return ScanResult{}, err
	}

	// Step 2: Validate QR type — only entry and unified QR codes allowed at entry gates
	if payload.QRType != qr.QRTypeEntry && payload.QRType != qr.QRTypeUnified {
		return ScanResult{}, fmt.Errorf("%w: expected entry or unified, got %s", qr.ErrInvalidQRType, qr.QRTypeName(payload.QRType))
	}

	// Step 3: Lookup guest in Redis
	guestKey := fmt.Sprintf("guest:%s:%s", payload.EventID, payload.GuestID)
	guestData, err := s.redis.HGetAll(ctx, guestKey).Result()
	if err != nil {
		return ScanResult{}, fmt.Errorf("redis guest lookup failed: %w", err)
	}
	if len(guestData) == 0 {
		return ScanResult{}, model.ErrNotFound
	}

	guest := &GuestInfo{
		Name:     guestData["name"],
		Category: guestData["category"],
		PhotoURL: guestData["photoUrl"],
	}

	// Step 4: Execute atomic Lua check-in script
	checkedInKey := fmt.Sprintf("checkedin:%s", payload.EventID)
	checkInKey := fmt.Sprintf("checkin:%s:%s", payload.EventID, payload.GuestID)
	countersKey := fmt.Sprintf("counters:%s", payload.EventID)

	now := time.Now().UTC().Format(time.RFC3339)

	result, err := checkInScript.Run(ctx, s.redis,
		[]string{checkedInKey, checkInKey, countersKey},
		payload.GuestID, now, req.StallID, req.DeviceID, guest.Category,
	).Text()
	if err != nil {
		return ScanResult{}, fmt.Errorf("redis check-in script failed: %w", err)
	}

	// Step 5: Build response
	if result == "DUPLICATE" {
		details, detailErr := s.GetCheckInDetails(ctx, payload.EventID, payload.GuestID)
		if detailErr != nil {
			// Return duplicate status even if we can't fetch original details
			return ScanResult{
				Status:  "duplicate",
				Guest:   guest,
				Message: "Already checked in",
			}, nil
		}
		return ScanResult{
			Status: "duplicate",
			Guest:  guest,
			Original: &ScanInfo{
				CheckedInAt: details.Timestamp,
				StallID:     details.StallID,
				DeviceID:    details.DeviceID,
			},
			Message: "Already checked in",
		}, nil
	}

	// Valid new check-in
	return ScanResult{
		Status: "valid",
		Guest:  guest,
		Scan: &ScanInfo{
			CheckedInAt: now,
			StallID:     req.StallID,
			DeviceID:    req.DeviceID,
		},
	}, nil
}

// GetCheckInDetails retrieves the original check-in timestamp and location for
// duplicate responses.
func (s *Service) GetCheckInDetails(ctx context.Context, eventID, guestID string) (CheckInDetails, error) {
	checkInKey := fmt.Sprintf("checkin:%s:%s", eventID, guestID)
	data, err := s.redis.HGetAll(ctx, checkInKey).Result()
	if err != nil {
		return CheckInDetails{}, fmt.Errorf("redis check-in details lookup failed: %w", err)
	}
	if len(data) == 0 {
		return CheckInDetails{}, errors.New("check-in details not found")
	}
	return CheckInDetails{
		Timestamp: data["timestamp"],
		StallID:   data["stallId"],
		DeviceID:  data["deviceId"],
		Status:    data["status"],
	}, nil
}
