import {
  createRootRoute,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { AppShell } from "@/components/layout/app-shell";
import { useEffect } from "react";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const user = useQuery(api.auth.getCurrentUser);
  const location = useLocation();
  const navigate = useNavigate();
  const isLoginPage = location.pathname === "/login";

  useEffect(() => {
    if (user === null && !isLoginPage) {
      navigate({ to: "/login" });
    }
  }, [user, isLoginPage, navigate]);

  // On login page, render without shell
  if (isLoginPage) {
    return (
      <div className="min-h-screen bg-background">
        <Outlet />
      </div>
    );
  }

  // Loading state
  if (user === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
