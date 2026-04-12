# Build stage
FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .

# Build server binary
RUN CGO_ENABLED=0 GOOS=linux go build -o /server ./cmd/server

# Build worker binary
RUN CGO_ENABLED=0 GOOS=linux go build -o /worker ./cmd/worker

# Server runtime
FROM alpine:3.21 AS server
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /server /server
COPY --from=builder /app/migrations/ /migrations/
EXPOSE 8080
CMD ["/server"]

# Worker runtime
FROM alpine:3.21 AS worker
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /worker /worker
CMD ["/worker"]
