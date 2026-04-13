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

# Build args become VITE_ env vars at build time
ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL
ARG VITE_API_URL

RUN cd frontend && pnpm build

# Runtime stage — lightweight nginx to serve static SPA
FROM nginx:alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
