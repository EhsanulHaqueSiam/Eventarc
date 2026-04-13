package scan

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/model"
)

var (
	ErrSessionTokenMissing  = errors.New("session token missing")
	ErrInvalidSession       = errors.New("invalid session")
	ErrSessionScopeMismatch = errors.New("session scope mismatch")
)

// extractSessionToken reads session token from X-Session-Token or Authorization header.
func extractSessionToken(r *http.Request) string {
	if token := strings.TrimSpace(r.Header.Get("X-Session-Token")); token != "" {
		return token
	}
	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
	}
	return ""
}

func (s *Service) validateScanSession(
	ctx context.Context,
	token string,
	expectedVendorType string,
	stallID string,
	foodCategoryID string,
) (*model.DeviceSession, error) {
	if strings.TrimSpace(token) == "" {
		return nil, ErrSessionTokenMissing
	}

	key := "session:" + token
	raw, err := s.redis.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return nil, ErrInvalidSession
	}
	if err != nil {
		return nil, fmt.Errorf("session lookup failed: %w", err)
	}

	var session model.DeviceSession
	if err := json.Unmarshal([]byte(raw), &session); err != nil {
		return nil, fmt.Errorf("session decode failed: %w", err)
	}
	if session.Token == "" {
		session.Token = token
	}

	if session.EventID == "" || session.StallID == "" {
		return nil, ErrInvalidSession
	}
	if session.StallID != stallID {
		return nil, ErrSessionScopeMismatch
	}
	if expectedVendorType != "" &&
		session.VendorType != "" &&
		session.VendorType != expectedVendorType {
		return nil, ErrSessionScopeMismatch
	}
	if foodCategoryID != "" &&
		session.VendorCategoryID != "" &&
		session.VendorCategoryID != foodCategoryID {
		return nil, ErrSessionScopeMismatch
	}

	return &session, nil
}
