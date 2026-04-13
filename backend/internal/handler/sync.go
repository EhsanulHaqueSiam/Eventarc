package handler

import (
	"encoding/json"
	"net/http"

	"github.com/ehsanul-haque-siam/eventarc/internal/scan"
)

// HandleSyncEvent handles POST /api/v1/sync/event.
// It applies a full event dataset sync into Redis for low-latency scanner reads.
func HandleSyncEvent(svc *scan.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req scan.EventSyncRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON body")
			return
		}
		if req.EventID == "" {
			writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "event_id is required")
			return
		}
		if err := svc.SyncEventDataset(r.Context(), req); err != nil {
			writeError(w, http.StatusInternalServerError, "SYNC_FAILED", err.Error())
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}
}

// HandleFoodRulesSync handles POST /api/v1/sync/food-rules.
func HandleFoodRulesSync(svc *scan.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req scan.FoodRulesSyncRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON body")
			return
		}
		if req.EventID == "" {
			writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "event_id is required")
			return
		}
		if err := svc.SyncFoodRules(r.Context(), req.EventID, req.Rules); err != nil {
			writeError(w, http.StatusInternalServerError, "SYNC_FAILED", err.Error())
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}
}
