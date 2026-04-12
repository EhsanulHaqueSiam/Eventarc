package scan

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/ehsanul-haque-siam/eventarc/internal/model"
	"github.com/ehsanul-haque-siam/eventarc/internal/qr"
)

// HandleEntryScan returns an HTTP handler for POST /api/v1/scan/entry.
// It decodes the JSON request body, calls Service.ProcessEntryScan,
// and returns the appropriate HTTP status and JSON response.
//
// Status codes:
//
//	200 — Valid scan (new check-in)
//	409 — Duplicate scan (already checked in) — includes original_scan details
//	400 — Malformed request body or invalid QR payload format
//	401 — Invalid HMAC signature (forged QR)
//	404 — Guest not found in cache
//	422 — Wrong QR type (e.g., food QR at entry gate)
//	500 — Internal server error (Redis/PG connectivity)
func HandleEntryScan(svc *Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Decode JSON body
		var req ScanRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErrorJSON(w, http.StatusBadRequest, "BAD_REQUEST", "Invalid request body")
			return
		}

		// Validate required fields
		if req.QRPayload == "" {
			writeErrorJSON(w, http.StatusBadRequest, "BAD_REQUEST", "qr_payload is required")
			return
		}
		if req.StallID == "" {
			writeErrorJSON(w, http.StatusBadRequest, "BAD_REQUEST", "stall_id is required")
			return
		}
		if req.DeviceID == "" {
			writeErrorJSON(w, http.StatusBadRequest, "BAD_REQUEST", "device_id is required")
			return
		}

		// Process the scan
		result, err := svc.ProcessEntryScan(r.Context(), req)
		if err != nil {
			handleScanError(w, r, err)
			return
		}

		// Return response based on scan status
		requestID := chimw.GetReqID(r.Context())

		if result.Status == "duplicate" {
			slog.Info("scan processed",
				"status", result.Status,
				"request_id", requestID,
			)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(result)
			return
		}

		slog.Info("scan processed",
			"status", result.Status,
			"request_id", requestID,
		)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(result)
	}
}

// handleScanError maps service errors to HTTP status codes with structured JSON.
func handleScanError(w http.ResponseWriter, r *http.Request, err error) {
	requestID := chimw.GetReqID(r.Context())

	switch {
	case errors.Is(err, qr.ErrInvalidPayload), errors.Is(err, qr.ErrUnsupportedVersion):
		slog.Warn("scan rejected: invalid QR", "error", err, "request_id", requestID)
		writeErrorJSON(w, http.StatusBadRequest, "INVALID_QR", err.Error())

	case errors.Is(err, qr.ErrInvalidSignature):
		slog.Warn("scan rejected: invalid signature", "error", err, "request_id", requestID)
		writeErrorJSON(w, http.StatusUnauthorized, "INVALID_SIGNATURE", "QR code signature verification failed")

	case errors.Is(err, model.ErrNotFound):
		slog.Warn("scan rejected: guest not found", "error", err, "request_id", requestID)
		writeErrorJSON(w, http.StatusNotFound, "GUEST_NOT_FOUND", "Guest not found in system")

	case errors.Is(err, qr.ErrInvalidQRType):
		slog.Warn("scan rejected: wrong QR type", "error", err, "request_id", requestID)
		writeErrorJSON(w, http.StatusUnprocessableEntity, "WRONG_QR_TYPE", err.Error())

	default:
		slog.Error("scan failed: internal error", "error", err, "request_id", requestID)
		writeErrorJSON(w, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal error occurred")
	}
}

// writeErrorJSON writes a standardized error JSON response.
func writeErrorJSON(w http.ResponseWriter, statusCode int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(model.ErrorResponse{
		Error: model.ErrorDetail{
			Code:    code,
			Message: message,
		},
	})
}
