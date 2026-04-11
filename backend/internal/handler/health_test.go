package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewHealthHandlerNilServices(t *testing.T) {
	handler := NewHealthHandler(nil, nil)

	req := httptest.NewRequest("GET", "/api/v1/health", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 with nil services, got %d", rr.Code)
	}

	if rr.Header().Get("Content-Type") != "application/json" {
		t.Errorf("expected Content-Type application/json, got %s", rr.Header().Get("Content-Type"))
	}

	var resp healthResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Status != "degraded" {
		t.Errorf("expected status degraded, got %s", resp.Status)
	}
	if resp.Redis != "not configured" {
		t.Errorf("expected redis not configured, got %s", resp.Redis)
	}
	if resp.Postgres != "not configured" {
		t.Errorf("expected postgres not configured, got %s", resp.Postgres)
	}
}

func TestNewHealthHandlerResponseShape(t *testing.T) {
	handler := NewHealthHandler(nil, nil)

	req := httptest.NewRequest("GET", "/api/v1/health", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	var raw map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&raw); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	requiredFields := []string{"status", "redis", "postgres"}
	for _, field := range requiredFields {
		if _, ok := raw[field]; !ok {
			t.Errorf("response missing required field: %s", field)
		}
	}
}
