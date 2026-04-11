package middleware

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/ehsanul-haque-siam/eventarc/internal/model"
)

// HMACAuth returns middleware that verifies HMAC-SHA256 signatures on incoming requests.
// It checks X-Signature and X-Timestamp headers, validates the timestamp is within
// 5 minutes, and verifies the HMAC signature covers timestamp + request body.
func HMACAuth(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			signature := r.Header.Get("X-Signature")
			timestamp := r.Header.Get("X-Timestamp")

			if signature == "" || timestamp == "" {
				writeAuthError(w, "Missing signature")
				return
			}

			// Parse and validate timestamp
			ts, err := time.Parse(time.RFC3339, timestamp)
			if err != nil {
				writeAuthError(w, "Invalid timestamp format")
				return
			}

			if time.Since(ts) > 5*time.Minute {
				writeAuthError(w, "Request expired")
				return
			}

			// Read body for signature verification
			body, err := io.ReadAll(r.Body)
			if err != nil {
				writeAuthError(w, "Failed to read request body")
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(body))

			// Compute expected HMAC-SHA256
			mac := hmac.New(sha256.New, []byte(secret))
			mac.Write([]byte(timestamp))
			mac.Write(body)
			expectedMAC := hex.EncodeToString(mac.Sum(nil))

			// Constant-time comparison
			if !hmac.Equal([]byte(expectedMAC), []byte(signature)) {
				writeAuthError(w, "Invalid signature")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func writeAuthError(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	json.NewEncoder(w).Encode(model.ErrorResponse{
		Error: model.ErrorDetail{
			Code:    "UNAUTHORIZED",
			Message: message,
		},
	})
}
