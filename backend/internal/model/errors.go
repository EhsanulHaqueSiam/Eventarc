package model

import "errors"

var (
	ErrNotFound         = errors.New("not found")
	ErrDuplicate        = errors.New("duplicate")
	ErrAlreadyCheckedIn = errors.New("already checked in")
	ErrLimitReached     = errors.New("limit reached")
	ErrInvalidState     = errors.New("invalid state transition")
	ErrUnauthorized     = errors.New("unauthorized")
)

// ErrorResponse is the standard JSON error envelope for API responses.
type ErrorResponse struct {
	Error ErrorDetail `json:"error"`
}

// ErrorDetail contains the error code, message, and optional details.
type ErrorDetail struct {
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Details interface{} `json:"details,omitempty"`
}
