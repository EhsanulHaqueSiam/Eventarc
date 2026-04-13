package middleware

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

// RateLimit returns middleware that enforces IP-based rate limiting using
// Redis INCR with TTL. When the limit is exceeded, the request receives a
// 429 Too Many Requests response with a Retry-After header.
func RateLimit(redisClient *redis.Client, limit int, window time.Duration, prefix string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := extractIP(r)
			key := fmt.Sprintf("ratelimit:%s:%s", prefix, ip)

			ctx := r.Context()

			// Atomic increment
			count, err := redisClient.Incr(ctx, key).Result()
			if err != nil {
				// If Redis is down, allow the request through (fail-open)
				next.ServeHTTP(w, r)
				return
			}

			// Set expiry on first request in the window
			if count == 1 {
				redisClient.Expire(ctx, key, window)
			}

			if count > int64(limit) {
				ttl, _ := redisClient.TTL(ctx, key).Result()
				retryAfter := int(ttl.Seconds())
				if retryAfter <= 0 {
					retryAfter = int(window.Seconds())
				}

				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Retry-After", fmt.Sprintf("%d", retryAfter))
				w.WriteHeader(http.StatusTooManyRequests)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"error": map[string]string{
						"code":    "rate_limited",
						"message": "Too many requests. Try again later.",
					},
				})
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// extractIP returns the client IP from the request. chi's RealIP middleware
// sets r.RemoteAddr to the real client IP, so we just strip the port.
func extractIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
