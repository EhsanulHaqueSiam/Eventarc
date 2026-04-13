package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/card"
	"github.com/ehsanul-haque-siam/eventarc/internal/convexsync"
	"github.com/ehsanul-haque-siam/eventarc/internal/qr"
	"github.com/ehsanul-haque-siam/eventarc/internal/r2"
)

// CardCompositeSinglePayload is the payload for a single guest compositing task.
type CardCompositeSinglePayload struct {
	TemplateID         string       `json:"templateId"`
	EventID            string       `json:"eventId"`
	GuestID            string       `json:"guestId"`
	BackgroundImageKey string       `json:"backgroundImageKey"`
	OverlayConfig      OverlayParam `json:"overlayConfig"`
}

// CardWorker handles background card-compositing tasks.
type CardWorker struct {
	asynqClient *asynq.Client
	redisClient *redis.Client
	r2Client    *r2.Client
	convex      *convexsync.Client
	logger      *slog.Logger
}

// NewCardWorker creates a worker for card-compositing tasks.
func NewCardWorker(
	asynqClient *asynq.Client,
	redisClient *redis.Client,
	r2Client *r2.Client,
	convexClient *convexsync.Client,
	logger *slog.Logger,
) *CardWorker {
	if logger == nil {
		logger = slog.Default()
	}
	return &CardWorker{
		asynqClient: asynqClient,
		redisClient: redisClient,
		r2Client:    r2Client,
		convex:      convexClient,
		logger:      logger,
	}
}

// HandleCompositeBatch fans out one compositing task per guest for the event.
func (w *CardWorker) HandleCompositeBatch(ctx context.Context, task *asynq.Task) error {
	var payload CardCompositeBatchPayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		return fmt.Errorf("card worker: unmarshal batch payload: %w", err)
	}

	resolvedBackgroundKey, err := w.prepareBackground(ctx, payload)
	if err != nil {
		return err
	}

	guestIDs, err := w.listEventGuestIDs(ctx, payload.EventID)
	if err != nil {
		return fmt.Errorf("card worker: list guests for event %s: %w", payload.EventID, err)
	}

	pipe := w.redisClient.Pipeline()
	pipe.Set(ctx, compositeProgressKey(payload.EventID, "total"), len(guestIDs), 0)
	pipe.Set(ctx, compositeProgressKey(payload.EventID, "done"), 0, 0)
	pipe.Set(ctx, compositeProgressKey(payload.EventID, "failed"), 0, 0)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("card worker: initialize progress counters: %w", err)
	}

	if len(guestIDs) == 0 {
		w.logger.Info("card batch has no guests", "event_id", payload.EventID)
		return nil
	}

	for _, guestID := range guestIDs {
		singlePayload := CardCompositeSinglePayload{
			TemplateID:         payload.TemplateID,
			EventID:            payload.EventID,
			GuestID:            guestID,
			BackgroundImageKey: resolvedBackgroundKey,
			OverlayConfig:      payload.OverlayConfig,
		}
		rawPayload, err := json.Marshal(singlePayload)
		if err != nil {
			w.redisClient.Incr(ctx, compositeProgressKey(payload.EventID, "failed"))
			w.logger.Error("card worker: marshal single payload failed",
				"event_id", payload.EventID,
				"guest_id", guestID,
				"error", err,
			)
			continue
		}

		singleTask := asynq.NewTask(
			TypeCardCompositeSingle,
			rawPayload,
			asynq.Queue("critical"),
			asynq.MaxRetry(3),
		)
		if _, err := w.asynqClient.Enqueue(singleTask); err != nil {
			w.redisClient.Incr(ctx, compositeProgressKey(payload.EventID, "failed"))
			w.logger.Error("card worker: enqueue single task failed",
				"event_id", payload.EventID,
				"guest_id", guestID,
				"error", err,
			)
		}
	}

	w.logger.Info("card batch fan-out complete",
		"event_id", payload.EventID,
		"guest_count", len(guestIDs),
	)

	return nil
}

// HandleCompositeSingle composes one guest card and writes card URL back to Convex.
func (w *CardWorker) HandleCompositeSingle(ctx context.Context, task *asynq.Task) error {
	var payload CardCompositeSinglePayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		return fmt.Errorf("card worker: unmarshal single payload: %w", err)
	}

	if err := w.composeSingle(ctx, payload); err != nil {
		w.redisClient.Incr(ctx, compositeProgressKey(payload.EventID, "failed"))
		w.logger.Error("card composite failed",
			"event_id", payload.EventID,
			"guest_id", payload.GuestID,
			"error", err,
		)
		// Don't return error so the batch can complete deterministically.
		return nil
	}

	w.redisClient.Incr(ctx, compositeProgressKey(payload.EventID, "done"))
	return nil
}

