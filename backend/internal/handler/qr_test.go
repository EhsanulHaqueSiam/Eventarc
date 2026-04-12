package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
)

// mockEnqueuer implements TaskEnqueuer for testing.
type mockEnqueuer struct {
	lastTask *asynq.Task
	err      error
}

func (m *mockEnqueuer) Enqueue(task *asynq.Task, opts ...asynq.Option) (*asynq.TaskInfo, error) {
	m.lastTask = task
	if m.err != nil {
		return nil, m.err
	}
	return &asynq.TaskInfo{
		ID:    "test-job-id",
		Queue: "critical",
		Type:  task.Type(),
	}, nil
}

// newTestRedis creates a Redis client for integration tests.
// Tests that need Redis will be skipped if Redis is not available.
func newTestRedis(t *testing.T) *redis.Client {
	t.Helper()
	client := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	if err := client.Ping(context.Background()).Err(); err != nil {
		t.Skip("Redis not available, skipping test")
	}
	return client
}

// dummyRedis returns a Redis client that may or may not be connected.
// Use only for tests that never actually call Redis (e.g., validation tests
// that return before any Redis operation).
func dummyRedis() *redis.Client {
	return redis.NewClient(&redis.Options{Addr: "localhost:6379"})
}

func TestHandleTriggerGeneration_ValidRequest(t *testing.T) {
	mock := &mockEnqueuer{}
	redisClient := newTestRedis(t)
	defer redisClient.Close()

	h := NewQRHandler(mock, redisClient, nil)

	body := `{"eventId":"evt_test123","qrStrategy":"unified","foodQrMode":"guestLinked","foodQrTiming":"preSent"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/qr/generate", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.HandleTriggerGeneration(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Errorf("status = %d, want %d; body: %s", rec.Code, http.StatusAccepted, rec.Body.String())
	}

	var resp TriggerResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Status != "pending" {
		t.Errorf("resp.Status = %q, want %q", resp.Status, "pending")
	}
	if resp.Message != "QR generation queued" {
		t.Errorf("resp.Message = %q, want %q", resp.Message, "QR generation queued")
	}

	// Verify the mock received the task
	if mock.lastTask == nil {
		t.Fatal("expected task to be enqueued")
	}
	if mock.lastTask.Type() != "qr:generate-batch" {
		t.Errorf("task type = %q, want %q", mock.lastTask.Type(), "qr:generate-batch")
	}

	// Clean up Redis key
	redisClient.Del(context.Background(), "qr:progress:evt_test123")
}

// TestHandleTriggerGeneration_MissingEventID verifies that a request without
// eventId is rejected with 400 before any Redis or asynq interaction.
func TestHandleTriggerGeneration_MissingEventID(t *testing.T) {
	mock := &mockEnqueuer{}
	rc := dummyRedis()
	defer rc.Close()

	h := NewQRHandler(mock, rc, nil)

	body := `{"qrStrategy":"unified","foodQrMode":"guestLinked","foodQrTiming":"preSent"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/qr/generate", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.HandleTriggerGeneration(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d; body: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}

	// Verify no task was enqueued
	if mock.lastTask != nil {
		t.Error("expected no task to be enqueued for missing eventId")
	}
}

// TestHandleTriggerGeneration_InvalidStrategy verifies that invalid qrStrategy
// values are rejected with 400 before any Redis or asynq interaction.
func TestHandleTriggerGeneration_InvalidStrategy(t *testing.T) {
	mock := &mockEnqueuer{}
	rc := dummyRedis()
	defer rc.Close()

	h := NewQRHandler(mock, rc, nil)

	body := `{"eventId":"evt_test","qrStrategy":"invalid","foodQrMode":"guestLinked","foodQrTiming":"preSent"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/qr/generate", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.HandleTriggerGeneration(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d; body: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}

	// Verify no task was enqueued
	if mock.lastTask != nil {
		t.Error("expected no task to be enqueued for invalid strategy")
	}
}

func TestHandleGetProgress_NotFound(t *testing.T) {
	redisClient := newTestRedis(t)
	defer redisClient.Close()

	h := NewQRHandler(&mockEnqueuer{}, redisClient, nil)

	// Use chi router to inject URL params
	r := chi.NewRouter()
	r.Get("/api/v1/qr/progress/{eventId}", h.HandleGetProgress)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/qr/progress/evt_nonexistent_test", nil)
	rec := httptest.NewRecorder()

	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d; body: %s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

func TestHandleGetProgress_RunningJob(t *testing.T) {
	redisClient := newTestRedis(t)
	defer redisClient.Close()

	ctx := context.Background()
	eventID := "evt_progress_test"
	key := "qr:progress:" + eventID

	// Set up progress data in Redis
	redisClient.HSet(ctx, key, map[string]interface{}{
		"total":     1000,
		"completed": 500,
		"failed":    3,
		"status":    "running",
	})
	defer redisClient.Del(ctx, key)

	h := NewQRHandler(&mockEnqueuer{}, redisClient, nil)

	// Use chi router to inject URL params
	r := chi.NewRouter()
	r.Get("/api/v1/qr/progress/{eventId}", h.HandleGetProgress)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/qr/progress/"+eventID, nil)
	rec := httptest.NewRecorder()

	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp ProgressResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.EventID != eventID {
		t.Errorf("eventId = %q, want %q", resp.EventID, eventID)
	}
	if resp.Total != 1000 {
		t.Errorf("total = %d, want %d", resp.Total, 1000)
	}
	if resp.Completed != 500 {
		t.Errorf("completed = %d, want %d", resp.Completed, 500)
	}
	if resp.Failed != 3 {
		t.Errorf("failed = %d, want %d", resp.Failed, 3)
	}
	if resp.Status != "running" {
		t.Errorf("status = %q, want %q", resp.Status, "running")
	}
	// percentComplete = 500/1000 * 100 = 50.0
	if resp.PercentComplete != 50.0 {
		t.Errorf("percentComplete = %f, want %f", resp.PercentComplete, 50.0)
	}
}
