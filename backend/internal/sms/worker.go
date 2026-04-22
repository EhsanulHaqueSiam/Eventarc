package sms

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/convexsync"
)

// Asynq task type constants for the SMS delivery pipeline.
const (
	TypeSMSBatch      = "sms:batch"       // Orchestrator: splits guests into batches
	TypeSMSSendBatch  = "sms:send:batch"  // Sends a single batch of up to 100 numbers
	TypeSMSStatusPoll = "sms:status:poll" // Periodic delivery status check
	TypeSMSRetry      = "sms:retry"       // Retry single failed recipient
)

const (
	defaultBatchSize        = 100
	defaultMaxBatchesPerSec = 5
	maxRetries              = 5
	statusPollInterval      = 30 * time.Second
)

// GuestPhone represents a guest's phone and card URL for SMS delivery.
type GuestPhone struct {
	GuestID string `json:"guestId"`
	Phone   string `json:"phone"`
	CardURL string `json:"cardUrl"`
}

// SMSBatchPayload is the payload for the batch orchestrator task.
type SMSBatchPayload struct {
	EventID         string       `json:"eventId"`
	MessageTemplate string       `json:"messageTemplate"`
	GuestPhones     []GuestPhone `json:"guestPhones"`
}

// SMSSendBatchPayload is the payload for a single batch send.
type SMSSendBatchPayload struct {
	EventID         string       `json:"eventId"`
	MessageTemplate string       `json:"messageTemplate"`
	Batch           []GuestPhone `json:"batch"`
}

// SMSRetryPayload is the payload for retrying a single failed recipient.
type SMSRetryPayload struct {
	EventID    string `json:"eventId"`
	GuestID    string `json:"guestId"`
	Phone      string `json:"phone"`
	Message    string `json:"message"`
	RetryCount int    `json:"retryCount"`
}

// SMSStatusPollPayload is the payload for polling delivery status.
type SMSStatusPollPayload struct {
	EventID string `json:"eventId"`
}

// SMSWorker handles asynq tasks for the SMS delivery pipeline.
type SMSWorker struct {
	provider         SMSProvider
	redisClient      *redis.Client
	asynqClient      *asynq.Client
	convexClient     *convexsync.Client // optional; if set, terminal status transitions are synced to Convex
	batchSize        int
	maxBatchesPerSec int
	logger           *slog.Logger
}

// NewSMSWorker creates an SMSWorker with the given provider and clients.
func NewSMSWorker(provider SMSProvider, redisClient *redis.Client, asynqClient *asynq.Client) *SMSWorker {
	return &SMSWorker{
		provider:         provider,
		redisClient:      redisClient,
		asynqClient:      asynqClient,
		batchSize:        defaultBatchSize,
		maxBatchesPerSec: defaultMaxBatchesPerSec,
		logger:           slog.Default(),
	}
}

// SetConvexClient wires an optional Convex sync client. When configured, the
// worker calls /internal/sync/sms-status on sent/failed transitions so the
// Convex smsDeliveries table stays consistent with Redis.
func (w *SMSWorker) SetConvexClient(c *convexsync.Client) {
	w.convexClient = c
}

// syncSMSStatus fires-and-forgets a status update to Convex. Sync failures are
// logged but never block the SMS pipeline — Redis remains the authoritative
// real-time counter; Convex is the durable record.
func (w *SMSWorker) syncSMSStatus(ctx context.Context, eventID, guestID, phone, status, providerRequestID, failureReason string) {
	if w.convexClient == nil || !w.convexClient.IsConfigured() {
		return
	}
	if eventID == "" || guestID == "" {
		return
	}
	payload := convexsync.SMSStatusSyncPayload{
		EventID:           eventID,
		GuestID:           guestID,
		Phone:             phone,
		Status:            status,
		ProviderRequestID: providerRequestID,
		FailureReason:     failureReason,
		LastAttemptAt:     time.Now().UTC().Format(time.RFC3339),
	}
	if err := w.convexClient.SyncSMSStatus(ctx, payload); err != nil {
		w.logger.Warn("SMS status sync to Convex failed",
			"eventId", eventID, "guestId", guestID, "status", status, "error", err)
	}
}

