package scan

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"time"
)

func (s *Service) publishCounterUpdate(ctx context.Context, eventID string, counterKeys ...string) {
	if s == nil || s.redis == nil || eventID == "" || len(counterKeys) == 0 {
		return
	}

	countersKey := CountersKey(eventID)
	values, err := s.redis.HMGet(ctx, countersKey, counterKeys...).Result()
	if err != nil {
		slog.Warn("failed to read counters for realtime publish", "event_id", eventID, "error", err)
		return
	}

	counters := make(map[string]int64, len(counterKeys))
	for i, key := range counterKeys {
		if i >= len(values) {
			continue
		}
		raw := values[i]
		if raw == nil {
			continue
		}
		switch v := raw.(type) {
		case string:
			n, parseErr := strconv.ParseInt(v, 10, 64)
			if parseErr == nil {
				counters[key] = n
			}
		case int64:
			counters[key] = v
		case int:
			counters[key] = int64(v)
		}
	}

	if len(counters) == 0 {
		return
	}

	payload := map[string]any{
		"type":      "scan",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"counters":  counters,
	}
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		slog.Warn("failed to marshal realtime payload", "event_id", eventID, "error", err)
		return
	}

	channel := fmt.Sprintf("event:%s:scans", eventID)
	if err := s.redis.Publish(ctx, channel, rawPayload).Err(); err != nil {
		slog.Warn("failed to publish realtime update", "event_id", eventID, "error", err)
	}
}
