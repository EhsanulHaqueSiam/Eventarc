package config

import "os"

// Config holds application configuration loaded from environment variables.
type Config struct {
	Port        string
	Env         string
	DatabaseURL string
	RedisURL    string
	HMACSecret  string
}

// Load reads configuration from environment variables with sensible defaults.
func Load() *Config {
	return &Config{
		Port:        getEnv("PORT", "8080"),
		Env:         getEnv("ENV", "development"),
		DatabaseURL: getEnv("DATABASE_URL", "postgres://eventarc:dev_password@localhost:6432/eventarc?sslmode=disable"),
		RedisURL:    getEnv("REDIS_URL", "redis://localhost:6379"),
		HMACSecret:  getEnv("HMAC_SECRET", ""),
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
