package sms

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

// TestSMSProvider_InterfaceCompliance verifies that *SMSNetBD satisfies the SMSProvider interface.
var _ SMSProvider = (*SMSNetBD)(nil)

func TestSMSNetBD_Send_Success(t *testing.T) {
	var receivedParams url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/sendsms" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		receivedParams = r.PostForm
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": 0,
			"msg":   "Request Accepted Successfully",
			"data": map[string]interface{}{
				"request_id": "req_abc123",
				"recipients": []map[string]interface{}{
					{"number": "8801800000001", "charge": 0.25, "status": "Sent"},
				},
			},
		})
	}))
	defer server.Close()

	provider := NewSMSNetBD("test-api-key", "TestSender", server.URL)
	resp, err := provider.Send(context.Background(), SendRequest{
		To:      []string{"8801800000001"},
		Message: "Hello from EventArc",
	})

	if err != nil {
		t.Fatalf("Send failed: %v", err)
	}

	// Verify request params
	if receivedParams.Get("api_key") != "test-api-key" {
		t.Errorf("api_key = %q, want %q", receivedParams.Get("api_key"), "test-api-key")
	}
	if receivedParams.Get("msg") != "Hello from EventArc" {
		t.Errorf("msg = %q, want %q", receivedParams.Get("msg"), "Hello from EventArc")
	}
	if receivedParams.Get("to") != "8801800000001" {
		t.Errorf("to = %q, want %q", receivedParams.Get("to"), "8801800000001")
	}
	if receivedParams.Get("sender_id") != "TestSender" {
		t.Errorf("sender_id = %q, want %q", receivedParams.Get("sender_id"), "TestSender")
	}

	// Verify response
	if resp.RequestID != "req_abc123" {
		t.Errorf("RequestID = %q, want %q", resp.RequestID, "req_abc123")
	}
	if len(resp.Recipients) != 1 {
		t.Fatalf("Recipients count = %d, want 1", len(resp.Recipients))
	}
	if resp.Recipients[0].Phone != "8801800000001" {
		t.Errorf("Phone = %q, want %q", resp.Recipients[0].Phone, "8801800000001")
	}
	if resp.Recipients[0].Status != "Sent" {
		t.Errorf("Status = %q, want %q", resp.Recipients[0].Status, "Sent")
	}
}

func TestSMSNetBD_Send_MultipleRecipients(t *testing.T) {
	var receivedTo string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		receivedTo = r.PostForm.Get("to")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": 0,
			"msg":   "OK",
			"data": map[string]interface{}{
				"request_id": "req_multi",
				"recipients": []map[string]interface{}{
					{"number": "8801800000001", "charge": 0.25, "status": "Sent"},
					{"number": "8801800000002", "charge": 0.25, "status": "Sent"},
					{"number": "8801800000003", "charge": 0.25, "status": "Sent"},
				},
			},
		})
	}))
	defer server.Close()

	provider := NewSMSNetBD("key", "", server.URL)
	resp, err := provider.Send(context.Background(), SendRequest{
		To:      []string{"8801800000001", "8801800000002", "8801800000003"},
		Message: "Test",
	})

	if err != nil {
		t.Fatalf("Send failed: %v", err)
	}

	// Verify comma-joined `to` parameter
	if receivedTo != "8801800000001,8801800000002,8801800000003" {
		t.Errorf("to = %q, want comma-joined numbers", receivedTo)
	}

	if len(resp.Recipients) != 3 {
		t.Errorf("Recipients count = %d, want 3", len(resp.Recipients))
	}
}

func TestSMSNetBD_Send_InsufficientBalance(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": 416,
			"msg":   "Insufficient balance",
		})
	}))
	defer server.Close()

	provider := NewSMSNetBD("key", "", server.URL)
	_, err := provider.Send(context.Background(), SendRequest{
		To:      []string{"8801800000001"},
		Message: "Test",
	})

	if err == nil {
		t.Fatal("expected error for insufficient balance")
	}
	if !errors.Is(err, ErrInsufficientBalance) {
		t.Errorf("expected ErrInsufficientBalance, got: %v", err)
	}
	if !IsInsufficientBalance(err) {
		t.Errorf("IsInsufficientBalance should return true")
	}
}

func TestSMSNetBD_Send_APIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": 403,
			"msg":   "Forbidden",
		})
	}))
	defer server.Close()

	provider := NewSMSNetBD("key", "", server.URL)
	_, err := provider.Send(context.Background(), SendRequest{
		To:      []string{"8801800000001"},
		Message: "Test",
	})

	if err == nil {
		t.Fatal("expected error for API error")
	}

	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected *APIError, got: %T", err)
	}
	if apiErr.Code != 403 {
		t.Errorf("Code = %d, want 403", apiErr.Code)
	}
}

func TestSMSNetBD_CheckStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/report/request/req_123/" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.URL.Query().Get("api_key") != "test-key" {
			t.Errorf("api_key = %q", r.URL.Query().Get("api_key"))
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": 0,
			"msg":   "OK",
			"data": map[string]interface{}{
				"request_id": "req_123",
				"recipients": []map[string]interface{}{
					{"number": "8801800000001", "charge": 0.25, "status": "Delivered"},
					{"number": "8801800000002", "charge": 0.25, "status": "Failed"},
				},
			},
		})
	}))
	defer server.Close()

	provider := NewSMSNetBD("test-key", "", server.URL)
	resp, err := provider.CheckStatus(context.Background(), "req_123")

	if err != nil {
		t.Fatalf("CheckStatus failed: %v", err)
	}

	if resp.RequestID != "req_123" {
		t.Errorf("RequestID = %q, want %q", resp.RequestID, "req_123")
	}
	if len(resp.Recipients) != 2 {
		t.Fatalf("Recipients count = %d, want 2", len(resp.Recipients))
	}
	if resp.Recipients[0].Status != "Delivered" {
		t.Errorf("Recipients[0].Status = %q, want %q", resp.Recipients[0].Status, "Delivered")
	}
	if resp.Recipients[1].Status != "Failed" {
		t.Errorf("Recipients[1].Status = %q, want %q", resp.Recipients[1].Status, "Failed")
	}
}

func TestSMSNetBD_CheckBalance(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/user/balance/" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": 0,
			"msg":   "OK",
			"data": map[string]interface{}{
				"balance":  1250.50,
				"currency": "BDT",
			},
		})
	}))
	defer server.Close()

	provider := NewSMSNetBD("key", "", server.URL)
	resp, err := provider.CheckBalance(context.Background())

	if err != nil {
		t.Fatalf("CheckBalance failed: %v", err)
	}

	if resp.Balance != 1250.50 {
		t.Errorf("Balance = %f, want %f", resp.Balance, 1250.50)
	}
	if resp.Currency != "BDT" {
		t.Errorf("Currency = %q, want %q", resp.Currency, "BDT")
	}
}
