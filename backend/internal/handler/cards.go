package handler

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
)

// Asynq task type constants for card compositing pipeline.
const (
	TypeCardCompositeBatch  = "card:composite:batch"
	TypeCardCompositeSingle = "card:composite:single"
)

// CardCompositeBatchPayload is the payload for the batch orchestrator task.
type CardCompositeBatchPayload struct {
	EventID            string        `json:"eventId"`
	BackgroundImageKey string        `json:"backgroundImageKey"`
	OverlayConfig      OverlayParam  `json:"overlayConfig"`
}

// OverlayParam represents the QR overlay position/size from the request.
type OverlayParam struct {
	Left   int `json:"left"`
	Top    int `json:"top"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

// CompositeRequest is the JSON body for triggering card compositing.
type CompositeRequest struct {
	TemplateID         string       `json:"templateId"`
	BackgroundImageKey string       `json:"backgroundImageKey"`
	QROverlay          OverlayParam `json:"qrOverlay"`
}

// CompositeProgressResponse is the JSON response for compositing progress.
type CompositeProgressResponse struct {
	Total  int64 `json:"total"`
	Done   int64 `json:"done"`
	Failed int64 `json:"failed"`
}

// CardHandler handles HTTP endpoints for card template management and
// compositing pipeline control.
type CardHandler struct {
	asynqClient TaskEnqueuer
	redisClient *redis.Client
	logger      *slog.Logger
}

// NewCardHandler creates a CardHandler for HTTP request processing.
func NewCardHandler(asynqClient TaskEnqueuer, redisClient *redis.Client) *CardHandler {
	return &CardHandler{
		asynqClient: asynqClient,
		redisClient: redisClient,
		logger:      slog.Default(),
	}
}

// compositeProgressKey returns the Redis key prefix for tracking compositing progress.
func compositeProgressKey(eventID, field string) string {
	return fmt.Sprintf("composite:%s:%s", eventID, field)
}

// HandleCompositeCards handles POST /api/v1/events/{eventId}/cards/composite.
// It validates the request, initializes Redis progress counters, enqueues an
// asynq batch compositing task, and returns 202 Accepted.
func (h *CardHandler) HandleCompositeCards(w http.ResponseWriter, r *http.Request) {
	eventID := chi.URLParam(r, "eventId")
	if eventID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "eventId is required")
		return
	}

	var req CompositeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON body")
		return
	}

	// Validate overlay position bounds (T-08-02 mitigation)
	if req.QROverlay.Left < 0 || req.QROverlay.Top < 0 ||
		req.QROverlay.Width <= 0 || req.QROverlay.Height <= 0 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR",
			"qrOverlay requires: left >= 0, top >= 0, width > 0, height > 0")
		return
	}

	if req.BackgroundImageKey == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "backgroundImageKey is required")
		return
	}

	// Rate limit: only 1 active batch per event (T-08-04 mitigation)
	existing, _ := h.redisClient.Get(r.Context(), compositeProgressKey(eventID, "total")).Result()
	if existing != "" && existing != "0" {
		// Check if batch is still running (done < total)
		done, _ := h.redisClient.Get(r.Context(), compositeProgressKey(eventID, "done")).Result()
		total, _ := strconv.ParseInt(existing, 10, 64)
		doneCount, _ := strconv.ParseInt(done, 10, 64)
		if doneCount < total {
			writeError(w, http.StatusConflict, "BATCH_IN_PROGRESS",
				"A compositing batch is already running for this event")
			return
		}
	}

	// Initialize Redis progress counters
	ctx := r.Context()
	pipe := h.redisClient.Pipeline()
	pipe.Set(ctx, compositeProgressKey(eventID, "total"), 0, 0)
	pipe.Set(ctx, compositeProgressKey(eventID, "done"), 0, 0)
	pipe.Set(ctx, compositeProgressKey(eventID, "failed"), 0, 0)
	if _, err := pipe.Exec(ctx); err != nil {
		h.logger.Error("failed to initialize composite progress", "eventId", eventID, "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to initialize progress")
		return
	}

	// Create and enqueue batch task
	payload := CardCompositeBatchPayload{
		EventID:            eventID,
		BackgroundImageKey: req.BackgroundImageKey,
		OverlayConfig:      req.QROverlay,
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		h.logger.Error("failed to marshal composite batch payload", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create task")
		return
	}

	task := asynq.NewTask(TypeCardCompositeBatch, payloadBytes, asynq.MaxRetry(3), asynq.Queue("critical"))
	if _, err := h.asynqClient.Enqueue(task); err != nil {
		h.logger.Error("failed to enqueue composite batch", "eventId", eventID, "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to enqueue compositing task")
		return
	}

	h.logger.Info("card compositing triggered", "eventId", eventID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{
		"status": "queued",
	})
}

// HandleCompositeProgress handles GET /api/v1/events/{eventId}/cards/progress.
// It reads compositing progress from Redis and returns it as JSON.
func (h *CardHandler) HandleCompositeProgress(w http.ResponseWriter, r *http.Request) {
	eventID := chi.URLParam(r, "eventId")
	if eventID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "eventId is required")
		return
	}

	ctx := r.Context()
	totalStr, _ := h.redisClient.Get(ctx, compositeProgressKey(eventID, "total")).Result()
	doneStr, _ := h.redisClient.Get(ctx, compositeProgressKey(eventID, "done")).Result()
	failedStr, _ := h.redisClient.Get(ctx, compositeProgressKey(eventID, "failed")).Result()

	total, _ := strconv.ParseInt(totalStr, 10, 64)
	done, _ := strconv.ParseInt(doneStr, 10, 64)
	failed, _ := strconv.ParseInt(failedStr, 10, 64)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(CompositeProgressResponse{
		Total:  total,
		Done:   done,
		Failed: failed,
	})
}
