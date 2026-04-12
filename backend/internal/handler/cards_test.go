package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestHandleCompositeCards_ValidRequest(t *testing.T) {
	redisClient := newTestRedis(t)
	defer redisClient.Close()

	mock := &mockEnqueuer{}
	h := NewCardHandler(mock, redisClient)

	body := `{"templateId":"tpl_123","backgroundImageKey":"evt1/bg.png","qrOverlay":{"left":100,"top":200,"width":150,"height":150}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/events/evt1/cards/composite", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")

	// Wire chi URL params
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("eventId", "evt1")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rec := httptest.NewRecorder()

	h.HandleCompositeCards(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Errorf("status = %d, want %d; body: %s", rec.Code, http.StatusAccepted, rec.Body.String())
	}

	var resp map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["status"] != "queued" {
		t.Errorf("status = %q, want %q", resp["status"], "queued")
	}

	// Verify task was enqueued
	if mock.lastTask == nil {
		t.Fatal("expected task to be enqueued")
	}
	if mock.lastTask.Type() != TypeCardCompositeBatch {
		t.Errorf("task type = %q, want %q", mock.lastTask.Type(), TypeCardCompositeBatch)
	}

	// Clean up
	ctx := context.Background()
	redisClient.Del(ctx, compositeProgressKey("evt1", "total"))
	redisClient.Del(ctx, compositeProgressKey("evt1", "done"))
	redisClient.Del(ctx, compositeProgressKey("evt1", "failed"))
}

func TestHandleCompositeCards_InvalidOverlay(t *testing.T) {
	mock := &mockEnqueuer{}
	rc := dummyRedis()
	defer rc.Close()

	h := NewCardHandler(mock, rc)

	body := `{"backgroundImageKey":"evt1/bg.png","qrOverlay":{"left":-1,"top":200,"width":150,"height":150}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/events/evt1/cards/composite", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")

	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("eventId", "evt1")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rec := httptest.NewRecorder()

	h.HandleCompositeCards(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d; body: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}

	if mock.lastTask != nil {
		t.Error("expected no task enqueued for invalid overlay")
	}
}

func TestHandleCompositeCards_MissingBackgroundKey(t *testing.T) {
	mock := &mockEnqueuer{}
	rc := dummyRedis()
	defer rc.Close()

	h := NewCardHandler(mock, rc)

	body := `{"qrOverlay":{"left":100,"top":200,"width":150,"height":150}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/events/evt1/cards/composite", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")

	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("eventId", "evt1")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rec := httptest.NewRecorder()

	h.HandleCompositeCards(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d; body: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestHandleCompositeProgress(t *testing.T) {
	redisClient := newTestRedis(t)
	defer redisClient.Close()

	ctx := context.Background()
	eventID := "evt_card_progress_test"

	// Set up progress data
	redisClient.Set(ctx, compositeProgressKey(eventID, "total"), 1000, 0)
	redisClient.Set(ctx, compositeProgressKey(eventID, "done"), 500, 0)
	redisClient.Set(ctx, compositeProgressKey(eventID, "failed"), 3, 0)
	defer func() {
		redisClient.Del(ctx, compositeProgressKey(eventID, "total"))
		redisClient.Del(ctx, compositeProgressKey(eventID, "done"))
		redisClient.Del(ctx, compositeProgressKey(eventID, "failed"))
	}()

	h := NewCardHandler(&mockEnqueuer{}, redisClient)

	r := chi.NewRouter()
	r.Get("/api/v1/events/{eventId}/cards/progress", h.HandleCompositeProgress)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events/"+eventID+"/cards/progress", nil)
	rec := httptest.NewRecorder()

	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp CompositeProgressResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Total != 1000 {
		t.Errorf("total = %d, want %d", resp.Total, 1000)
	}
	if resp.Done != 500 {
		t.Errorf("done = %d, want %d", resp.Done, 500)
	}
	if resp.Failed != 3 {
		t.Errorf("failed = %d, want %d", resp.Failed, 3)
	}
}
