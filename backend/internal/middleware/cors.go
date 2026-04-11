package middleware

import (
	"net/http"
	"os"
	"strings"
)

// CORS returns middleware that handles Cross-Origin Resource Sharing headers.
// In development, all origins are allowed. In production, only origins from
// the ALLOWED_ORIGINS environment variable are permitted.
func CORS(env string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")

			if env == "production" {
				allowedOrigins := os.Getenv("ALLOWED_ORIGINS")
				if allowedOrigins != "" && origin != "" {
					allowed := false
					for _, o := range strings.Split(allowedOrigins, ",") {
						if strings.TrimSpace(o) == origin {
							allowed = true
							break
						}
					}
					if allowed {
						w.Header().Set("Access-Control-Allow-Origin", origin)
					}
				}
			} else {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			}

			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Signature, X-Timestamp")
			w.Header().Set("Access-Control-Max-Age", "300")

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
