import {
  createRootRoute,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import { AppShell } from "@/components/layout/app-shell";
import { ErrorFallback } from "@/components/error-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useRef } from "react";

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <ErrorFallback
        error={error instanceof Error ? error : new Error(String(error))}
        onRetry={() => window.location.reload()}
      />
    </div>
  ),
});

function RootLayout() {
  const user = useQuery(api.auth.getCurrentUser);
  const ensureCurrentUserProfile = useMutation(api.auth.ensureCurrentUserProfile);
  const profiledUserRef = useRef<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const isLoginPage = location.pathname === "/login";
  const isScannerPage =
    location.pathname === "/scanner" ||
    location.pathname.startsWith("/scanner/") ||
    /^\/[^/]+\/scanner\/?$/.test(location.pathname);

  useEffect(() => {
    if (user === null && !isLoginPage && !isScannerPage) {
      navigate({ to: "/login" });
    }
    if (user && isLoginPage) {
      navigate({ to: "/events" });
    }
  }, [user, isLoginPage, isScannerPage, navigate]);

  useEffect(() => {
    if (!user) {
      profiledUserRef.current = null;
      return;
    }
    const profileKey = user.email ?? user.name ?? "current-user";
    if (profiledUserRef.current === profileKey) {
      return;
    }
    profiledUserRef.current = profileKey;
    void ensureCurrentUserProfile().catch(() => {
      // Silent fallback: auth query/mutations will enforce access server-side.
    });
  }, [user, ensureCurrentUserProfile]);

  // On login page or scanner page, render without admin shell
  if (isLoginPage || isScannerPage) {
    return (
      <div className="min-h-screen bg-background">
        <Outlet />
      </div>
    );
  }

  // Loading or unauthenticated — don't render the app shell
  if (user === undefined || user === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="space-y-3 text-center">
          <Skeleton className="mx-auto h-6 w-32" />
          <Skeleton className="mx-auto h-4 w-20" />
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
