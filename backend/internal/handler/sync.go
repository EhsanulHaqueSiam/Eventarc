package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// HandleSyncEvent is a placeholder for the event sync endpoint.
// Full sync logic ships in Phase 4. Currently accepts POST requests
// and returns {"status":"accepted"}.
func HandleSyncEvent(w http.ResponseWriter, r *http.Request) {
	var body json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		slog.Warn("sync event: failed to decode body", "error", err)
	} else {
		slog.Info("sync event received", "body_size", len(body))
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status": "accepted",
	})
}
