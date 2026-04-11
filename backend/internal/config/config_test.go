package config

import (
	"os"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	// Unset any env vars that might interfere
	os.Unsetenv("PORT")
	os.Unsetenv("ENV")
	os.Unsetenv("DATABASE_URL")
	os.Unsetenv("REDIS_URL")
	os.Unsetenv("HMAC_SECRET")

	cfg := Load()

	if cfg.Port != "8080" {
		t.Errorf("expected default Port 8080, got %s", cfg.Port)
	}
	if cfg.Env != "development" {
		t.Errorf("expected default Env development, got %s", cfg.Env)
	}
	if cfg.DatabaseURL != "postgres://eventarc:dev_password@localhost:6432/eventarc?sslmode=disable" {
		t.Errorf("unexpected default DatabaseURL: %s", cfg.DatabaseURL)
	}
	if cfg.RedisURL != "redis://localhost:6379" {
		t.Errorf("unexpected default RedisURL: %s", cfg.RedisURL)
	}
	if cfg.HMACSecret != "" {
		t.Errorf("expected empty default HMACSecret, got %s", cfg.HMACSecret)
	}
}

func TestLoadFromEnv(t *testing.T) {
	os.Setenv("PORT", "9090")
	os.Setenv("ENV", "production")
	os.Setenv("DATABASE_URL", "postgres://test:test@localhost:5432/test")
	os.Setenv("REDIS_URL", "redis://localhost:6380")
	os.Setenv("HMAC_SECRET", "test-secret")
	defer func() {
		os.Unsetenv("PORT")
		os.Unsetenv("ENV")
		os.Unsetenv("DATABASE_URL")
		os.Unsetenv("REDIS_URL")
		os.Unsetenv("HMAC_SECRET")
	}()

	cfg := Load()

	if cfg.Port != "9090" {
		t.Errorf("expected Port 9090, got %s", cfg.Port)
	}
	if cfg.Env != "production" {
		t.Errorf("expected Env production, got %s", cfg.Env)
	}
	if cfg.DatabaseURL != "postgres://test:test@localhost:5432/test" {
		t.Errorf("unexpected DatabaseURL: %s", cfg.DatabaseURL)
	}
	if cfg.RedisURL != "redis://localhost:6380" {
		t.Errorf("unexpected RedisURL: %s", cfg.RedisURL)
	}
	if cfg.HMACSecret != "test-secret" {
		t.Errorf("expected HMACSecret test-secret, got %s", cfg.HMACSecret)
	}
}

func TestIsProduction(t *testing.T) {
	cfg := &Config{Env: "production"}
	if !cfg.IsProduction() {
		t.Error("expected IsProduction() to return true for production")
	}

	cfg.Env = "development"
	if cfg.IsProduction() {
		t.Error("expected IsProduction() to return false for development")
	}

	cfg.Env = ""
	if cfg.IsProduction() {
		t.Error("expected IsProduction() to return false for empty string")
	}
}
