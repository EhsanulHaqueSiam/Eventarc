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
	"github.com/ehsanul-haque-siam/eventarc/internal/convexsync"
	"github.com/ehsanul-haque-siam/eventarc/internal/handler"
	"github.com/ehsanul-haque-siam/eventarc/internal/middleware"
	"github.com/ehsanul-haque-siam/eventarc/internal/scan"
	"github.com/ehsanul-haque-siam/eventarc/internal/sse"
)

func main() {
	cfg := config.Load()
	cfg.ValidateRequired()

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

	// Public scanner endpoints (no HMAC — vendors have no credentials per VSCN-01)
	r.Route("/api/v1/session", func(r chi.Router) {
		sh := handler.NewSessionHandler(redisClient)
		r.With(middleware.RateLimit(redisClient, 10, time.Minute, "session")).Post("/", sh.CreateSession)
		r.Get("/", sh.ValidateSession)
	})
	// Admin-protected session management
	r.Route("/api/v1/admin/session", func(r chi.Router) {
		r.Use(middleware.HMACAuth(cfg.HMACSecret))
		sh := handler.NewSessionHandler(redisClient)
		r.Delete("/{token}", sh.RevokeSession)
	})

	// Scan processing (session token + QR payload HMAC validation)
	scanSvc := scan.NewService(redisClient, pgPool, []byte(cfg.HMACSecret))
	scanSvc.SetAsynqClient(asynqClient)
	scanSvc.SetConvexClient(convexsync.NewClient(cfg.ConvexURL, cfg.HMACSecret))

	recoveryCtx, cancelRecovery := context.WithTimeout(ctx, 20*time.Second)
	if err := scanSvc.RunStartupRecovery(recoveryCtx); err != nil {
		slog.Warn("startup drift recovery completed with errors", "error", err)
	}
	cancelRecovery()

	// HMAC-protected sync endpoints (Convex -> Go cache sync).
	r.Route("/api/v1/sync", func(r chi.Router) {
		r.Use(middleware.HMACAuth(cfg.HMACSecret))
		r.Post("/event", handler.HandleSyncEvent(scanSvc))
		r.Post("/food-rules", handler.HandleFoodRulesSync(scanSvc))
	})

	r.Route("/api/v1/scan", func(r chi.Router) {
		r.Post("/entry", scan.HandleEntryScan(scanSvc))
		r.Post("/food", scan.HandleFoodScan(scanSvc))
	})

	// QR generation endpoints (HMAC-protected)
	qrHandler := handler.NewQRHandler(asynqClient, redisClient, slog.Default())
	r.Route("/api/v1/qr", func(r chi.Router) {
		r.Use(middleware.HMACAuth(cfg.HMACSecret))
		r.Post("/generate", qrHandler.HandleTriggerGeneration)
		r.Get("/progress/{eventId}", qrHandler.HandleGetProgress)
	})

	// Card compositing endpoints (HMAC-protected)
	cardHandler := handler.NewCardHandler(asynqClient, redisClient)
	r.Route("/api/v1/events/{eventId}/cards", func(r chi.Router) {
		r.Use(middleware.HMACAuth(cfg.HMACSecret))
		r.Post("/composite", cardHandler.HandleCompositeCards)
		r.Get("/progress", cardHandler.HandleCompositeProgress)
	})

	// SMS delivery endpoints (HMAC-protected)
	smsHandler := handler.NewSMSHandler(asynqClient, redisClient)
	r.Route("/api/v1/events/{eventId}/sms", func(r chi.Router) {
		r.Use(middleware.HMACAuth(cfg.HMACSecret))
		r.Post("/send", smsHandler.HandleSendSMS)
		r.Get("/progress", smsHandler.HandleSMSProgress)
	})

	// Live dashboard SSE endpoint (admin auth via Better Auth session cookie)
	sseBroker := sse.NewSSEBroker()
	r.Route("/api/v1/events/{eventId}/live", func(r chi.Router) {
		r.Use(middleware.AdminAuth(cfg.ConvexURL))
		r.Get("/", sse.NewLiveHandler(sseBroker, redisClient))
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
