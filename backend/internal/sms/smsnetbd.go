package sms

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// SMSNetBD implements the SMSProvider interface using the SMS.NET.BD API.
type SMSNetBD struct {
	apiKey     string
	senderID   string
	baseURL    string
	httpClient *http.Client
}

// Compile-time interface compliance check.
var _ SMSProvider = (*SMSNetBD)(nil)

// NewSMSNetBD creates an SMS.NET.BD provider client.
// If baseURL is empty, defaults to https://api.sms.net.bd.
func NewSMSNetBD(apiKey, senderID, baseURL string) *SMSNetBD {
	if baseURL == "" {
		baseURL = "https://api.sms.net.bd"
	}
	return &SMSNetBD{
		apiKey:   apiKey,
		senderID: senderID,
		baseURL:  strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// sendResponse is the raw JSON response from SMS.NET.BD /sendsms endpoint.
type sendResponse struct {
	Error int    `json:"error"`
	Msg   string `json:"msg"`
	Data  struct {
		RequestID  string `json:"request_id"`
		Recipients []struct {
			Number string  `json:"number"`
			Charge float64 `json:"charge"`
			Status string  `json:"status"`
		} `json:"recipients"`
	} `json:"data"`
}

// reportResponse is the raw JSON response from the report endpoint.
type reportResponse struct {
	Error int    `json:"error"`
	Msg   string `json:"msg"`
	Data  struct {
		RequestID  string `json:"request_id"`
		Recipients []struct {
			Number string  `json:"number"`
			Charge float64 `json:"charge"`
			Status string  `json:"status"`
		} `json:"recipients"`
	} `json:"data"`
}

// balanceResponse is the raw JSON response from the balance endpoint.
type balanceResponse struct {
	Error int    `json:"error"`
	Msg   string `json:"msg"`
	Data  struct {
		Balance  float64 `json:"balance"`
		Currency string  `json:"currency"`
	} `json:"data"`
}

// Send delivers SMS messages via the SMS.NET.BD API.
func (s *SMSNetBD) Send(ctx context.Context, req SendRequest) (*SendResponse, error) {
	params := url.Values{}
	params.Set("api_key", s.apiKey)
	params.Set("msg", req.Message)
	params.Set("to", strings.Join(req.To, ","))
	if req.SenderID != "" {
		params.Set("sender_id", req.SenderID)
	} else if s.senderID != "" {
		params.Set("sender_id", s.senderID)
	}

	endpoint := fmt.Sprintf("%s/sendsms", s.baseURL)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(params.Encode()))
	if err != nil {
		return nil, fmt.Errorf("sms: failed to create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("sms: request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("sms: failed to read response: %w", err)
	}

	var result sendResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("sms: failed to parse response: %w", err)
	}

	// Handle error codes
	if result.Error != 0 {
		if result.Error == 416 {
			return nil, fmt.Errorf("%w: %s", ErrInsufficientBalance, result.Msg)
		}
		return nil, &APIError{Code: result.Error, Message: result.Msg}
	}

	// Map response
	recipients := make([]RecipientStatus, len(result.Data.Recipients))
	for i, r := range result.Data.Recipients {
		recipients[i] = RecipientStatus{
			Phone:  r.Number,
			Status: r.Status,
			Charge: r.Charge,
		}
	}

	return &SendResponse{
		RequestID:  result.Data.RequestID,
		Recipients: recipients,
	}, nil
}

// CheckStatus queries delivery status for a previously sent request.
func (s *SMSNetBD) CheckStatus(ctx context.Context, requestID string) (*StatusResponse, error) {
	endpoint := fmt.Sprintf("%s/report/request/%s/", s.baseURL, requestID)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("sms: failed to create status request: %w", err)
	}

	q := httpReq.URL.Query()
	q.Set("api_key", s.apiKey)
	httpReq.URL.RawQuery = q.Encode()

	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("sms: status request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("sms: failed to read status response: %w", err)
	}

	var result reportResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("sms: failed to parse status response: %w", err)
	}

	if result.Error != 0 {
		return nil, &APIError{Code: result.Error, Message: result.Msg}
	}

	recipients := make([]RecipientStatus, len(result.Data.Recipients))
	for i, r := range result.Data.Recipients {
		recipients[i] = RecipientStatus{
			Phone:  r.Number,
			Status: r.Status,
			Charge: r.Charge,
		}
	}

	return &StatusResponse{
		RequestID:  result.Data.RequestID,
		Recipients: recipients,
	}, nil
}

// CheckBalance returns the current SMS.NET.BD account balance.
func (s *SMSNetBD) CheckBalance(ctx context.Context) (*BalanceResponse, error) {
	endpoint := fmt.Sprintf("%s/user/balance/", s.baseURL)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("sms: failed to create balance request: %w", err)
	}

	q := httpReq.URL.Query()
	q.Set("api_key", s.apiKey)
	httpReq.URL.RawQuery = q.Encode()

	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("sms: balance request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("sms: failed to read balance response: %w", err)
	}

	var result balanceResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("sms: failed to parse balance response: %w", err)
	}

	if result.Error != 0 {
		return nil, &APIError{Code: result.Error, Message: result.Msg}
	}

	return &BalanceResponse{
		Balance:  result.Data.Balance,
		Currency: result.Data.Currency,
	}, nil
}

// IsInsufficientBalance checks if an error is an insufficient balance error.
func IsInsufficientBalance(err error) bool {
	return errors.Is(err, ErrInsufficientBalance)
}
