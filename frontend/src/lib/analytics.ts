// Umami analytics loader — no-op unless both env vars are set at build time.
// Umami's script auto-tracks pushState/replaceState, so TanStack Router
// navigation is covered without extra wiring.

declare global {
  interface Window {
    umami?: {
      track: (eventName?: string, data?: Record<string, unknown>) => void;
      identify: (id: string, data?: Record<string, unknown>) => void;
    };
  }
}

export function initAnalytics(): void {
  const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID;
  const scriptUrl = import.meta.env.VITE_UMAMI_SCRIPT_URL;

  if (!websiteId || !scriptUrl) return;
  if (document.querySelector("script[data-umami-loaded]")) return;

  const script = document.createElement("script");
  script.src = scriptUrl;
  script.async = true;
  script.defer = true;
  script.setAttribute("data-website-id", websiteId);
  script.setAttribute("data-umami-loaded", "true");
  // EventArc is an internal ops tool behind auth. Missing data on vendors
  // or admins with browser DNT on would defeat the purpose. Umami is
  // cookieless and collects no PII regardless.
  document.head.appendChild(script);
}

// Fire-and-forget event tracker. Safe to call before the script loads — it's
// a no-op in that window.
export function trackEvent(
  name: string,
  data?: Record<string, unknown>,
): void {
  window.umami?.track(name, data);
}
