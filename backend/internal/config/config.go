package config

import (
	"log"
	"os"
	"strings"
)

// Config holds application configuration loaded from environment variables.
type Config struct {
	Port        string
	Env         string
	DatabaseURL string
	RedisURL    string
	HMACSecret  string
	// Cloudflare R2 storage
	R2AccountID       string
	R2AccessKeyID     string
	R2SecretAccessKey string
	R2BucketName      string
	R2PublicURL       string // CDN base URL, e.g., "https://cdn.eventarc.app"
	// Scan processing
	ScanTimeout string // request timeout for scan endpoint (default "5s")
	// Convex integration
	ConvexURL string // URL for Convex HTTP actions — MUST be the *.convex.site host
	// SMS provider
	SMSProviderAPIKey   string // API key for SMS provider
	SMSProviderSenderID string // Approved sender ID (optional)
	SMSProviderBaseURL  string // Base URL for SMS API
}

// Load reads configuration from environment variables with sensible defaults.
func Load() *Config {
	return &Config{
		Port:                getEnv("PORT", "8080"),
		Env:                 getEnv("ENV", "development"),
		DatabaseURL:         getEnv("DATABASE_URL", "postgres://eventarc:dev_password@localhost:6432/eventarc?sslmode=disable"),
		RedisURL:            getEnv("REDIS_URL", "redis://localhost:6379"),
		HMACSecret:          getEnv("HMAC_SECRET", ""),
		R2AccountID:         getEnv("R2_ACCOUNT_ID", ""),
		R2AccessKeyID:       getEnv("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey:   getEnv("R2_SECRET_ACCESS_KEY", ""),
		R2BucketName:        getEnv("R2_BUCKET_NAME", "eventarc-qr"),
		R2PublicURL:         getEnv("R2_PUBLIC_URL", ""),
		ScanTimeout:         getEnv("SCAN_TIMEOUT", "5s"),
		ConvexURL:           getEnv("CONVEX_URL", ""),
		SMSProviderAPIKey:   getEnv("SMS_PROVIDER_API_KEY", ""),
		SMSProviderSenderID: getEnv("SMS_PROVIDER_SENDER_ID", ""),
		SMSProviderBaseURL:  getEnv("SMS_PROVIDER_BASE_URL", "https://api.sms.net.bd"),
	}
}

// IsProduction returns true when the environment is set to production.
func (c *Config) IsProduction() bool {
	return c.Env == "production"
}

// ValidateRequired checks that critical configuration values are present and
// valid. It calls log.Fatal (immediate process exit) if any check fails.
func (c *Config) ValidateRequired() {
	if len(c.HMACSecret) < 32 {
		log.Fatalf("FATAL: HMAC_SECRET must be set and at least 32 bytes (got %d bytes)", len(c.HMACSecret))
	}

	// Convex httpAction routes (/internal/sync/*) are served on *.convex.site.
	// Using the *.convex.cloud host returns silent 404s for every sync call,
	// breaking the Go→Convex writeback path. Fail fast with a clear message.
	if c.ConvexURL != "" && strings.Contains(c.ConvexURL, ".convex.cloud") {
		log.Fatalf("FATAL: CONVEX_URL must point to the .convex.site host (got %q). " +
			"Use https://<project>.convex.site — .convex.cloud is the client SDK endpoint, " +
			"not the HTTP actions endpoint the Go backend calls.", c.ConvexURL)
	}
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
