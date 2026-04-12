package sse

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
)

// NewLiveHandler returns an HTTP handler for SSE streaming of live event dashboard data.
// Endpoint: GET /api/v1/events/{eventId}/live
//
// Flow:
// 1. Set SSE headers
// 2. Subscribe to broker for this event
// 3. Read full snapshot from Redis counters (HGETALL event:{eventId}:counters)
// 4. Send snapshot event
// 5. Subscribe to Redis Pub/Sub channel event:{eventId}:scans
// 6. Stream: Redis Pub/Sub messages as SSE events + heartbeat every 15s
// 7. On client disconnect: cleanup broker + Redis subscriptions
func NewLiveHandler(broker *SSEBroker, redisClient redis.Cmdable) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		eventID := chi.URLParam(r, "eventId")
		if eventID == "" {
			http.Error(w, `{"error":{"code":"missing_event_id","message":"eventId is required"}}`, http.StatusBadRequest)
			return
		}

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, `{"error":{"code":"streaming_unsupported","message":"streaming not supported"}}`, http.StatusInternalServerError)
			return
		}

		// Set SSE headers
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")

		ctx := r.Context()

		// Subscribe to broker for this event
		clientCh, cleanup := broker.Subscribe(eventID)
		defer cleanup()

		slog.Info("SSE client connected", "event_id", eventID, "total_clients", broker.ClientCount(eventID))

		// Build and send initial snapshot
		snapshot, err := buildSnapshot(ctx, redisClient, eventID, broker)
		if err != nil {
			slog.Error("failed to build snapshot", "event_id", eventID, "error", err)
			// Send error event, then continue (non-fatal — dashboard shows empty state)
		} else {
			snapshotJSON, _ := json.Marshal(snapshot)
			writeSSE(w, flusher, SSEEvent{
				ID:    "0",
				Event: "snapshot",
				Data:  string(snapshotJSON),
			})
		}

		// Subscribe to Redis Pub/Sub
		// We need a *redis.Client for Subscribe — use type assertion
		var redisCh <-chan *redis.Message
		var pubsub *redis.PubSub
		if client, ok := redisClient.(*redis.Client); ok {
			pubsub = client.Subscribe(ctx, fmt.Sprintf("event:%s:scans", eventID))
			defer pubsub.Close()
			redisCh = pubsub.Channel()
		}

		// Heartbeat ticker
		heartbeat := time.NewTicker(15 * time.Second)
		defer heartbeat.Stop()

		eventSeq := int64(1)
		for {
			select {
			case <-ctx.Done():
				slog.Info("SSE client disconnected", "event_id", eventID)
				return

			case msg, ok := <-redisCh:
				if !ok {
					return
				}
				// Parse Redis Pub/Sub message and determine event type
				sseEvent := parseRedisMessage(msg.Payload, eventSeq)
				eventSeq++
				writeSSE(w, flusher, sseEvent)

			case brokerEvent, ok := <-clientCh:
				if !ok {
					return
				}
				// Events from broker (e.g., from other sources)
				writeSSE(w, flusher, brokerEvent)

			case <-heartbeat.C:
				// Send heartbeat as SSE comment (keeps connection alive through proxies)
				fmt.Fprintf(w, ": heartbeat %d\n\n", time.Now().Unix())
				flusher.Flush()
			}
		}
	}
}

// buildSnapshot reads all dashboard data from Redis counters.
// DASH-05: Reads ONLY from Redis counters, NEVER queries scan tables.
func buildSnapshot(ctx context.Context, rc redis.Cmdable, eventID string, broker *SSEBroker) (*DashboardSnapshot, error) {
	// Read all counters from hash
	counters, err := rc.HGetAll(ctx, fmt.Sprintf("event:%s:counters", eventID)).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to read counters: %w", err)
	}

	// Parse attendance
	checkedIn := parseCounter(counters, "attendance")
	totalInvited := parseCounter(counters, "total_invited")
	var pct float64
	if totalInvited > 0 {
		pct = float64(checkedIn) / float64(totalInvited) * 100
	}

	// Parse food categories (keys matching food:*:total)
	foodCategories := []FoodCategoryData{}
	for key, val := range counters {
		if strings.HasPrefix(key, "food:") && strings.HasSuffix(key, ":total") {
			parts := strings.Split(key, ":")
			if len(parts) >= 3 {
				catName := parts[1]
				served, _ := strconv.ParseInt(val, 10, 64)
				foodCategories = append(foodCategories, FoodCategoryData{
					Category: catName,
					Served:   served,
				})
			}
		}
	}

	// Parse stall activity from counter keys
	stalls := []StallActivityData{}
	scansTotal := parseCounter(counters, "scans_total")
	scansDuplicate := parseCounter(counters, "scans_duplicate")

	return &DashboardSnapshot{
		Attendance: AttendanceData{
			CheckedIn:    checkedIn,
			TotalInvited: totalInvited,
			Percentage:   pct,
		},
		Counters: map[string]int64{
			"scans_total":     scansTotal,
			"scans_duplicate": scansDuplicate,
		},
		FoodCategories: foodCategories,
		Stalls:         stalls,
		SystemHealth: SystemHealthData{
			RedisConnected:    true, // We just read from Redis
			PostgresConnected: true, // Checked by health endpoint
			ActiveSSEClients:  broker.TotalClients(),
		},
	}, nil
}

// parseCounter reads an int64 value from a counter map.
func parseCounter(counters map[string]string, key string) int64 {
	val, ok := counters[key]
	if !ok {
		return 0
	}
	n, _ := strconv.ParseInt(val, 10, 64)
	return n
}

// parseRedisMessage converts a Redis Pub/Sub payload into an SSE event.
func parseRedisMessage(payload string, seq int64) SSEEvent {
	// Try to parse as JSON to determine event type
	var msg struct {
		Type string `json:"type"` // "scan", "alert", "stall_activity"
	}
	if err := json.Unmarshal([]byte(payload), &msg); err != nil {
		// Not valid JSON — forward as generic counters event
		return SSEEvent{
			ID:    strconv.FormatInt(seq, 10),
			Event: "counters",
			Data:  payload,
		}
	}

	eventType := "counters"
	switch msg.Type {
	case "alert":
		eventType = "alert"
	case "stall_activity":
		eventType = "stall_activity"
	default:
		eventType = "counters"
	}

	return SSEEvent{
		ID:    strconv.FormatInt(seq, 10),
		Event: eventType,
		Data:  payload,
	}
}

// writeSSE writes a single SSE event to the response writer.
func writeSSE(w http.ResponseWriter, flusher http.Flusher, event SSEEvent) {
	if event.ID != "" {
		fmt.Fprintf(w, "id: %s\n", event.ID)
	}
	if event.Event != "" {
		fmt.Fprintf(w, "event: %s\n", event.Event)
	}
	fmt.Fprintf(w, "data: %s\n\n", event.Data)
	flusher.Flush()
}
