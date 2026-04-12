package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/model"
	"github.com/ehsanul-haque-siam/eventarc/internal/worker"
)

// TaskEnqueuer abstracts asynq task enqueueing for testability.
type TaskEnqueuer interface {
	Enqueue(task *asynq.Task, opts ...asynq.Option) (*asynq.TaskInfo, error)
}

// QRHandler handles HTTP endpoints for QR code generation triggering
// and progress tracking.
type QRHandler struct {
	enqueuer    TaskEnqueuer
	redisClient *redis.Client
	logger      *slog.Logger
}

// NewQRHandler creates a QRHandler for HTTP request processing.
func NewQRHandler(enqueuer TaskEnqueuer, redisClient *redis.Client, logger *slog.Logger) *QRHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &QRHandler{
		enqueuer:    enqueuer,
		redisClient: redisClient,
		logger:      logger,
	}
}

// TriggerRequest represents the JSON body for triggering QR generation.
type TriggerRequest struct {
	EventID      string `json:"eventId"`
	QRStrategy   string `json:"qrStrategy"`
	FoodQRMode   string `json:"foodQrMode"`
	FoodQRTiming string `json:"foodQrTiming"`
}

// TriggerResponse is the JSON response after successfully queueing a generation job.
type TriggerResponse struct {
	JobID   string `json:"jobId"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

// ProgressResponse is the JSON response for QR generation progress.
type ProgressResponse struct {
	EventID         string  `json:"eventId"`
	Total           int64   `json:"total"`
	Completed       int64   `json:"completed"`
	Failed          int64   `json:"failed"`
	Status          string  `json:"status"`
	PercentComplete float64 `json:"percentComplete"`
}

// HandleTriggerGeneration handles POST /api/v1/qr/generate.
// It validates the request, enqueues a batch QR generation task,
// initializes Redis progress, and returns 202 Accepted.
func (h *QRHandler) HandleTriggerGeneration(w http.ResponseWriter, r *http.Request) {
	var req TriggerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON body")
		return
	}

	// Validate required fields
	if req.EventID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "eventId is required")
		return
	}
	if req.QRStrategy != "unified" && req.QRStrategy != "separate" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "qrStrategy must be 'unified' or 'separate'")
		return
	}
	if req.FoodQRMode != "guestLinked" && req.FoodQRMode != "anonymous" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "foodQrMode must be 'guestLinked' or 'anonymous'")
		return
	}
	if req.FoodQRTiming != "preSent" && req.FoodQRTiming != "postEntry" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "foodQrTiming must be 'preSent' or 'postEntry'")
		return
	}

	// Create batch task
	task, err := worker.NewGenerateBatchTask(worker.GenerateBatchPayload{
		EventID:      req.EventID,
		QRStrategy:   req.QRStrategy,
		FoodQRMode:   req.FoodQRMode,
		FoodQRTiming: req.FoodQRTiming,
	})
	if err != nil {
		h.logger.Error("failed to create batch task", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create generation task")
		return
	}

	// Enqueue the batch task
	info, err := h.enqueuer.Enqueue(task)
	if err != nil {
		h.logger.Error("failed to enqueue batch task", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to enqueue generation task")
		return
	}

	// Initialize progress in Redis
	progressKey := worker.ProgressKey(req.EventID)
	h.redisClient.HSet(r.Context(), progressKey, map[string]interface{}{
		"total":     0, // Updated by batch handler when guest count is known
		"completed": 0,
		"failed":    0,
		"status":    "pending",
	})

	h.logger.Info("QR generation triggered",
		"eventId", req.EventID,
		"jobId", info.ID,
		"qrStrategy", req.QRStrategy,
	)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(TriggerResponse{
		JobID:   info.ID,
		Status:  "pending",
		Message: "QR generation queued",
	})
}

// HandleGetProgress handles GET /api/v1/qr/progress/{eventId}.
// It reads QR generation progress from Redis and returns it as JSON.
func (h *QRHandler) HandleGetProgress(w http.ResponseWriter, r *http.Request) {
	eventID := chi.URLParam(r, "eventId")
	if eventID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "eventId is required")
		return
	}

	result, err := h.redisClient.HGetAll(r.Context(), worker.ProgressKey(eventID)).Result()
	if err != nil {
		h.logger.Error("failed to read progress from Redis", "eventId", eventID, "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to read progress")
		return
	}

	if len(result) == 0 {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "No QR generation job found for this event")
		return
	}

	// Parse Redis hash fields
	total, _ := strconv.ParseInt(result["total"], 10, 64)
	completed, _ := strconv.ParseInt(result["completed"], 10, 64)
	failed, _ := strconv.ParseInt(result["failed"], 10, 64)
	status := result["status"]

	var percentComplete float64
	if total > 0 {
		percentComplete = float64(completed) / float64(total) * 100
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ProgressResponse{
		EventID:         eventID,
		Total:           total,
		Completed:       completed,
		Failed:          failed,
		Status:          status,
		PercentComplete: percentComplete,
	})
}

// writeError writes a standardized error JSON response.
func writeError(w http.ResponseWriter, statusCode int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(model.ErrorResponse{
		Error: model.ErrorDetail{
			Code:    code,
			Message: message,
		},
	})
}
