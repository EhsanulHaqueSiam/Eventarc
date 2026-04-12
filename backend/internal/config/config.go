package config

import "os"

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
	// Convex integration
	ConvexURL             string // URL for Convex HTTP API
	ConvexDeploymentToken string // Auth token for Convex admin API
}

// Load reads configuration from environment variables with sensible defaults.
func Load() *Config {
	return &Config{
		Port:              getEnv("PORT", "8080"),
		Env:               getEnv("ENV", "development"),
		DatabaseURL:       getEnv("DATABASE_URL", "postgres://eventarc:dev_password@localhost:6432/eventarc?sslmode=disable"),
		RedisURL:          getEnv("REDIS_URL", "redis://localhost:6379"),
		HMACSecret:        getEnv("HMAC_SECRET", ""),
		R2AccountID:       getEnv("R2_ACCOUNT_ID", ""),
		R2AccessKeyID:     getEnv("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey: getEnv("R2_SECRET_ACCESS_KEY", ""),
		R2BucketName:          getEnv("R2_BUCKET_NAME", "eventarc-qr"),
		R2PublicURL:           getEnv("R2_PUBLIC_URL", ""),
		ConvexURL:             getEnv("CONVEX_URL", ""),
		ConvexDeploymentToken: getEnv("CONVEX_DEPLOYMENT_TOKEN", ""),
	}
}

// IsProduction returns true when the environment is set to production.
func (c *Config) IsProduction() bool {
	return c.Env == "production"
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