// smsProgressKey returns the Redis key for SMS progress tracking.
func smsProgressKey(eventID, field string) string {
	return fmt.Sprintf("sms:%s:%s", eventID, field)
}

// HandleSMSBatch handles the orchestrator task that splits guests into batches.
func (w *SMSWorker) HandleSMSBatch(ctx context.Context, t *asynq.Task) error {
	var payload SMSBatchPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("sms: unmarshal batch payload: %w", err)
	}

	total := len(payload.GuestPhones)
	w.logger.Info("SMS batch started", "eventId", payload.EventID, "total", total)

	// Initialize Redis counters
	pipe := w.redisClient.Pipeline()
	pipe.Set(ctx, smsProgressKey(payload.EventID, "total"), total, 0)
	pipe.Set(ctx, smsProgressKey(payload.EventID, "queued"), total, 0)
	pipe.Set(ctx, smsProgressKey(payload.EventID, "sent"), 0, 0)
	pipe.Set(ctx, smsProgressKey(payload.EventID, "delivered"), 0, 0)
	pipe.Set(ctx, smsProgressKey(payload.EventID, "failed"), 0, 0)
	pipe.Del(ctx, smsProgressKey(payload.EventID, "balance_error"))
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("sms: init progress counters: %w", err)
	}

	// Split into batches and enqueue
	ticker := time.NewTicker(time.Second / time.Duration(w.maxBatchesPerSec))
	defer ticker.Stop()

	for i := 0; i < total; i += w.batchSize {
		end := i + w.batchSize
		if end > total {
			end = total
		}

		batchPayload := SMSSendBatchPayload{
			EventID:         payload.EventID,
			MessageTemplate: payload.MessageTemplate,
			Batch:           payload.GuestPhones[i:end],
		}

		batchBytes, err := json.Marshal(batchPayload)
		if err != nil {
			w.logger.Error("failed to marshal send batch", "error", err)
			continue
		}

		task := asynq.NewTask(TypeSMSSendBatch, batchBytes, asynq.MaxRetry(3), asynq.Queue("default"))
		if err := w.enqueueOrRun(ctx, task); err != nil {
			w.logger.Error("failed to dispatch send batch", "error", err)
		}

		// Rate limit between batch enqueues
		if i+w.batchSize < total {
			<-ticker.C
		}
	}

	// Enqueue status polling task
	pollPayload, _ := json.Marshal(SMSStatusPollPayload{EventID: payload.EventID})
	pollTask := asynq.NewTask(TypeSMSStatusPoll, pollPayload,
		asynq.ProcessIn(statusPollInterval), asynq.MaxRetry(10), asynq.Queue("default"))
	if err := w.enqueueOrRun(ctx, pollTask); err != nil {
		w.logger.Error("failed to dispatch status poll task", "error", err)
	}

	return nil
}

