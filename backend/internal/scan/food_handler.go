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

// HandleFoodScan returns an HTTP handler for POST /api/v1/scan/food.
// It decodes the JSON request body, calls Service.ProcessFoodScan,
// and returns the appropriate HTTP status and JSON response.
//
// Status codes:
//
//	200 - Valid food scan (consumption allowed) OR limit reached (business response, not error)
//	400 - Malformed request body or invalid QR payload format
//	401 - Invalid HMAC signature (forged QR)
//	404 - Guest/token not found in cache
//	422 - Wrong QR type (entry QR at food stall)
//	500 - Internal server error (Redis/PG connectivity, event not synced)
func HandleFoodScan(svc *Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Decode JSON body
		var req FoodScanRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErrorJSON(w, http.StatusBadRequest, "BAD_REQUEST", "Invalid request body")
			return
		}

		// Validate required fields
		if req.QRPayload == "" {
			writeErrorJSON(w, http.StatusBadRequest, "BAD_REQUEST", "Missing required field: qr_payload")
			return
		}
		if req.StallID == "" {
			writeErrorJSON(w, http.StatusBadRequest, "BAD_REQUEST", "Missing required field: stall_id")
			return
		}
		if req.DeviceID == "" {
			writeErrorJSON(w, http.StatusBadRequest, "BAD_REQUEST", "Missing required field: device_id")
			return
		}
		if req.FoodCategoryID == "" {
			writeErrorJSON(w, http.StatusBadRequest, "BAD_REQUEST", "Missing required field: food_category_id")
			return
		}

		// Process the food scan
		result, err := svc.ProcessFoodScan(r.Context(), req)
		if err != nil {
			handleFoodScanError(w, r, err)
			return
		}

		// Return response — both valid and limit_reached are HTTP 200
		requestID := chimw.GetReqID(r.Context())
		slog.Info("food scan processed",
			"status", result.Status,
			"stall_id", req.StallID,
			"food_category_id", req.FoodCategoryID,
			"request_id", requestID,
		)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(result)
	}
}

// handleFoodScanError maps food scan service errors to HTTP status codes.
func handleFoodScanError(w http.ResponseWriter, r *http.Request, err error) {
	requestID := chimw.GetReqID(r.Context())

	switch {
	case errors.Is(err, qr.ErrInvalidPayload), errors.Is(err, qr.ErrUnsupportedVersion):
		slog.Warn("food scan rejected: invalid QR", "error", err, "request_id", requestID)
		writeErrorJSON(w, http.StatusBadRequest, "INVALID_QR", err.Error())

	case errors.Is(err, qr.ErrInvalidSignature):
		slog.Warn("food scan rejected: invalid signature", "error", err, "request_id", requestID)
		writeErrorJSON(w, http.StatusUnauthorized, "INVALID_SIGNATURE", "QR code signature verification failed")

	case errors.Is(err, model.ErrNotFound):
		slog.Warn("food scan rejected: not found", "error", err, "request_id", requestID)
		writeErrorJSON(w, http.StatusNotFound, "NOT_FOUND", "Guest or food rule not found")

	case errors.Is(err, qr.ErrInvalidQRType):
		slog.Warn("food scan rejected: wrong QR type", "error", err, "request_id", requestID)
		writeErrorJSON(w, http.StatusUnprocessableEntity, "WRONG_QR_TYPE", err.Error())

	default:
		slog.Error("food scan failed: internal error", "error", err, "request_id", requestID)
		writeErrorJSON(w, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal error occurred")
	}
}
