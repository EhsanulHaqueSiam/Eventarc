import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "sonner";
import { convex } from "./lib/convex";
import { authClient } from "./lib/auth-client";
import { routeTree } from "./routeTree.gen";
import { initAnalytics } from "./lib/analytics";
import "./app.css";

initAnalytics();

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ConvexBetterAuthProvider client={convex} authClient={authClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster richColors position="bottom-right" />
        </TooltipProvider>
      </ConvexBetterAuthProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
