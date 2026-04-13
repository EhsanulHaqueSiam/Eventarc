/**
 * Returns the base URL for the Go backend API.
 * Checks VITE_API_URL first, then VITE_GO_API_URL, falls back to localhost:8080.
 */
export function getApiBaseUrl(): string {
  return (
    import.meta.env.VITE_API_URL ??
    import.meta.env.VITE_GO_API_URL ??
    "http://localhost:8080"
  );
}
