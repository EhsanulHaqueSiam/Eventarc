package sms

import (
	"context"
	"errors"
	"fmt"
)

// ErrInsufficientBalance indicates the SMS provider account does not have
// enough credits to send the requested messages.
var ErrInsufficientBalance = errors.New("sms: insufficient balance")

// APIError wraps a non-zero error code returned by the SMS provider API.
type APIError struct {
	Code    int
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("sms: API error %d: %s", e.Code, e.Message)
}

// SendRequest contains the data needed to send one or more SMS messages.
type SendRequest struct {
	To       []string // Phone numbers in 880XXXXXXXXX format
	Message  string   // SMS body text
	SenderID string   // Optional approved sender ID
}

// SendResponse contains the result of a send operation.
type SendResponse struct {
	RequestID  string
	Recipients []RecipientStatus
}

// RecipientStatus represents the delivery status of a single recipient.
type RecipientStatus struct {
	Phone  string
	Status string  // "Sent", "Failed", etc.
	Charge float64
}

// StatusResponse contains delivery status for a previously sent request.
type StatusResponse struct {
	RequestID  string
	Recipients []RecipientStatus
}

// BalanceResponse contains the current account balance.
type BalanceResponse struct {
	Balance  float64
	Currency string
}

// SMSProvider defines the interface for sending SMS messages.
// Implementations are swappable without code changes beyond the adapter.
type SMSProvider interface {
	// Send delivers SMS messages to the specified recipients.
	Send(ctx context.Context, req SendRequest) (*SendResponse, error)

	// CheckStatus queries delivery status for a previously sent request.
	CheckStatus(ctx context.Context, requestID string) (*StatusResponse, error)

	// CheckBalance returns the current account balance.
	CheckBalance(ctx context.Context) (*BalanceResponse, error)
}
