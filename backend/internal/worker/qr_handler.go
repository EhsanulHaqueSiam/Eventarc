package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"

	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/qr"
	"github.com/ehsanul-haque-siam/eventarc/internal/r2"
)

// QRHandler processes asynq tasks for QR code generation. It coordinates
// between the QR image generator, R2 storage client, and Redis for progress
// tracking.
type QRHandler struct {
	r2Client    *r2.Client
	redisClient *redis.Client
	asynqClient *asynq.Client
	hmacSecret  []byte
	qrConfig    qr.GeneratorConfig
	logger      *slog.Logger
}

// NewQRHandler creates a QRHandler with all required dependencies.
func NewQRHandler(r2Client *r2.Client, redisClient *redis.Client, asynqClient *asynq.Client, hmacSecret string, logger *slog.Logger) *QRHandler {
	return &QRHandler{
		r2Client:    r2Client,
		redisClient: redisClient,
		asynqClient: asynqClient,
		hmacSecret:  []byte(hmacSecret),
		qrConfig:    qr.DefaultGeneratorConfig(),
		logger:      logger,
	}
}

// HandleGenerateBatch processes a batch QR generation task. It initializes
// Redis progress tracking and fans out individual generation tasks for each
// guest in the event.
func (h *QRHandler) HandleGenerateBatch(ctx context.Context, task *asynq.Task) error {
	var payload GenerateBatchPayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		return fmt.Errorf("worker: unmarshal batch payload: %w", err)
	}

	h.logger.Info("starting batch QR generation",
		"eventId", payload.EventID,
		"qrStrategy", payload.QRStrategy,
		"foodQrMode", payload.FoodQRMode,
	)

	// Determine which QR types to generate based on event config
	qrTypes := qr.DetermineQRTypes(payload.QRStrategy, payload.FoodQRMode)

	// Fetch guest list for this event
	// Phase 3 stub: uses a placeholder that returns guest IDs.
	// Full integration with Convex HTTP endpoint wires up in Phase 4.
	guestIDs := h.fetchGuestIDs(ctx, payload.EventID)
	if len(guestIDs) == 0 {
		h.logger.Warn("no guests found for event, marking complete", "eventId", payload.EventID)
		progressKey := ProgressKey(payload.EventID)
		h.redisClient.HSet(ctx, progressKey, map[string]interface{}{
			"total":     0,
			"completed": 0,
			"failed":    0,
			"status":    "complete",
		})
		return nil
	}

	// Initialize Redis progress tracking
	progressKey := ProgressKey(payload.EventID)
	h.redisClient.HSet(ctx, progressKey, map[string]interface{}{
		"total":     len(guestIDs),
		"completed": 0,
		"failed":    0,
		"status":    "running",
	})

	// Fan out: enqueue individual generation tasks for each guest
	for _, guestID := range guestIDs {
		singleTask, err := NewGenerateSingleTask(GenerateSinglePayload{
			EventID: payload.EventID,
			GuestID: guestID,
			QRTypes: qrTypes,
		})
		if err != nil {
			h.logger.Error("failed to create single task", "guestId", guestID, "error", err)
			continue
		}
		if _, err := h.asynqClient.Enqueue(singleTask); err != nil {
			h.logger.Error("failed to enqueue single task", "guestId", guestID, "error", err)
		}
	}

	h.logger.Info("batch fan-out complete",
		"eventId", payload.EventID,
		"guestCount", len(guestIDs),
		"qrTypes", len(qrTypes),
	)

	return nil
}

// HandleGenerateSingle processes a single guest QR generation task. It
// generates QR code images, uploads them to R2, and updates Redis progress.
func (h *QRHandler) HandleGenerateSingle(ctx context.Context, task *asynq.Task) error {
	var payload GenerateSinglePayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		return fmt.Errorf("worker: unmarshal single payload: %w", err)
	}

	// Generate QR code images for all requested types
	images, err := qr.GenerateGuestQRCodes(payload.EventID, payload.GuestID, payload.QRTypes, h.hmacSecret, h.qrConfig)
	if err != nil {
		h.redisClient.HIncrBy(ctx, ProgressKey(payload.EventID), "failed", 1)
		return fmt.Errorf("worker: generate QR codes for guest %s: %w", payload.GuestID, err)
	}

	// Upload each QR image to R2
	for qrType, imgBytes := range images {
		key := r2.BuildKey(payload.EventID, payload.GuestID, qrType)
		if err := h.r2Client.Upload(ctx, key, imgBytes, "image/png"); err != nil {
			h.redisClient.HIncrBy(ctx, ProgressKey(payload.EventID), "failed", 1)
			return fmt.Errorf("worker: upload QR to R2 for guest %s type %s: %w",
				payload.GuestID, qr.QRTypeName(qrType), err)
		}

		url := h.r2Client.PublicURL(key)
		h.logger.Info("QR uploaded",
			"eventId", payload.EventID,
			"guestId", payload.GuestID,
			"type", qr.QRTypeName(qrType),
			"url", url,
		)
	}

	// Increment completed counter
	h.redisClient.HIncrBy(ctx, ProgressKey(payload.EventID), "completed", 1)

	// Check if all guests are done and update status
	h.checkAndFinalizeProgress(ctx, payload.EventID)

	return nil
}

// GetProgress reads QR generation progress from Redis for the given event.
func (h *QRHandler) GetProgress(ctx context.Context, eventID string) (QRProgressInfo, error) {
	result, err := h.redisClient.HGetAll(ctx, ProgressKey(eventID)).Result()
	if err != nil {
		return QRProgressInfo{}, fmt.Errorf("worker: get progress for event %s: %w", eventID, err)
	}

	if len(result) == 0 {
		return QRProgressInfo{}, nil
	}

	info := QRProgressInfo{
		Status: result["status"],
	}

	if v, err := strconv.ParseInt(result["total"], 10, 64); err == nil {
		info.Total = v
	}
	if v, err := strconv.ParseInt(result["completed"], 10, 64); err == nil {
		info.Completed = v
	}
	if v, err := strconv.ParseInt(result["failed"], 10, 64); err == nil {
		info.Failed = v
	}

	return info, nil
}

// checkAndFinalizeProgress checks if all guests have been processed and
// marks the job as complete if so.
func (h *QRHandler) checkAndFinalizeProgress(ctx context.Context, eventID string) {
	progress, err := h.GetProgress(ctx, eventID)
	if err != nil {
		h.logger.Error("failed to check progress", "eventId", eventID, "error", err)
		return
	}

	if progress.Total > 0 && progress.Completed+progress.Failed >= progress.Total {
		status := "complete"
		if progress.Failed > 0 {
			status = "failed"
		}
		h.redisClient.HSet(ctx, ProgressKey(eventID), "status", status)
		h.logger.Info("QR generation finalized",
			"eventId", eventID,
			"completed", progress.Completed,
			"failed", progress.Failed,
			"status", status,
		)
	}
}

// fetchGuestIDs retrieves the list of guest IDs for the given event.
// Phase 3 stub: returns empty — real implementation will call Convex HTTP
// endpoint in Phase 4 integration.
func (h *QRHandler) fetchGuestIDs(_ context.Context, eventID string) []string {
	// TODO (Phase 4): Call Convex HTTP endpoint to fetch guest IDs
	// e.g., GET {CONVEX_SITE_URL}/api/guests?eventId={eventID}
	h.logger.Info("fetchGuestIDs stub called", "eventId", eventID)
	return []string{}
}
