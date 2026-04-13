package scan

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/model"
	"github.com/ehsanul-haque-siam/eventarc/internal/qr"
)

func newTestHandler(t *testing.T) (http.HandlerFunc, *redis.Client) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	svc := NewService(rdb, nil, testSecret)
	return HandleEntryScan(svc), rdb
}

func seedScannerSession(t *testing.T, rdb *redis.Client, eventID, stallID, vendorCategoryID, vendorType string) string {
	t.Helper()
	token := "test-session-token-" + vendorType + "-" + stallID
	session := model.DeviceSession{
		Token:            token,
		StallID:          stallID,
		EventID:          eventID,
		VendorCategoryID: vendorCategoryID,
		VendorTypeID:     "type_test",
		VendorType:       vendorType,
		CreatedAt:        time.Now().UTC(),
	}
	raw, err := json.Marshal(session)
	if err != nil {
		t.Fatalf("marshal session: %v", err)
	}
	if err := rdb.Set(context.Background(), "session:"+token, raw, time.Hour).Err(); err != nil {
		t.Fatalf("seed session: %v", err)
	}
	return token
}

func postScan(handler http.HandlerFunc, body interface{}, sessionToken string) *httptest.ResponseRecorder {
	jsonBody, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/scan/entry", bytes.NewReader(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	if sessionToken != "" {
		req.Header.Set("Authorization", "Bearer "+sessionToken)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	return w
}

func TestHandleEntryScan_200_ValidScan(t *testing.T) {
	handler, rdb := newTestHandler(t)
	guestID := "guest_h_valid"
	seedTestGuest(t, rdb, testEventID, guestID, "Handler Valid", "vip")
	sessionToken := seedScannerSession(t, rdb, testEventID, "stall_h1", "cat_h1", "entry")

	payload := makeValidPayload(t, testEventID, guestID, qr.QRTypeEntry)
	w := postScan(handler, ScanRequest{
		QRPayload: payload,
	}, sessionToken)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result ScanResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if result.Status != "valid" {
		t.Errorf("expected status 'valid', got %q", result.Status)
	}
	if result.Guest == nil || result.Guest.Name != "Handler Valid" {
		t.Errorf("expected guest name 'Handler Valid', got %v", result.Guest)
	}
}

func TestHandleEntryScan_409_DuplicateScan(t *testing.T) {
	handler, rdb := newTestHandler(t)
	guestID := "guest_h_dup"
	seedTestGuest(t, rdb, testEventID, guestID, "Handler Dup", "regular")
	sessionToken := seedScannerSession(t, rdb, testEventID, "stall_h2", "cat_h2", "entry")

	payload := makeValidPayload(t, testEventID, guestID, qr.QRTypeEntry)
	req := ScanRequest{QRPayload: payload}

	// First scan
	w1 := postScan(handler, req, sessionToken)
	if w1.Code != http.StatusOK {
		t.Fatalf("first scan expected 200, got %d", w1.Code)
	}

	// Second scan — duplicate
	w2 := postScan(handler, req, sessionToken)
	if w2.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d: %s", w2.Code, w2.Body.String())
	}

	var result ScanResult
	if err := json.NewDecoder(w2.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if result.Status != "duplicate" {
		t.Errorf("expected status 'duplicate', got %q", result.Status)
	}
	if result.Original == nil {
		t.Error("expected original_scan in duplicate response")
	}
}

func TestHandleEntryScan_400_EmptyPayload(t *testing.T) {
	handler, _ := newTestHandler(t)

	w := postScan(handler, ScanRequest{
		QRPayload: "",
	}, "")

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
	}

	var errResp model.ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
		t.Fatalf("failed to decode error: %v", err)
	}
	if errResp.Error.Code != "BAD_REQUEST" {
		t.Errorf("expected code 'BAD_REQUEST', got %q", errResp.Error.Code)
	}
}

func TestHandleEntryScan_401_MissingSessionToken(t *testing.T) {
	handler, _ := newTestHandler(t)

	payload := makeValidPayload(t, testEventID, "guest_missing_fields", qr.QRTypeEntry)

	w := postScan(handler, ScanRequest{
		QRPayload: payload,
	}, "")
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for missing session token, got %d", w.Code)
	}
}

func TestHandleEntryScan_401_InvalidSignature(t *testing.T) {
	handler, rdb := newTestHandler(t)
	sessionToken := seedScannerSession(t, rdb, testEventID, "stall_h5", "cat_h5", "entry")

	// Encode with wrong secret
	p := qr.Payload{
		Version:   qr.PayloadVersion,
		QRType:    qr.QRTypeEntry,
		EventID:   testEventID,
		GuestID:   "guest_h_sig",
		Timestamp: time.Now().Unix(),
	}
	wrongSecret := []byte("wrong-secret-key-different-val!")
	encoded, _ := qr.EncodePayload(p, wrongSecret)

	w := postScan(handler, ScanRequest{
		QRPayload: encoded,
	}, sessionToken)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d: %s", w.Code, w.Body.String())
	}

	var errResp model.ErrorResponse
	json.NewDecoder(w.Body).Decode(&errResp)
	if errResp.Error.Code != "INVALID_SIGNATURE" {
		t.Errorf("expected code 'INVALID_SIGNATURE', got %q", errResp.Error.Code)
	}
}

func TestHandleEntryScan_404_GuestNotFound(t *testing.T) {
	handler, rdb := newTestHandler(t)
	sessionToken := seedScannerSession(t, rdb, testEventID, "stall_h6", "cat_h6", "entry")

	// Valid HMAC but guest not seeded
	payload := makeValidPayload(t, testEventID, "guest_h_missing", qr.QRTypeEntry)

	w := postScan(handler, ScanRequest{
		QRPayload: payload,
	}, sessionToken)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}

	var errResp model.ErrorResponse
	json.NewDecoder(w.Body).Decode(&errResp)
	if errResp.Error.Code != "GUEST_NOT_FOUND" {
		t.Errorf("expected code 'GUEST_NOT_FOUND', got %q", errResp.Error.Code)
	}
}

func TestHandleEntryScan_422_WrongQRType(t *testing.T) {
	handler, rdb := newTestHandler(t)
	guestID := "guest_h_food"
	seedTestGuest(t, rdb, testEventID, guestID, "Handler Food", "regular")
	sessionToken := seedScannerSession(t, rdb, testEventID, "stall_h7", "cat_h7", "entry")

	// Food QR at entry gate
	payload := makeValidPayload(t, testEventID, guestID, qr.QRTypeFood)

	w := postScan(handler, ScanRequest{
		QRPayload: payload,
	}, sessionToken)

	if w.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422, got %d: %s", w.Code, w.Body.String())
	}

	var errResp model.ErrorResponse
	json.NewDecoder(w.Body).Decode(&errResp)
	if errResp.Error.Code != "WRONG_QR_TYPE" {
		t.Errorf("expected code 'WRONG_QR_TYPE', got %q", errResp.Error.Code)
	}
}

func TestHandleEntryScan_400_InvalidBody(t *testing.T) {
	handler, _ := newTestHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/scan/entry", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// Silence unused import warning for context
var _ = context.Background
