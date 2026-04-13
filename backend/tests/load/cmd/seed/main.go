// Command seed generates test payloads for k6 load tests.
//
// It creates N valid QR-encoded payloads using qr.EncodePayload with the
// specified HMAC secret. It also seeds Redis with corresponding guest data
// (guest:{eventId}:{guestId} hashes).
//
// Usage:
//
//	go run ./tests/load/cmd/seed -count 15000 -event test_event_001 -hmac-secret test_secret
//
// Output: tests/load/payloads.json
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ehsanul-haque-siam/eventarc/internal/qr"
)

type payloadEntry struct {
	QRPayload string `json:"qr_payload"`
	StallID   string `json:"stall_id"`
	GuestID   string `json:"guest_id"`
}

func main() {
	count := flag.Int("count", 15000, "Number of payloads to generate")
	eventID := flag.String("event", "load_test_event", "Event ID")
	hmacSecret := flag.String("hmac-secret", "test_hmac_secret", "HMAC secret key")
	redisURL := flag.String("redis-url", "redis://localhost:6379", "Redis URL")
	outputFile := flag.String("output", "tests/load/payloads.json", "Output JSON file path")
	flag.Parse()

	ctx := context.Background()

	// Connect to Redis
	redisOpts, err := redis.ParseURL(*redisURL)
	if err != nil {
		log.Fatalf("failed to parse Redis URL: %v", err)
	}
	rdb := redis.NewClient(redisOpts)
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("failed to connect to Redis: %v", err)
	}

	secret := []byte(*hmacSecret)
	payloads := make([]payloadEntry, 0, *count)
	categories := []string{"vip", "regular", "staff"}
	now := time.Now().Unix()

	log.Printf("Generating %d payloads for event %s...", *count, *eventID)

	// Seed guest data and generate payloads
	pipe := rdb.Pipeline()
	for i := 0; i < *count; i++ {
		guestID := fmt.Sprintf("guest_%06d", i)
		category := categories[i%len(categories)]

		// Seed guest hash in Redis
		guestKey := fmt.Sprintf("guest:%s:%s", *eventID, guestID)
		pipe.HSet(ctx, guestKey, map[string]interface{}{
			"name":     fmt.Sprintf("Guest %06d", i),
			"category": category,
			"photoUrl": "",
		})

		// Generate QR payload
		p := qr.Payload{
			Version:   qr.PayloadVersion,
			QRType:    qr.QRTypeEntry,
			EventID:   *eventID,
			GuestID:   guestID,
			Timestamp: now,
		}
		encoded, err := qr.EncodePayload(p, secret)
		if err != nil {
			log.Fatalf("failed to encode payload %d: %v", i, err)
		}

		stallID := fmt.Sprintf("stall_entry_%02d", i%5)
		payloads = append(payloads, payloadEntry{
			QRPayload: encoded,
			StallID:   stallID,
			GuestID:   guestID,
		})

		// Execute pipeline in batches of 1000
		if (i+1)%1000 == 0 {
			if _, err := pipe.Exec(ctx); err != nil {
				log.Fatalf("Redis pipeline exec failed at batch %d: %v", i/1000, err)
			}
			pipe = rdb.Pipeline()
			log.Printf("  Seeded %d/%d guests...", i+1, *count)
		}
	}

	// Execute remaining pipeline commands
	if _, err := pipe.Exec(ctx); err != nil {
		log.Fatalf("Redis pipeline exec failed: %v", err)
	}

	// Initialize event counter
	countersKey := fmt.Sprintf("counters:%s", *eventID)
	rdb.HSet(ctx, countersKey, "totalGuests", *count)

	// Write payloads.json
	jsonData, err := json.MarshalIndent(payloads, "", "  ")
	if err != nil {
		log.Fatalf("failed to marshal payloads: %v", err)
	}
	if err := os.WriteFile(*outputFile, jsonData, 0644); err != nil {
		log.Fatalf("failed to write %s: %v", *outputFile, err)
	}

	log.Printf("Generated %d payloads, seeded Redis with %d guests for event %s", *count, *count, *eventID)
	log.Printf("Output: %s", *outputFile)
}
