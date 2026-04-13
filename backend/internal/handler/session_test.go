package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
)

func setupSessionTest(t *testing.T) (*SessionHandler, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	t.Cleanup(mr.Close)

	rc := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rc.Close() })

	return NewSessionHandler(rc), mr
}

func TestCreateSession(t *testing.T) {
	sh, mr := setupSessionTest(t)

	t.Run("success", func(t *testing.T) {
		body := `{"stallId":"stall-1","eventId":"event-1","vendorCategoryId":"cat-1","vendorTypeId":"type-1","vendorType":"entry"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/session", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()

		sh.CreateSession(rec, req)

		if rec.Code != http.StatusCreated {
			t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			Token string `json:"token"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if len(resp.Token) != 64 {
			t.Fatalf("expected 64-char token, got %d chars", len(resp.Token))
		}

		// Verify session stored in Redis
		key := "session:" + resp.Token
		val, err := mr.Get(key)
		if err != nil {
			t.Fatalf("token not found in Redis: %v", err)
		}
		if val == "" {
			t.Fatal("session value is empty in Redis")
		}
	})

	t.Run("missing fields", func(t *testing.T) {
		body := `{"stallId":"stall-1"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/session", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()

		sh.CreateSession(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rec.Code)
		}

		var resp struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		json.Unmarshal(rec.Body.Bytes(), &resp)
		if resp.Error.Code != "missing_fields" {
			t.Fatalf("expected code 'missing_fields', got %q", resp.Error.Code)
		}
	})

	t.Run("empty body", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/session", strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()

		sh.CreateSession(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rec.Code)
		}
	})
}

func TestValidateSession(t *testing.T) {
	sh, _ := setupSessionTest(t)

	// First create a session
	body := `{"stallId":"stall-1","eventId":"event-1","vendorCategoryId":"cat-1","vendorTypeId":"type-1","vendorType":"entry"}`
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/session", strings.NewReader(body))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	sh.CreateSession(createRec, createReq)

	var createResp struct {
		Token string `json:"token"`
	}
	json.Unmarshal(createRec.Body.Bytes(), &createResp)
	token := createResp.Token

	t.Run("valid token", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/session", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()

		sh.ValidateSession(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp struct {
			StallID          string `json:"stallId"`
			EventID          string `json:"eventId"`
			VendorCategoryID string `json:"vendorCategoryId"`
			VendorTypeID     string `json:"vendorTypeId"`
		}
		json.Unmarshal(rec.Body.Bytes(), &resp)
		if resp.StallID != "stall-1" {
			t.Fatalf("expected stallId 'stall-1', got %q", resp.StallID)
		}
		if resp.EventID != "event-1" {
			t.Fatalf("expected eventId 'event-1', got %q", resp.EventID)
		}
	})

	t.Run("missing token", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/session", nil)
		rec := httptest.NewRecorder()

		sh.ValidateSession(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", rec.Code)
		}

		var resp struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		json.Unmarshal(rec.Body.Bytes(), &resp)
		if resp.Error.Code != "missing_token" {
			t.Fatalf("expected code 'missing_token', got %q", resp.Error.Code)
		}
	})

	t.Run("invalid token", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/session", nil)
		req.Header.Set("Authorization", "Bearer invalid-token-that-does-not-exist")
		rec := httptest.NewRecorder()

		sh.ValidateSession(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", rec.Code)
		}

		var resp struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		json.Unmarshal(rec.Body.Bytes(), &resp)
		if resp.Error.Code != "invalid_session" {
			t.Fatalf("expected code 'invalid_session', got %q", resp.Error.Code)
		}
	})
}

func TestRevokeSession(t *testing.T) {
	sh, _ := setupSessionTest(t)

	// Create a session first
	body := `{"stallId":"stall-1","eventId":"event-1","vendorCategoryId":"cat-1","vendorTypeId":"type-1","vendorType":"entry"}`
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/session", strings.NewReader(body))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	sh.CreateSession(createRec, createReq)

	var createResp struct {
		Token string `json:"token"`
	}
	json.Unmarshal(createRec.Body.Bytes(), &createResp)
	token := createResp.Token

	t.Run("revoke and verify invalidated", func(t *testing.T) {
		// Set up chi context with URL param
		r := chi.NewRouter()
		r.Delete("/api/v1/admin/session/{token}", sh.RevokeSession)

		req := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/session/"+token, nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusNoContent {
			t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
		}

		// Now validate should fail
		valReq := httptest.NewRequest(http.MethodGet, "/api/v1/session", nil)
		valReq.Header.Set("Authorization", "Bearer "+token)
		valRec := httptest.NewRecorder()
		sh.ValidateSession(valRec, valReq)

		if valRec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 after revoke, got %d", valRec.Code)
		}
	})
}

func TestGenerateSessionToken(t *testing.T) {
	// Test is in model package, but we can verify via create endpoint
	sh, _ := setupSessionTest(t)

	tokens := make(map[string]bool)
	for i := 0; i < 10; i++ {
		body := `{"stallId":"stall-1","eventId":"event-1","vendorCategoryId":"cat-1","vendorTypeId":"type-1","vendorType":"entry"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/session", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		sh.CreateSession(rec, req)

		var resp struct {
			Token string `json:"token"`
		}
		json.Unmarshal(rec.Body.Bytes(), &resp)

		if len(resp.Token) != 64 {
			t.Fatalf("expected 64-char token, got %d", len(resp.Token))
		}
		if tokens[resp.Token] {
			t.Fatalf("duplicate token generated: %s", resp.Token)
		}
		tokens[resp.Token] = true
	}
}
