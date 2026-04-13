package scan

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/convexsync"
	"github.com/ehsanul-haque-siam/eventarc/internal/model"
	"github.com/ehsanul-haque-siam/eventarc/internal/qr"
)

// Service handles entry scan processing with atomic Redis operations.
type Service struct {
	redis        *redis.Client
	pgPool       *pgxpool.Pool
	pgStore      *PGStore
	asynqClient  *asynq.Client
	convexClient *convexsync.Client
	hmacSecret   []byte
}

// NewService creates a new scan processing service.
func NewService(redisClient *redis.Client, pgPool *pgxpool.Pool, hmacSecret []byte) *Service {
	var pgStore *PGStore
	if pgPool != nil {
		pgStore = NewPGStore(pgPool)
	}
	return &Service{
		redis:      redisClient,
		pgPool:     pgPool,
		pgStore:    pgStore,
		hmacSecret: hmacSecret,
	}
}

// SetAsynqClient configures the asynq client for background task enqueueing.
func (s *Service) SetAsynqClient(client *asynq.Client) {
	s.asynqClient = client
}

// SetConvexClient configures the Convex client for direct sync fallback.
func (s *Service) SetConvexClient(client *convexsync.Client) {
	s.convexClient = client
}

// ProcessEntryScan is the main scan pipeline:
// 1. Decode QR payload (HMAC verification)
// 2. Validate QR type (must be entry or unified)
// 3. Lookup guest in Redis (HGETALL guest:{eventId}:{guestId})
// 4. If Redis miss: fallback to PG check-in metadata when available
// 5. Execute Lua check-in script atomically
// 6. Return ScanResult with guest info + latest scan details
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
	if req.SessionEventID != "" && req.SessionEventID != payload.EventID {
		return ScanResult{}, ErrSessionScopeMismatch
	}

	if err := s.ensureEntryCountersRecovered(ctx, payload.EventID); err != nil {
		return ScanResult{}, err
	}

	// Step 3: Lookup guest in Redis
	guestKey := GuestKey(payload.EventID, payload.GuestID)
	guestData, err := s.redis.HGetAll(ctx, guestKey).Result()
	if err != nil {
		return ScanResult{}, fmt.Errorf("redis guest lookup failed: %w", err)
	}
	guest := &GuestInfo{}
	guestCategory := ""
	if len(guestData) == 0 {
		// PG fallback: if the guest was already scanned before, allow re-entry
		// and preserve counter consistency even if the guest profile hash is missing.
		if s.pgStore == nil {
			return ScanResult{}, model.ErrNotFound
		}
		existing, pgErr := s.pgStore.GetExistingCheckIn(ctx, payload.EventID, payload.GuestID)
		if pgErr != nil {
			return ScanResult{}, fmt.Errorf("pg existing check-in lookup failed: %w", pgErr)
		}
		if existing == nil {
			return ScanResult{}, model.ErrNotFound
		}
		guest.Name = "Guest"
		guest.Category = existing.GuestCategory
		guest.PhotoURL = ""
		guestCategory = existing.GuestCategory
	} else {
		guest.Name = guestData["name"]
		guest.Category = guestData["category"]
		guest.PhotoURL = guestData["photoUrl"]
		guestCategory = guestData["category"]
	}

	// Step 4: Execute atomic Lua check-in script
	checkedInKey := CheckedInKey(payload.EventID)
	checkInKey := CheckInKey(payload.EventID, payload.GuestID)
	countersKey := CountersKey(payload.EventID)

	now := time.Now().UTC().Format(time.RFC3339)

	result, err := checkInScript.Run(ctx, s.redis,
		[]string{checkedInKey, checkInKey, countersKey},
		payload.GuestID, now, req.StallID, req.DeviceID, guestCategory,
	).Text()
	if err != nil {
		return ScanResult{}, fmt.Errorf("redis check-in script failed: %w", err)
	}
	if result != "OK" {
		return ScanResult{}, fmt.Errorf("unexpected redis check-in result: %s", result)
	}

	counterKeys := []string{"attendance", "scans_total", "scans_reentry"}
	if guestCategory != "" {
		counterKeys = append(counterKeys, guestCategory+":checkedin")
	}
	s.publishCounterUpdate(ctx, payload.EventID, counterKeys...)

	if err := s.persistEntryScanDurably(ctx,
		PGWritePayload{
			EventID:       payload.EventID,
			GuestID:       payload.GuestID,
			StallID:       req.StallID,
			DeviceID:      req.DeviceID,
			ScannedAt:     now,
			GuestCategory: guestCategory,
			Status:        "valid",
		},
		ConvexSyncPayload{
			EventID:   payload.EventID,
			GuestID:   payload.GuestID,
			Status:    "valid",
			ScannedAt: now,
		},
	); err != nil {
		return ScanResult{}, err
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
	checkInKey := CheckInKey(eventID, guestID)
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
