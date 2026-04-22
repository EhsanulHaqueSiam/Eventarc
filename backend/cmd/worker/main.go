package main

import (
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"context"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/config"
	"github.com/ehsanul-haque-siam/eventarc/internal/convexsync"
	"github.com/ehsanul-haque-siam/eventarc/internal/r2"
	"github.com/ehsanul-haque-siam/eventarc/internal/scan"
	"github.com/ehsanul-haque-siam/eventarc/internal/sms"
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
	convexClient := convexsync.NewClient(cfg.ConvexURL, cfg.HMACSecret)

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
	workerConcurrency := getEnvInt("ASYNQ_CONCURRENCY", 64)
	queueCritical := getEnvInt("ASYNQ_QUEUE_CRITICAL", 6)
	queuePGWrites := getEnvInt("ASYNQ_QUEUE_PG_WRITES", 24)
	queueConvexSync := getEnvInt("ASYNQ_QUEUE_CONVEX_SYNC", 24)
	queueDefault := getEnvInt("ASYNQ_QUEUE_DEFAULT", 3)
	queueLow := getEnvInt("ASYNQ_QUEUE_LOW", 1)

	srv := asynq.NewServer(
		asynq.RedisClientOpt{Addr: redisAddr},
		asynq.Config{
			Concurrency: workerConcurrency,
			Queues: map[string]int{
				"critical":    queueCritical,
				"pg-writes":   queuePGWrites,
				"convex-sync": queueConvexSync,
				"default":     queueDefault,
				"low":         queueLow,
			},
			Logger: newAsynqLogger(logger),
		},
	)

	// SMS pipeline — only wired when a provider API key is configured.
	// The SMS worker syncs per-guest terminal status back to Convex so the
	// admin smsDeliveries view doesn't drift from Redis counters.
	var smsWorker *sms.SMSWorker
	if cfg.SMSProviderAPIKey != "" {
		smsProvider := sms.NewSMSNetBD(cfg.SMSProviderAPIKey, cfg.SMSProviderSenderID, cfg.SMSProviderBaseURL)
		smsWorker = sms.NewSMSWorker(smsProvider, redisClient, asynqClient)
		smsWorker.SetConvexClient(convexClient)
	}

	// Register task handlers
	mux := asynq.NewServeMux()
	mux.HandleFunc(worker.TaskQRGenerateBatch, qrHandler.HandleGenerateBatch)
	mux.HandleFunc(worker.TaskQRGenerateSingle, qrHandler.HandleGenerateSingle)
	mux.HandleFunc(scan.TaskPGWrite, scan.HandlePGWrite(scanPGStore))
	mux.HandleFunc(scan.TaskConvexSync, scan.HandleConvexSync(convexClient))
	mux.HandleFunc(scan.TaskFoodScanPGWrite, scan.HandleFoodScanPGWrite(pgPool))
	mux.HandleFunc(scan.TaskFoodScanConvexSync, scan.HandleFoodScanConvexSync(convexClient))
	if smsWorker != nil {
		mux.HandleFunc(sms.TypeSMSBatch, smsWorker.HandleSMSBatch)
		mux.HandleFunc(sms.TypeSMSSendBatch, smsWorker.HandleSMSSendBatch)
		mux.HandleFunc(sms.TypeSMSRetry, smsWorker.HandleSMSRetry)
		mux.HandleFunc(sms.TypeSMSStatusPoll, smsWorker.HandleSMSStatusPoll)
	} else {
		logger.Warn("SMS provider API key not set — SMS tasks will not be processed")
	}

	// Start worker in goroutine
	go func() {
		logger.Info("worker starting",
			"concurrency", workerConcurrency,
			"queue_critical", queueCritical,
			"queue_pg_writes", queuePGWrites,
			"queue_convex_sync", queueConvexSync,
			"queue_default", queueDefault,
			"queue_low", queueLow,
		)
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

func getEnvInt(name string, fallback int) int {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
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
