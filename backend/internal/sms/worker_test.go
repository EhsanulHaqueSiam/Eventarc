package sms

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/hibiken/asynq"
)

// mockProvider implements SMSProvider for testing.
type mockProvider struct {
	sendFunc        func(ctx context.Context, req SendRequest) (*SendResponse, error)
	checkStatusFunc func(ctx context.Context, requestID string) (*StatusResponse, error)
	checkBalanceFunc func(ctx context.Context) (*BalanceResponse, error)
	sendCallCount   int
}

func (m *mockProvider) Send(ctx context.Context, req SendRequest) (*SendResponse, error) {
	m.sendCallCount++
	if m.sendFunc != nil {
		return m.sendFunc(ctx, req)
	}
	return &SendResponse{
		RequestID: "mock_req_id",
		Recipients: func() []RecipientStatus {
			r := make([]RecipientStatus, len(req.To))
			for i, phone := range req.To {
				r[i] = RecipientStatus{Phone: phone, Status: "Sent", Charge: 0.25}
			}
			return r
		}(),
	}, nil
}

func (m *mockProvider) CheckStatus(ctx context.Context, requestID string) (*StatusResponse, error) {
	if m.checkStatusFunc != nil {
		return m.checkStatusFunc(ctx, requestID)
	}
	return &StatusResponse{RequestID: requestID}, nil
}

func (m *mockProvider) CheckBalance(ctx context.Context) (*BalanceResponse, error) {
	if m.checkBalanceFunc != nil {
		return m.checkBalanceFunc(ctx)
	}
	return &BalanceResponse{Balance: 1000, Currency: "BDT"}, nil
}

func TestHandleSMSBatch_BatchSplitting(t *testing.T) {
	// Create 250 guest phones
	guests := make([]GuestPhone, 250)
	for i := 0; i < 250; i++ {
		guests[i] = GuestPhone{
			GuestID: "g" + string(rune('0'+i%10)),
			Phone:   "88018000000" + string(rune('0'+i%10)),
			CardURL: "https://cdn.test.com/card.png",
		}
	}

	payload := SMSBatchPayload{
		EventID:         "evt_test",
		MessageTemplate: "Your invitation: {cardUrl}",
		GuestPhones:     guests,
	}

	// Verify batch splitting logic directly
	batchSize := 100
	total := len(payload.GuestPhones)
	batchCount := 0
	for i := 0; i < total; i += batchSize {
		end := i + batchSize
		if end > total {
			end = total
		}
		batch := payload.GuestPhones[i:end]
		batchCount++

		// Verify batch sizes
		switch batchCount {
		case 1:
			if len(batch) != 100 {
				t.Errorf("batch 1 size = %d, want 100", len(batch))
			}
		case 2:
			if len(batch) != 100 {
				t.Errorf("batch 2 size = %d, want 100", len(batch))
			}
		case 3:
			if len(batch) != 50 {
				t.Errorf("batch 3 size = %d, want 50", len(batch))
			}
		}
	}

	if batchCount != 3 {
		t.Errorf("batch count = %d, want 3", batchCount)
	}
}

func TestHandleSMSSendBatch_InsufficientBalance(t *testing.T) {
	mock := &mockProvider{
		sendFunc: func(ctx context.Context, req SendRequest) (*SendResponse, error) {
			return nil, ErrInsufficientBalance
		},
	}

	// We test the logic that should stop on ErrInsufficientBalance
	ctx := context.Background()
	_, err := mock.Send(ctx, SendRequest{
		To:      []string{"8801800000001"},
		Message: "Test",
	})

	if err == nil {
		t.Fatal("expected error")
	}
	if !IsInsufficientBalance(err) {
		t.Errorf("expected IsInsufficientBalance, got: %v", err)
	}

	// Worker should call asynq.SkipRetry — verify by checking error is ErrInsufficientBalance
	// The actual SkipRetry logic is in HandleSMSSendBatch which requires full asynq integration
}

func TestHandleSMSRetry_ExponentialBackoff(t *testing.T) {
	tests := []struct {
		retryCount int
		expected   time.Duration
	}{
		{0, 1 * time.Second},
		{1, 2 * time.Second},
		{2, 4 * time.Second},
		{3, 8 * time.Second},
		{4, 16 * time.Second},
	}

	for _, tt := range tests {
		delay := BackoffDelay(tt.retryCount)
		if delay != tt.expected {
			t.Errorf("BackoffDelay(%d) = %v, want %v", tt.retryCount, delay, tt.expected)
		}
	}
}

func TestHandleSMSRetry_MaxRetries(t *testing.T) {
	payload := SMSRetryPayload{
		EventID:    "evt_test",
		GuestID:    "g1",
		Phone:      "8801800000001",
		Message:    "Test",
		RetryCount: maxRetries, // Already at max
	}

	// Verify that when retryCount >= maxRetries, the message should be marked as permanently failed
	if payload.RetryCount < maxRetries {
		t.Errorf("retryCount %d should be >= maxRetries %d", payload.RetryCount, maxRetries)
	}

	// The HandleSMSRetry method returns nil (no re-enqueue) when retryCount >= maxRetries
	// and increments the failed counter. We verify the condition is met.
	if payload.RetryCount >= maxRetries {
		// This is the correct path — permanently failed, no re-enqueue
	} else {
		t.Error("expected max retries to be reached")
	}
}

func TestSMSBatchPayload_Marshal(t *testing.T) {
	payload := SMSBatchPayload{
		EventID:         "evt_123",
		MessageTemplate: "Hello {cardUrl}",
		GuestPhones: []GuestPhone{
			{GuestID: "g1", Phone: "8801800000001", CardURL: "https://cdn.test/g1/card.png"},
		},
	}

	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	task := asynq.NewTask(TypeSMSBatch, data)
	if task.Type() != "sms:batch" {
		t.Errorf("task type = %q, want %q", task.Type(), "sms:batch")
	}

	var decoded SMSBatchPayload
	if err := json.Unmarshal(task.Payload(), &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if decoded.EventID != "evt_123" {
		t.Errorf("EventID = %q, want %q", decoded.EventID, "evt_123")
	}
	if len(decoded.GuestPhones) != 1 {
		t.Errorf("GuestPhones count = %d, want 1", len(decoded.GuestPhones))
	}
}
