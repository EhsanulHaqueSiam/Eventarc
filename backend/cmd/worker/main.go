package main

import (
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"context"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/config"
	"github.com/ehsanul-haque-siam/eventarc/internal/r2"
	"github.com/ehsanul-haque-siam/eventarc/internal/scan"
	"github.com/ehsanul-haque-siam/eventarc/internal/worker"
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
	logger := slog.New(logHandler)
	slog.SetDefault(logger)

	// Parse Redis address from URL
	redisAddr := parseRedisAddr(cfg.RedisURL)

	// Create Redis client for progress tracking
	redisOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		logger.Error("failed to parse Redis URL", "error", err)
		os.Exit(1)
	}
	redisClient := redis.NewClient(redisOpts)

	// Create asynq client for enqueuing fan-out tasks
	asynqClient := asynq.NewClient(asynq.RedisClientOpt{Addr: redisAddr})
	defer asynqClient.Close()

	// Connect to PostgreSQL
	pgPool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		logger.Error("failed to create PostgreSQL pool", "error", err)
		os.Exit(1)
	}
	defer pgPool.Close()

	// Create scan PG store for background write tasks
	scanPGStore := scan.NewPGStore(pgPool)

	// Create R2 storage client
	r2Client, err := r2.NewClient(
		cfg.R2AccountID,
		cfg.R2AccessKeyID,
		cfg.R2SecretAccessKey,
		cfg.R2BucketName,
		cfg.R2PublicURL,
	)
	if err != nil {
		logger.Error("failed to create R2 client", "error", err)
		os.Exit(1)
	}

	// Create QR handler with all dependencies
	qrHandler := worker.NewQRHandler(r2Client, redisClient, asynqClient, cfg.HMACSecret, logger)

	// Configure asynq server
	srv := asynq.NewServer(
		asynq.RedisClientOpt{Addr: redisAddr},
		asynq.Config{
			Concurrency: 10,
			Queues: map[string]int{
				"critical":    6,
				"pg-writes":   4,
				"convex-sync": 2,
				"default":     3,
				"low":         1,
			},
			Logger: newAsynqLogger(logger),
		},
	)

	// Register task handlers
	mux := asynq.NewServeMux()
	mux.HandleFunc(worker.TaskQRGenerateBatch, qrHandler.HandleGenerateBatch)
	mux.HandleFunc(worker.TaskQRGenerateSingle, qrHandler.HandleGenerateSingle)
	mux.HandleFunc(scan.TaskPGWrite, scan.HandlePGWrite(scanPGStore))
	mux.HandleFunc(scan.TaskConvexSync, scan.HandleConvexSync())

	// Start worker in goroutine
	go func() {
		logger.Info("worker starting", "concurrency", 10)
		if err := srv.Start(mux); err != nil {
			logger.Error("worker failed to start", "error", err)
			os.Exit(1)
		}
	}()

	// Graceful shutdown on SIGTERM/SIGINT
	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)

	<-done
	logger.Info("worker shutting down")
	srv.Shutdown()
	logger.Info("worker stopped")
}

// parseRedisAddr extracts the host:port from a Redis URL string.
func parseRedisAddr(redisURL string) string {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return "localhost:6379"
	}
	return opts.Addr
}

// asynqLogger adapts slog to asynq's Logger interface.
type asynqLogger struct {
	logger *slog.Logger
}

func newAsynqLogger(logger *slog.Logger) *asynqLogger {
	return &asynqLogger{logger: logger}
}

func (l *asynqLogger) Debug(args ...interface{}) {
	l.logger.Debug("asynq", "msg", args)
}

func (l *asynqLogger) Info(args ...interface{}) {
	l.logger.Info("asynq", "msg", args)
}

func (l *asynqLogger) Warn(args ...interface{}) {
	l.logger.Warn("asynq", "msg", args)
}

func (l *asynqLogger) Error(args ...interface{}) {
	l.logger.Error("asynq", "msg", args)
}

func (l *asynqLogger) Fatal(args ...interface{}) {
	l.logger.Error("asynq fatal", "msg", args)
	os.Exit(1)
}
