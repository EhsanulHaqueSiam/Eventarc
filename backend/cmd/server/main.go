package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/config"
	"github.com/ehsanul-haque-siam/eventarc/internal/handler"
	"github.com/ehsanul-haque-siam/eventarc/internal/middleware"
)

func main() {
	cfg := config.Load()

	// Configure structured logging
	var logHandler slog.Handler
	if cfg.IsProduction() {
		logHandler = slog.NewJSONHandler(os.Stdout, nil)
	} else {
		logHandler = slog.NewTextHandler(os.Stdout, nil)
	}
	slog.SetDefault(slog.New(logHandler))

	ctx := context.Background()

	// Connect to Redis
	redisOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		slog.Error("failed to parse Redis URL", "error", err)
		os.Exit(1)
	}
	redisClient := redis.NewClient(redisOpts)

	// Create asynq client for task enqueue
	asynqClient := asynq.NewClient(asynq.RedisClientOpt{Addr: parseRedisAddr(cfg.RedisURL)})
	defer asynqClient.Close()

	// Connect to PostgreSQL via PgBouncer
	pgPool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("failed to create PostgreSQL pool", "error", err)
		os.Exit(1)
	}
	defer pgPool.Close()

	// Build router
	r := chi.NewRouter()

	// Global middleware
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(middleware.Logger)
	r.Use(middleware.CORS(cfg.Env))

	// Public endpoints
	r.Get("/api/v1/health", handler.NewHealthHandler(redisClient, pgPool))

	// HMAC-protected endpoints
	r.Route("/api/v1/sync", func(r chi.Router) {
		r.Use(middleware.HMACAuth(cfg.HMACSecret))
		r.Post("/event", handler.HandleSyncEvent)
	})

	// QR generation endpoints (HMAC-protected)
	qrHandler := handler.NewQRHandler(asynqClient, redisClient, slog.Default())
	r.Route("/api/v1/qr", func(r chi.Router) {
		r.Use(middleware.HMACAuth(cfg.HMACSecret))
		r.Post("/generate", qrHandler.HandleTriggerGeneration)
		r.Get("/progress/{eventId}", qrHandler.HandleGetProgress)
	})

	// Create server
	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: r,
	}

	// Graceful shutdown
	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)

	go func() {
		slog.Info("server starting", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	<-done
	slog.Info("server shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("server shutdown error", "error", err)
	}

	slog.Info("server stopped")
}

// parseRedisAddr extracts the host:port from a Redis URL string.
func parseRedisAddr(redisURL string) string {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return "localhost:6379"
	}
	return opts.Addr
}
