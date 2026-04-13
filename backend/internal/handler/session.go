package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/model"
)

// SessionHandler handles device session CRUD operations.
type SessionHandler struct {
	redis *redis.Client
}

// NewSessionHandler creates a SessionHandler with the given Redis client.
func NewSessionHandler(rc *redis.Client) *SessionHandler {
	return &SessionHandler{redis: rc}
}

type createSessionRequest struct {
	StallID          string `json:"stallId"`
	EventID          string `json:"eventId"`
	VendorCategoryID string `json:"vendorCategoryId"`
	VendorTypeID     string `json:"vendorTypeId"`
	VendorType       string `json:"vendorType"`
}

type createSessionResponse struct {
	Token string `json:"token"`
}

type validateSessionResponse struct {
	StallID          string    `json:"stallId"`
	EventID          string    `json:"eventId"`
	VendorCategoryID string    `json:"vendorCategoryId"`
	VendorTypeID     string    `json:"vendorTypeId"`
	VendorType       string    `json:"vendorType,omitempty"`
	CreatedAt        time.Time `json:"createdAt"`
}

// CreateSession handles POST /api/v1/session.
// Creates a new device session token stored in Redis.
func (h *SessionHandler) CreateSession(w http.ResponseWriter, r *http.Request) {
	var req createSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid request body")
		return
	}

	if req.StallID == "" || req.EventID == "" || req.VendorCategoryID == "" || req.VendorTypeID == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "All fields required: stallId, eventId, vendorCategoryId, vendorTypeId")
		return
	}
	if req.VendorType != "" && req.VendorType != "entry" && req.VendorType != "food" {
		writeError(w, http.StatusBadRequest, "invalid_vendor_type", "vendorType must be entry or food")
		return
	}

	token, err := model.GenerateSessionToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "token_error", "Failed to generate session token")
		return
	}

	session := model.DeviceSession{
		Token:            token,
		StallID:          req.StallID,
		EventID:          req.EventID,
		VendorCategoryID: req.VendorCategoryID,
		VendorTypeID:     req.VendorTypeID,
		VendorType:       req.VendorType,
		CreatedAt:        time.Now(),
	}

	data, err := json.Marshal(session)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "marshal_error", "Failed to marshal session")
		return
	}

	// Store in Redis with 48h TTL -- sessions auto-expire, cleaned up on event completion
	key := "session:" + token
	if err := h.redis.Set(r.Context(), key, data, 48*time.Hour).Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "redis_error", "Failed to store session")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(createSessionResponse{Token: token})
}

// ValidateSession handles GET /api/v1/session.
// Validates a session token from the Authorization: Bearer header.
func (h *SessionHandler) ValidateSession(w http.ResponseWriter, r *http.Request) {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
		writeError(w, http.StatusUnauthorized, "missing_token", "Session token required")
		return
	}

	token := strings.TrimPrefix(authHeader, "Bearer ")

	key := "session:" + token
	val, err := h.redis.Get(r.Context(), key).Result()
	if err == redis.Nil {
		writeError(w, http.StatusUnauthorized, "invalid_session", "Session expired or revoked")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "redis_error", "Failed to validate session")
		return
	}

	var session model.DeviceSession
	if err := json.Unmarshal([]byte(val), &session); err != nil {
		writeError(w, http.StatusInternalServerError, "unmarshal_error", "Failed to read session data")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(validateSessionResponse{
		StallID:          session.StallID,
		EventID:          session.EventID,
		VendorCategoryID: session.VendorCategoryID,
		VendorTypeID:     session.VendorTypeID,
		VendorType:       session.VendorType,
		CreatedAt:        session.CreatedAt,
	})
}

// RevokeSession handles DELETE /api/v1/admin/session/{token}.
// Removes a session from Redis (admin-only, HMAC-protected).
func (h *SessionHandler) RevokeSession(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if token == "" {
		writeError(w, http.StatusBadRequest, "missing_token", "Session token required in URL")
		return
	}

	key := "session:" + token
	h.redis.Del(r.Context(), key)

	w.WriteHeader(http.StatusNoContent)
}

// writeError is defined in qr.go and shared across all handlers in this package.
