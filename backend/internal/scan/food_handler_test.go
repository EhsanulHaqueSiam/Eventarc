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

func newTestFoodHandler(t *testing.T) (http.HandlerFunc, *redis.Client) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	svc := NewService(rdb, nil, testSecret)
	return HandleFoodScan(svc), rdb
}

func postFoodScan(handler http.HandlerFunc, body interface{}) *httptest.ResponseRecorder {
	jsonBody, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/scan/food", bytes.NewReader(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	return w
}

func TestHandleFoodScan_ValidScan(t *testing.T) {
	handler, rdb := newTestFoodHandler(t)
	ctx := context.Background()
	guestID := "guest_hf_valid"

	seedEventConfig(t, rdb, testEventID, "guestLinked")
	seedTestGuest(t, rdb, testEventID, guestID, "Handler Food Valid", "cat_vip")
	rdb.HSet(ctx, "guest:"+testEventID+":"+guestID, "categoryLabel", "VIP")
	seedFoodRules(t, rdb, testEventID, map[string]int{
		"cat_vip:fcat_fuchka": 5,
	})

	payload := makeValidPayload(t, testEventID, guestID, qr.QRTypeFood)
	w := postFoodScan(handler, FoodScanRequest{
		QRPayload:      payload,
		StallID:        "stall_hf1",
		DeviceID:       "dev_hf1",
		FoodCategoryID: "fcat_fuchka",
	})

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result FoodScanResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if result.Status != "valid" {
		t.Errorf("expected status 'valid', got %q", result.Status)
	}
	if result.Consumption == nil {
		t.Fatal("expected consumption info")
	}
	if result.Consumption.Current != 1 {
		t.Errorf("expected current 1, got %d", result.Consumption.Current)
	}
}

func TestHandleFoodScan_LimitReached(t *testing.T) {
	handler, rdb := newTestFoodHandler(t)
	ctx := context.Background()
	guestID := "guest_hf_limit"

	seedEventConfig(t, rdb, testEventID, "guestLinked")
	seedTestGuest(t, rdb, testEventID, guestID, "Handler Limit", "cat_general")
	rdb.HSet(ctx, "guest:"+testEventID+":"+guestID, "categoryLabel", "General")
	seedFoodRules(t, rdb, testEventID, map[string]int{
		"cat_general:fcat_fuchka": 1,
	})

	// Pre-populate as already consumed
	rdb.HSet(ctx, "food:"+testEventID+":"+guestID, "fcat_fuchka", 1)
	rdb.LPush(ctx, "foodlog:"+testEventID+":"+guestID, "2026-04-12T14:30:00Z|stall_prev|Previous Stall")

	payload := makeValidPayload(t, testEventID, guestID, qr.QRTypeFood)
	w := postFoodScan(handler, FoodScanRequest{
		QRPayload:      payload,
		StallID:        "stall_hf2",
		DeviceID:       "dev_hf2",
		FoodCategoryID: "fcat_fuchka",
	})

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for limit_reached, got %d: %s", w.Code, w.Body.String())
	}

	var result FoodScanResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if result.Status != "limit_reached" {
		t.Errorf("expected status 'limit_reached', got %q", result.Status)
	}
	if len(result.History) == 0 {
		t.Error("expected history entries in limit_reached response")
	}
}

func TestHandleFoodScan_MissingFields(t *testing.T) {
	handler, _ := newTestFoodHandler(t)

	payload := makeValidPayload(t, testEventID, "guest_hf_fields", qr.QRTypeFood)

	// Missing food_category_id
	w := postFoodScan(handler, FoodScanRequest{
		QRPayload:      payload,
		StallID:        "stall_hf3",
		DeviceID:       "dev_hf3",
		FoodCategoryID: "",
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing food_category_id, got %d: %s", w.Code, w.Body.String())
	}

	var errResp model.ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
		t.Fatalf("failed to decode error: %v", err)
	}
	if errResp.Error.Code != "BAD_REQUEST" {
		t.Errorf("expected code 'BAD_REQUEST', got %q", errResp.Error.Code)
	}

	// Missing stall_id
	w2 := postFoodScan(handler, FoodScanRequest{
		QRPayload:      payload,
		StallID:        "",
		DeviceID:       "dev_hf3",
		FoodCategoryID: "fcat_fuchka",
	})
	if w2.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing stall_id, got %d", w2.Code)
	}

	// Missing device_id
	w3 := postFoodScan(handler, FoodScanRequest{
		QRPayload:      payload,
		StallID:        "stall_hf3",
		DeviceID:       "",
		FoodCategoryID: "fcat_fuchka",
	})
	if w3.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing device_id, got %d", w3.Code)
	}

	// Missing qr_payload
	w4 := postFoodScan(handler, FoodScanRequest{
		QRPayload:      "",
		StallID:        "stall_hf3",
		DeviceID:       "dev_hf3",
		FoodCategoryID: "fcat_fuchka",
	})
	if w4.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing qr_payload, got %d", w4.Code)
	}
}

