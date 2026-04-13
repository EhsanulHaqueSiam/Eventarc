package middleware

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

type cachedSession struct {
	valid     bool
	expiresAt time.Time
}

// AdminAuth returns middleware that validates admin sessions via the
// Better Auth session cookie. It forwards the cookie to the Convex
// deployment's /api/auth/get-session endpoint for validation, caching
// positive results for 30 seconds to avoid excessive round-trips.
//
// If the Convex auth endpoint is unreachable or returns an invalid
// session, the request is rejected with 401.
func AdminAuth(convexURL string) func(http.Handler) http.Handler {
	var mu sync.RWMutex
	cache := make(map[string]cachedSession)

	// httpClient with a short timeout for session validation calls.
	client := &http.Client{Timeout: 5 * time.Second}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie("better-auth.session_token")
			if err != nil || cookie.Value == "" {
				writeAdminAuthError(w, "Admin session required")
				return
			}

			token := cookie.Value

			// Check cache first
			mu.RLock()
			if cached, ok := cache[token]; ok && time.Now().Before(cached.expiresAt) {
				mu.RUnlock()
				if cached.valid {
					next.ServeHTTP(w, r)
					return
				}
				writeAdminAuthError(w, "Admin session required")
				return
			}
			mu.RUnlock()

			// Validate against Convex Better Auth endpoint
			valid := validateBetterAuthSession(client, convexURL, cookie)

			mu.Lock()
			cache[token] = cachedSession{
				valid:     valid,
				expiresAt: time.Now().Add(30 * time.Second),
			}
			mu.Unlock()

			if !valid {
				writeAdminAuthError(w, "Admin session required")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// validateBetterAuthSession calls the Better Auth get-session endpoint
// on the Convex deployment to check if the session cookie is valid.
func validateBetterAuthSession(client *http.Client, convexURL string, cookie *http.Cookie) bool {
	if convexURL == "" {
		return false
	}

	req, err := http.NewRequest("GET", convexURL+"/api/auth/get-session", nil)
	if err != nil {
		return false
	}
	req.AddCookie(cookie)

	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false
	}

	// Better Auth returns JSON with a "session" object when valid.
	var result struct {
		Session *json.RawMessage `json:"session"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false
	}

	return result.Session != nil
}

func writeAdminAuthError(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"error": map[string]string{
			"code":    "UNAUTHORIZED",
			"message": message,
		},
	})
}
