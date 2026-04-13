package convexsync

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Client performs HMAC-signed sync calls from Go services to Convex HTTP actions.
type Client struct {
	baseURL    string
	hmacSecret []byte
	httpClient *http.Client
}

// FoodConsumptionSyncPayload is the body sent to Convex for accepted food scans.
type FoodConsumptionSyncPayload struct {
	IdempotencyKey   string `json:"idempotency_key"`
	EventID          string `json:"event_id"`
	GuestID          string `json:"guest_id"`
	FoodCategoryID   string `json:"food_category_id"`
	StallID          string `json:"stall_id"`
	ScannedAt        string `json:"scanned_at"`
	DeviceID         string `json:"device_id"`
	GuestCategory    string `json:"guest_category"`
	IsAnonymous      bool   `json:"is_anonymous"`
	ConsumptionCount int    `json:"consumption_count"`
	Status           string `json:"status"`
}

// NewClient creates a Convex sync client.
func NewClient(baseURL, hmacSecret string) *Client {
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		hmacSecret: []byte(hmacSecret),
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// IsConfigured returns whether this client can issue sync requests.
func (c *Client) IsConfigured() bool {
	return c != nil && c.baseURL != "" && len(c.hmacSecret) > 0
}

// SyncGuestCard writes guest card image metadata back to Convex.
func (c *Client) SyncGuestCard(ctx context.Context, eventID, guestID, cardImageURL, cardImageKey string) error {
	if !c.IsConfigured() {
		return fmt.Errorf("convex sync client is not configured")
	}
	payload := map[string]string{
		"event_id":       eventID,
		"guest_id":       guestID,
		"card_image_url": cardImageURL,
		"card_image_key": cardImageKey,
	}
	return c.signedPost(ctx, "/internal/sync/guest-card", payload)
}

// SyncGuestCheckIn marks a guest as checked in back in Convex.
func (c *Client) SyncGuestCheckIn(ctx context.Context, eventID, guestID, checkedInAt string) error {
	if !c.IsConfigured() {
		return fmt.Errorf("convex sync client is not configured")
	}
	payload := map[string]string{
		"event_id":      eventID,
		"guest_id":      guestID,
		"checked_in_at": checkedInAt,
	}
	return c.signedPost(ctx, "/internal/sync/guest-checkin", payload)
}

// SyncFoodConsumption writes accepted food-consumption records back to Convex.
func (c *Client) SyncFoodConsumption(ctx context.Context, payload FoodConsumptionSyncPayload) error {
	if !c.IsConfigured() {
		return fmt.Errorf("convex sync client is not configured")
	}
	return c.signedPost(ctx, "/internal/sync/food-consumption", payload)
}

func (c *Client) signedPost(ctx context.Context, path string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	timestamp := time.Now().UTC().Format(time.RFC3339)
	mac := hmac.New(sha256.New, c.hmacSecret)
	mac.Write([]byte(timestamp))
	mac.Write(body)
	signature := hex.EncodeToString(mac.Sum(nil))

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+path,
		bytes.NewReader(body),
	)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Signature", signature)
	req.Header.Set("X-Timestamp", timestamp)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		rawBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("sync endpoint returned %d: %s", resp.StatusCode, string(rawBody))
	}

	return nil
}