func TestHandleFoodScan_InvalidQR(t *testing.T) {
	handler, _ := newTestFoodHandler(t)

	w := postFoodScan(handler, FoodScanRequest{
		QRPayload:      "not-a-valid-qr-payload-!!!",
		StallID:        "stall_hf4",
		DeviceID:       "dev_hf4",
		FoodCategoryID: "fcat_fuchka",
	})

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
	}

	var errResp model.ErrorResponse
	json.NewDecoder(w.Body).Decode(&errResp)
	if errResp.Error.Code != "INVALID_QR" {
		t.Errorf("expected code 'INVALID_QR', got %q", errResp.Error.Code)
	}
}

func TestHandleFoodScan_ForgedQR(t *testing.T) {
	handler, _ := newTestFoodHandler(t)

	// Encode with wrong secret
	p := qr.Payload{
		Version:   qr.PayloadVersion,
		QRType:    qr.QRTypeFood,
		EventID:   testEventID,
		GuestID:   "guest_hf_forged",
		Timestamp: time.Now().Unix(),
	}
	wrongSecret := []byte("wrong-secret-key-different-val!")
	encoded, _ := qr.EncodePayload(p, wrongSecret)

	w := postFoodScan(handler, FoodScanRequest{
		QRPayload:      encoded,
		StallID:        "stall_hf5",
		DeviceID:       "dev_hf5",
		FoodCategoryID: "fcat_fuchka",
	})

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d: %s", w.Code, w.Body.String())
	}

	var errResp model.ErrorResponse
	json.NewDecoder(w.Body).Decode(&errResp)
	if errResp.Error.Code != "INVALID_SIGNATURE" {
		t.Errorf("expected code 'INVALID_SIGNATURE', got %q", errResp.Error.Code)
	}
}

func TestHandleFoodScan_WrongQRType(t *testing.T) {
	handler, rdb := newTestFoodHandler(t)
	guestID := "guest_hf_wrongtype"

	seedEventConfig(t, rdb, testEventID, "guestLinked")
	seedTestGuest(t, rdb, testEventID, guestID, "Wrong Type Guest", "cat_vip")

	// Entry QR at food stall
	payload := makeValidPayload(t, testEventID, guestID, qr.QRTypeEntry)

	w := postFoodScan(handler, FoodScanRequest{
		QRPayload:      payload,
		StallID:        "stall_hf6",
		DeviceID:       "dev_hf6",
		FoodCategoryID: "fcat_fuchka",
	})

	if w.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422, got %d: %s", w.Code, w.Body.String())
	}

	var errResp model.ErrorResponse
	json.NewDecoder(w.Body).Decode(&errResp)
	if errResp.Error.Code != "WRONG_QR_TYPE" {
		t.Errorf("expected code 'WRONG_QR_TYPE', got %q", errResp.Error.Code)
	}
}

func TestHandleFoodScan_GuestNotFound(t *testing.T) {
	handler, rdb := newTestFoodHandler(t)

	seedEventConfig(t, rdb, testEventID, "guestLinked")
	// Guest NOT seeded

	payload := makeValidPayload(t, testEventID, "guest_hf_missing", qr.QRTypeFood)

	w := postFoodScan(handler, FoodScanRequest{
		QRPayload:      payload,
		StallID:        "stall_hf7",
		DeviceID:       "dev_hf7",
		FoodCategoryID: "fcat_fuchka",
	})

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}

	var errResp model.ErrorResponse
	json.NewDecoder(w.Body).Decode(&errResp)
	if errResp.Error.Code != "NOT_FOUND" {
		t.Errorf("expected code 'NOT_FOUND', got %q", errResp.Error.Code)
	}
}

func TestHandleFoodScan_InvalidBody(t *testing.T) {
	handler, _ := newTestFoodHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/scan/food", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}
