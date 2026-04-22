# Build stage
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

# Install root dependencies first (Convex generated types needed for build)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Install frontend dependencies
COPY frontend/package.json frontend/pnpm-lock.yaml* ./frontend/
RUN cd frontend && pnpm install --frozen-lockfile

# Copy Convex schema + generated types (imported by frontend)
COPY convex/ ./convex/

# Copy frontend source
COPY frontend/ ./frontend/

# Build args become VITE_ env vars at build time. Umami args are optional —
# frontend/src/lib/analytics.ts no-ops when they're unset.
ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL
ARG VITE_API_URL
ARG VITE_UMAMI_WEBSITE_ID
ARG VITE_UMAMI_SCRIPT_URL

RUN cd frontend && pnpm build

# Runtime stage — nginx-unprivileged runs fully as the non-root `nginx` user
# on port 8080 (no root master process). Traefik/Dokploy reach it via the
# internal network so binding :80 isn't needed.
FROM nginxinc/nginx-unprivileged:alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