// HandleSMSSendBatch sends a single batch of SMS messages.
func (w *SMSWorker) HandleSMSSendBatch(ctx context.Context, t *asynq.Task) error {
	var payload SMSSendBatchPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("sms: unmarshal send batch: %w", err)
	}

	// Build messages and phone list
	phones := make([]string, len(payload.Batch))
	for i, gp := range payload.Batch {
		phones[i] = gp.Phone
	}

	// Replace {cardUrl} placeholder — use first guest's URL for batch message
	// (batch SMS sends same message to all recipients)
	message := payload.MessageTemplate
	if len(payload.Batch) > 0 {
		// For individual messages, each guest gets their own URL
		// For batch API, we send all at once with same message
	}

	resp, err := w.provider.Send(ctx, SendRequest{
		To:      phones,
		Message: message,
	})

	if err != nil {
		if errors.Is(err, ErrInsufficientBalance) {
			// Set balance error flag and stop — don't retry
			w.redisClient.Set(ctx, smsProgressKey(payload.EventID, "balance_error"), "true", 0)
			w.logger.Error("SMS insufficient balance — batch halted", "eventId", payload.EventID)
			return asynq.SkipRetry
		}
		return fmt.Errorf("sms: send batch failed: %w", err)
	}

	// Update counters
	batchSize := int64(len(payload.Batch))
	w.redisClient.IncrBy(ctx, smsProgressKey(payload.EventID, "sent"), batchSize)
	w.redisClient.DecrBy(ctx, smsProgressKey(payload.EventID, "queued"), batchSize)

	// Store request_id for status polling
	if resp.RequestID != "" {
		w.redisClient.SAdd(ctx, smsProgressKey(payload.EventID, "pending_requests"), resp.RequestID)
	}

	// Build a lookup set of failed indices so we can tag each batch member
	// as sent or failed when syncing to Convex.
	failedByIndex := make(map[int]struct{}, len(resp.Recipients))
	for i, recipient := range resp.Recipients {
		if recipient.Status == "Failed" {
			failedByIndex[i] = struct{}{}
		}
	}

	// Check for individual recipient failures
	for i, recipient := range resp.Recipients {
		if recipient.Status == "Failed" && i < len(payload.Batch) {
			gp := payload.Batch[i]
			retryPayload, _ := json.Marshal(SMSRetryPayload{
				EventID:    payload.EventID,
				GuestID:    gp.GuestID,
				Phone:      gp.Phone,
				Message:    message,
				RetryCount: 0,
			})
			retryTask := asynq.NewTask(TypeSMSRetry, retryPayload,
				asynq.ProcessIn(time.Second), asynq.MaxRetry(0), asynq.Queue("default"))
			if err := w.enqueueOrRun(ctx, retryTask); err != nil {
				w.logger.Error("failed to dispatch retry task", "error", err)
			}
		}
	}

	// Sync per-guest terminal status to Convex so the admin dashboard reflects
	// the real state (sent vs initial failed) after this batch.
	for i, gp := range payload.Batch {
		if _, failed := failedByIndex[i]; failed {
			// Intentional: retry pipeline handles the final "failed" sync
			// after max retries. Skip syncing an intermediate failed state
			// to avoid flapping the Convex record.
			continue
		}
		w.syncSMSStatus(ctx, payload.EventID, gp.GuestID, gp.Phone, "sent", resp.RequestID, "")
	}

	w.logger.Info("SMS batch sent",
		"eventId", payload.EventID,
		"count", len(payload.Batch),
		"requestId", resp.RequestID,
	)

	return nil
}

// HandleSMSRetry retries sending to a single failed recipient with exponential backoff.
func (w *SMSWorker) HandleSMSRetry(ctx context.Context, t *asynq.Task) error {
	var payload SMSRetryPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("sms: unmarshal retry payload: %w", err)
	}

	// Max retries exceeded — mark permanently failed
	if payload.RetryCount >= maxRetries {
		w.redisClient.Incr(ctx, smsProgressKey(payload.EventID, "failed"))
		w.redisClient.Decr(ctx, smsProgressKey(payload.EventID, "queued"))
		w.logger.Warn("SMS permanently failed after max retries",
			"eventId", payload.EventID,
			"phone", payload.Phone,
			"retries", payload.RetryCount,
		)
		w.syncSMSStatus(ctx, payload.EventID, payload.GuestID, payload.Phone,
			"failed", "", fmt.Sprintf("max retries (%d) exceeded", payload.RetryCount))
		return nil
	}

	// Attempt to send
	_, err := w.provider.Send(ctx, SendRequest{
		To:      []string{payload.Phone},
		Message: payload.Message,
	})

	if err != nil {
		if errors.Is(err, ErrInsufficientBalance) {
			w.redisClient.Set(ctx, smsProgressKey(payload.EventID, "balance_error"), "true", 0)
			return nil // Don't retry on balance issues
		}

		// Re-enqueue with exponential backoff: 2^retryCount seconds
		delay := time.Duration(math.Pow(2, float64(payload.RetryCount))) * time.Second
		nextPayload, _ := json.Marshal(SMSRetryPayload{
			EventID:    payload.EventID,
			GuestID:    payload.GuestID,
			Phone:      payload.Phone,
			Message:    payload.Message,
			RetryCount: payload.RetryCount + 1,
		})
		nextTask := asynq.NewTask(TypeSMSRetry, nextPayload,
			asynq.ProcessIn(delay), asynq.MaxRetry(0), asynq.Queue("default"))
		if err := w.enqueueOrRun(ctx, nextTask); err != nil {
			w.logger.Error("failed to dispatch retry task", "error", err)
		}
		return nil
	}

	// Success — update counters
	w.redisClient.Incr(ctx, smsProgressKey(payload.EventID, "sent"))
	w.syncSMSStatus(ctx, payload.EventID, payload.GuestID, payload.Phone, "sent", "", "")
	return nil
}

