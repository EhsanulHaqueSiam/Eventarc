package middleware

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

const testSecret = "test-secret-key"

func signRequest(t *testing.T, secret, timestamp string, body []byte) string {
	t.Helper()
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func TestHMACAuthMissingSignature(t *testing.T) {
	handler := HMACAuth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("POST", "/test", bytes.NewReader([]byte(`{"data":"test"}`)))
	req.Header.Set("X-Timestamp", time.Now().UTC().Format(time.RFC3339))
	// No X-Signature header

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestHMACAuthMissingTimestamp(t *testing.T) {
	handler := HMACAuth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("POST", "/test", bytes.NewReader([]byte(`{"data":"test"}`)))
	req.Header.Set("X-Signature", "some-sig")
	// No X-Timestamp header

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestHMACAuthExpiredTimestamp(t *testing.T) {
	handler := HMACAuth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	body := []byte(`{"data":"test"}`)
	expired := time.Now().UTC().Add(-6 * time.Minute).Format(time.RFC3339)
	sig := signRequest(t, testSecret, expired, body)

	req := httptest.NewRequest("POST", "/test", bytes.NewReader(body))
	req.Header.Set("X-Signature", sig)
	req.Header.Set("X-Timestamp", expired)

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestHMACAuthInvalidSignature(t *testing.T) {
	handler := HMACAuth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	body := []byte(`{"data":"test"}`)
	ts := time.Now().UTC().Format(time.RFC3339)

	req := httptest.NewRequest("POST", "/test", bytes.NewReader(body))
	req.Header.Set("X-Signature", "deadbeef")
	req.Header.Set("X-Timestamp", ts)

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestHMACAuthValidSignature(t *testing.T) {
	handler := HMACAuth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}))

	body := []byte(`{"data":"test"}`)
	ts := time.Now().UTC().Format(time.RFC3339)
	sig := signRequest(t, testSecret, ts, body)

	req := httptest.NewRequest("POST", "/test", bytes.NewReader(body))
	req.Header.Set("X-Signature", sig)
	req.Header.Set("X-Timestamp", ts)

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestHMACAuthBodyReadableAfterValidation(t *testing.T) {
	var downstreamBody []byte
	handler := HMACAuth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var err error
		downstreamBody, err = io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("failed to read body downstream: %v", err)
		}
		w.WriteHeader(http.StatusOK)
	}))

	body := []byte(`{"data":"test"}`)
	ts := time.Now().UTC().Format(time.RFC3339)
	sig := signRequest(t, testSecret, ts, body)

	req := httptest.NewRequest("POST", "/test", bytes.NewReader(body))
	req.Header.Set("X-Signature", sig)
	req.Header.Set("X-Timestamp", ts)

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	if !bytes.Equal(downstreamBody, body) {
		t.Errorf("body not readable downstream: got %q, want %q", downstreamBody, body)
	}
}

func TestHMACAuthErrorResponseFormat(t *testing.T) {
	handler := HMACAuth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("POST", "/test", bytes.NewReader([]byte(`{}`)))
	// Missing both headers

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Header().Get("Content-Type") != "application/json" {
		t.Errorf("expected Content-Type application/json, got %s", rr.Header().Get("Content-Type"))
	}

	var errResp struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&errResp); err != nil {
		t.Fatalf("failed to decode error response: %v", err)
	}
	if errResp.Error.Code != "UNAUTHORIZED" {
		t.Errorf("expected error code UNAUTHORIZED, got %s", errResp.Error.Code)
	}
}
