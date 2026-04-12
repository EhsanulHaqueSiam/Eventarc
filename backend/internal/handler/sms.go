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

	"github.com/ehsanul-haque-siam/eventarc/internal/sms"
)

// SMSHandler handles HTTP endpoints for SMS delivery triggering and progress.
type SMSHandler struct {
	asynqClient TaskEnqueuer
	redisClient *redis.Client
	logger      *slog.Logger
}

// NewSMSHandler creates an SMSHandler for HTTP request processing.
func NewSMSHandler(asynqClient TaskEnqueuer, redisClient *redis.Client) *SMSHandler {
	return &SMSHandler{
		asynqClient: asynqClient,
		redisClient: redisClient,
		logger:      slog.Default(),
	}
}

// SendSMSRequest is the JSON body for triggering bulk SMS delivery.
type SendSMSRequest struct {
	MessageTemplate string `json:"messageTemplate"` // SMS text with {cardUrl} placeholder
}

// SMSProgressResponse is the JSON response for SMS delivery progress.
type SMSProgressResponse struct {
	Total        int64 `json:"total"`
	Queued       int64 `json:"queued"`
	Sent         int64 `json:"sent"`
	Delivered    int64 `json:"delivered"`
	Failed       int64 `json:"failed"`
	BalanceError bool  `json:"balanceError"`
}

// smsProgressKey returns the Redis key for SMS progress tracking.
func smsProgressKey(eventID, field string) string {
	return fmt.Sprintf("sms:%s:%s", eventID, field)
}

// HandleSendSMS handles POST /api/v1/events/{eventId}/sms/send.
// It validates the request, checks for active batches, enqueues an asynq
// batch SMS task, and returns 202 Accepted.
func (h *SMSHandler) HandleSendSMS(w http.ResponseWriter, r *http.Request) {
	eventID := chi.URLParam(r, "eventId")
	if eventID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "eventId is required")
		return
	}

	var req SendSMSRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON body")
		return
	}

	// Validate message template (T-08-12 mitigation)
	if req.MessageTemplate == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "messageTemplate is required")
		return
	}
	if len(req.MessageTemplate) > 800 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "messageTemplate exceeds 800 character limit")
		return
	}

	// Check for active batch (T-08-11 mitigation)
	ctx := r.Context()
	existing, _ := h.redisClient.Get(ctx, smsProgressKey(eventID, "total")).Result()
	if existing != "" && existing != "0" {
		queued, _ := h.redisClient.Get(ctx, smsProgressKey(eventID, "queued")).Result()
		queuedCount, _ := strconv.ParseInt(queued, 10, 64)
		if queuedCount > 0 {
			writeError(w, http.StatusConflict, "BATCH_IN_PROGRESS",
				"An SMS batch is already running for this event")
			return
		}
	}

	// Enqueue SMS batch task
	// Note: actual guest phone list is fetched by the worker from Convex
	payload := sms.SMSBatchPayload{
		EventID:         eventID,
		MessageTemplate: req.MessageTemplate,
		GuestPhones:     nil, // Worker fetches from Convex
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		h.logger.Error("failed to marshal SMS batch payload", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create task")
		return
	}

	task := asynq.NewTask(sms.TypeSMSBatch, payloadBytes, asynq.MaxRetry(3), asynq.Queue("default"))
	if _, err := h.asynqClient.Enqueue(task); err != nil {
		h.logger.Error("failed to enqueue SMS batch", "eventId", eventID, "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to enqueue SMS task")
		return
	}

	h.logger.Info("SMS delivery triggered", "eventId", eventID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{
		"status": "queued",
	})
}

// HandleSMSProgress handles GET /api/v1/events/{eventId}/sms/progress.
// It reads SMS delivery progress from Redis and returns it as JSON.
func (h *SMSHandler) HandleSMSProgress(w http.ResponseWriter, r *http.Request) {
	eventID := chi.URLParam(r, "eventId")
	if eventID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "eventId is required")
		return
	}

	ctx := r.Context()
	totalStr, _ := h.redisClient.Get(ctx, smsProgressKey(eventID, "total")).Result()
	queuedStr, _ := h.redisClient.Get(ctx, smsProgressKey(eventID, "queued")).Result()
	sentStr, _ := h.redisClient.Get(ctx, smsProgressKey(eventID, "sent")).Result()
	deliveredStr, _ := h.redisClient.Get(ctx, smsProgressKey(eventID, "delivered")).Result()
	failedStr, _ := h.redisClient.Get(ctx, smsProgressKey(eventID, "failed")).Result()
	balanceErr, _ := h.redisClient.Get(ctx, smsProgressKey(eventID, "balance_error")).Result()

	total, _ := strconv.ParseInt(totalStr, 10, 64)
	queued, _ := strconv.ParseInt(queuedStr, 10, 64)
	sent, _ := strconv.ParseInt(sentStr, 10, 64)
	delivered, _ := strconv.ParseInt(deliveredStr, 10, 64)
	failed, _ := strconv.ParseInt(failedStr, 10, 64)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(SMSProgressResponse{
		Total:        total,
		Queued:       queued,
		Sent:         sent,
		Delivered:    delivered,
		Failed:       failed,
		BalanceError: balanceErr == "true",
	})
}