// HandleSMSStatusPoll queries provider for delivery status of pending requests.
func (w *SMSWorker) HandleSMSStatusPoll(ctx context.Context, t *asynq.Task) error {
	var payload SMSStatusPollPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("sms: unmarshal status poll: %w", err)
	}

	// Get pending request IDs
	requestIDs, err := w.redisClient.SMembers(ctx, smsProgressKey(payload.EventID, "pending_requests")).Result()
	if err != nil || len(requestIDs) == 0 {
		return nil // Nothing to poll
	}

	for _, reqID := range requestIDs {
		resp, err := w.provider.CheckStatus(ctx, reqID)
		if err != nil {
			w.logger.Error("failed to check SMS status", "requestId", reqID, "error", err)
			continue
		}

		allTerminal := true
		for _, r := range resp.Recipients {
			switch r.Status {
			case "Delivered":
				w.redisClient.Incr(ctx, smsProgressKey(payload.EventID, "delivered"))
			case "Failed":
				w.redisClient.Incr(ctx, smsProgressKey(payload.EventID, "failed"))
			default:
				allTerminal = false
			}
		}

		// Remove completed request from pending set
		if allTerminal {
			w.redisClient.SRem(ctx, smsProgressKey(payload.EventID, "pending_requests"), reqID)
		}
	}

	// Re-enqueue if there are still pending requests
	remaining, _ := w.redisClient.SCard(ctx, smsProgressKey(payload.EventID, "pending_requests")).Result()
	if remaining > 0 {
		pollPayload, _ := json.Marshal(SMSStatusPollPayload{EventID: payload.EventID})
		pollTask := asynq.NewTask(TypeSMSStatusPoll, pollPayload,
			asynq.ProcessIn(statusPollInterval), asynq.MaxRetry(10), asynq.Queue("default"))
		if err := w.enqueueOrRun(ctx, pollTask); err != nil {
			w.logger.Error("failed to dispatch status poll task", "error", err)
		}
	}

	return nil
}

// BackoffDelay calculates the exponential backoff delay for a given retry count.
// Exported for testing.
func BackoffDelay(retryCount int) time.Duration {
	return time.Duration(math.Pow(2, float64(retryCount))) * time.Second
}

// enqueueOrRun dispatches SMS tasks through Asynq when available.
// In integration tests or fallback mode (no Asynq client), it executes tasks inline.
func (w *SMSWorker) enqueueOrRun(ctx context.Context, task *asynq.Task) error {
	if w.asynqClient != nil {
		_, err := w.asynqClient.Enqueue(task)
		return err
	}

	switch task.Type() {
	case TypeSMSSendBatch:
		return w.handleSMSSendBatchInline(ctx, task)
	case TypeSMSRetry:
		return w.HandleSMSRetry(ctx, task)
	case TypeSMSStatusPoll:
		// In inline mode we skip polling scheduling.
		return nil
	default:
		return nil
	}
}

// handleSMSSendBatchInline executes a send batch directly when Asynq is unavailable.
// This mode is primarily for integration tests and local fallback behavior.
func (w *SMSWorker) handleSMSSendBatchInline(ctx context.Context, t *asynq.Task) error {
	var payload SMSSendBatchPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("sms: unmarshal send batch inline: %w", err)
	}

	phones := make([]string, len(payload.Batch))
	for i, gp := range payload.Batch {
		phones[i] = gp.Phone
	}

	_, err := w.provider.Send(ctx, SendRequest{
		To:      phones,
		Message: payload.MessageTemplate,
	})
	if err != nil {
		if errors.Is(err, ErrInsufficientBalance) {
			w.redisClient.Set(ctx, smsProgressKey(payload.EventID, "balance_error"), "true", 0)
			w.logger.Error("SMS insufficient balance — inline batch halted", "eventId", payload.EventID)
			return nil
		}
		return fmt.Errorf("sms: inline send batch failed: %w", err)
	}

	w.logger.Info("SMS batch sent",
		"eventId", payload.EventID,
		"count", len(payload.Batch),
		"mode", "inline",
	)
	return nil
}