func (w *CardWorker) composeSingle(ctx context.Context, payload CardCompositeSinglePayload) error {
	backgroundBytes, err := w.r2Client.Download(ctx, payload.BackgroundImageKey)
	if err != nil {
		return fmt.Errorf("download background %q: %w", payload.BackgroundImageKey, err)
	}

	qrBytes, err := w.downloadGuestQR(ctx, payload.EventID, payload.GuestID)
	if err != nil {
		return fmt.Errorf("download guest qr: %w", err)
	}

	compositeBytes, err := card.Composite(backgroundBytes, qrBytes, card.OverlayConfig{
		Left:   payload.OverlayConfig.Left,
		Top:    payload.OverlayConfig.Top,
		Width:  payload.OverlayConfig.Width,
		Height: payload.OverlayConfig.Height,
	})
	if err != nil {
		return fmt.Errorf("composite card: %w", err)
	}

	cardKey := card.BuildCardKey(payload.EventID, payload.GuestID)
	if err := w.r2Client.Upload(ctx, cardKey, compositeBytes, "image/png"); err != nil {
		return fmt.Errorf("upload composite card: %w", err)
	}

	cardURL := w.r2Client.PublicURL(cardKey)
	if w.convex != nil && w.convex.IsConfigured() {
		if err := w.convex.SyncGuestCard(
			ctx,
			payload.EventID,
			payload.GuestID,
			cardURL,
			cardKey,
		); err != nil {
			return fmt.Errorf("sync card url to convex: %w", err)
		}
	}

	return nil
}

func (w *CardWorker) prepareBackground(ctx context.Context, payload CardCompositeBatchPayload) (string, error) {
	if payload.BackgroundImageURL == "" {
		return payload.BackgroundImageKey, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, payload.BackgroundImageURL, nil)
	if err != nil {
		return "", fmt.Errorf("create background request: %w", err)
	}

	httpClient := &http.Client{Timeout: 20 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("download background from URL: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		rawBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("download background returned %d: %s", resp.StatusCode, string(rawBody))
	}

	backgroundBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read background body: %w", err)
	}

	backgroundKey := r2.BuildTemplateBackgroundKey(payload.EventID, payload.TemplateID)
	if err := w.r2Client.Upload(ctx, backgroundKey, backgroundBytes, "image/png"); err != nil {
		return "", fmt.Errorf("upload background to R2: %w", err)
	}
	return backgroundKey, nil
}

func (w *CardWorker) listEventGuestIDs(ctx context.Context, eventID string) ([]string, error) {
	iter := w.redisClient.Scan(ctx, 0, fmt.Sprintf("guest:%s:*", eventID), 1000).Iterator()
	ids := make([]string, 0, 1024)

	for iter.Next(ctx) {
		key := iter.Val()
		lastColon := strings.LastIndex(key, ":")
		if lastColon == -1 || lastColon >= len(key)-1 {
			continue
		}
		ids = append(ids, key[lastColon+1:])
	}

	if err := iter.Err(); err != nil {
		return nil, err
	}
	return ids, nil
}

func (w *CardWorker) downloadGuestQR(ctx context.Context, eventID, guestID string) ([]byte, error) {
	strategy, _ := w.redisClient.HGet(ctx, fmt.Sprintf("event:%s", eventID), "qrStrategy").Result()

	preferred := []byte{qr.QRTypeEntry, qr.QRTypeUnified}
	if strategy == "unified" {
		preferred = []byte{qr.QRTypeUnified, qr.QRTypeEntry}
	}

	var lastErr error
	for _, qrType := range preferred {
		newKey := r2.BuildKey(eventID, guestID, qrType)
		data, err := w.r2Client.Download(ctx, newKey)
		if err == nil {
			return data, nil
		}
		lastErr = err

		legacyKey := r2.BuildLegacyKey(eventID, guestID, qrType)
		data, legacyErr := w.r2Client.Download(ctx, legacyKey)
		if legacyErr == nil {
			return data, nil
		}
		lastErr = legacyErr
	}

	return nil, fmt.Errorf("no QR image found for guest %s (last error: %v)", guestID, lastErr)
}
