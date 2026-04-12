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

func TestHandleSendSMS_ValidRequest(t *testing.T) {
	redisClient := newTestRedis(t)
	defer redisClient.Close()

	mock := &mockEnqueuer{}
	h := NewSMSHandler(mock, redisClient)

	body := `{"messageTemplate":"Your invitation card: {cardUrl}"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/events/evt1/sms/send", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")

	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("eventId", "evt1")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rec := httptest.NewRecorder()

	h.HandleSendSMS(rec, req)

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

	if mock.lastTask == nil {
		t.Fatal("expected task to be enqueued")
	}
	if mock.lastTask.Type() != "sms:batch" {
		t.Errorf("task type = %q, want %q", mock.lastTask.Type(), "sms:batch")
	}

	// Cleanup
	ctx := context.Background()
	redisClient.Del(ctx, smsProgressKey("evt1", "total"))
	redisClient.Del(ctx, smsProgressKey("evt1", "queued"))
}

func TestHandleSendSMS_EmptyTemplate(t *testing.T) {
	mock := &mockEnqueuer{}
	rc := dummyRedis()
	defer rc.Close()

	h := NewSMSHandler(mock, rc)

	body := `{"messageTemplate":""}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/events/evt1/sms/send", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")

	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("eventId", "evt1")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rec := httptest.NewRecorder()

	h.HandleSendSMS(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d; body: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}

	if mock.lastTask != nil {
		t.Error("expected no task enqueued for empty template")
	}
}

func TestHandleSendSMS_TemplateTooLong(t *testing.T) {
	mock := &mockEnqueuer{}
	rc := dummyRedis()
	defer rc.Close()

	h := NewSMSHandler(mock, rc)

	// Generate 801-char template
	longTemplate := make([]byte, 801)
	for i := range longTemplate {
		longTemplate[i] = 'a'
	}
	body := `{"messageTemplate":"` + string(longTemplate) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/events/evt1/sms/send", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")

	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("eventId", "evt1")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rec := httptest.NewRecorder()

	h.HandleSendSMS(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d; body: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestHandleSMSProgress(t *testing.T) {
	redisClient := newTestRedis(t)
	defer redisClient.Close()

	ctx := context.Background()
	eventID := "evt_sms_progress_test"

	// Set up progress data
	redisClient.Set(ctx, smsProgressKey(eventID, "total"), 1000, 0)
	redisClient.Set(ctx, smsProgressKey(eventID, "queued"), 200, 0)
	redisClient.Set(ctx, smsProgressKey(eventID, "sent"), 700, 0)
	redisClient.Set(ctx, smsProgressKey(eventID, "delivered"), 600, 0)
	redisClient.Set(ctx, smsProgressKey(eventID, "failed"), 5, 0)
	redisClient.Set(ctx, smsProgressKey(eventID, "balance_error"), "true", 0)
	defer func() {
		redisClient.Del(ctx,
			smsProgressKey(eventID, "total"),
			smsProgressKey(eventID, "queued"),
			smsProgressKey(eventID, "sent"),
			smsProgressKey(eventID, "delivered"),
			smsProgressKey(eventID, "failed"),
			smsProgressKey(eventID, "balance_error"),
		)
	}()

	h := NewSMSHandler(&mockEnqueuer{}, redisClient)

	r := chi.NewRouter()
	r.Get("/api/v1/events/{eventId}/sms/progress", h.HandleSMSProgress)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events/"+eventID+"/sms/progress", nil)
	rec := httptest.NewRecorder()

	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp SMSProgressResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Total != 1000 {
		t.Errorf("total = %d, want %d", resp.Total, 1000)
	}
	if resp.Queued != 200 {
		t.Errorf("queued = %d, want %d", resp.Queued, 200)
	}
	if resp.Sent != 700 {
		t.Errorf("sent = %d, want %d", resp.Sent, 700)
	}
	if resp.Delivered != 600 {
		t.Errorf("delivered = %d, want %d", resp.Delivered, 600)
	}
	if resp.Failed != 5 {
		t.Errorf("failed = %d, want %d", resp.Failed, 5)
	}
	if !resp.BalanceError {
		t.Error("balanceError should be true")
	}
}
