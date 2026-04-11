package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type healthResponse struct {
	Status   string `json:"status"`
	Redis    string `json:"redis"`
	Postgres string `json:"postgres"`
}

// NewHealthHandler returns an HTTP handler that checks Redis and PostgreSQL connectivity.
// Returns 200 with {"status":"ok"} if both are reachable, 503 otherwise.
func NewHealthHandler(redisClient *redis.Client, pgPool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()

		resp := healthResponse{
			Status:   "ok",
			Redis:    "connected",
			Postgres: "connected",
		}
		statusCode := http.StatusOK

		// Check Redis
		if redisClient != nil {
			if err := redisClient.Ping(ctx).Err(); err != nil {
				resp.Redis = "disconnected"
				resp.Status = "degraded"
				statusCode = http.StatusServiceUnavailable
			}
		} else {
			resp.Redis = "not configured"
			resp.Status = "degraded"
			statusCode = http.StatusServiceUnavailable
		}

		// Check PostgreSQL
		if pgPool != nil {
			if err := pgPool.Ping(ctx); err != nil {
				resp.Postgres = "disconnected"
				resp.Status = "degraded"
				statusCode = http.StatusServiceUnavailable
			}
		} else {
			resp.Postgres = "not configured"
			resp.Status = "degraded"
			statusCode = http.StatusServiceUnavailable
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(statusCode)
		json.NewEncoder(w).Encode(resp)
	}
}
