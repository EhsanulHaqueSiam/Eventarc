package worker

import (
	"encoding/json"
	"fmt"

	"github.com/hibiken/asynq"
)

// Task type constants for the QR generation pipeline.
const (
	TaskQRGenerateBatch  = "qr:generate-batch"
	TaskQRGenerateSingle = "qr:generate-single"
)

// GenerateBatchPayload contains the event configuration needed to generate
// QR codes for all guests in an event.
type GenerateBatchPayload struct {
	EventID      string `json:"eventId"`
	QRStrategy   string `json:"qrStrategy"`   // "unified" or "separate"
	FoodQRMode   string `json:"foodQrMode"`   // "guestLinked" or "anonymous"
	FoodQRTiming string `json:"foodQrTiming"` // "preSent" or "postEntry"
}

// GenerateSinglePayload contains the data needed to generate QR codes for
// a single guest.
type GenerateSinglePayload struct {
	EventID string `json:"eventId"`
	GuestID string `json:"guestId"`
	QRTypes []byte `json:"qrTypes"` // QR type bytes from DetermineQRTypes
}

// QRProgressInfo holds real-time progress data for a QR generation job,
// stored as a Redis hash.
type QRProgressInfo struct {
	Total     int64  `json:"total"`
	Completed int64  `json:"completed"`
	Failed    int64  `json:"failed"`
	Status    string `json:"status"` // "pending", "running", "complete", "failed"
}

// ProgressKey returns the Redis hash key for tracking QR generation progress
// for the given event.
func ProgressKey(eventID string) string {
	return fmt.Sprintf("qr:progress:%s", eventID)
}

// NewGenerateBatchTask creates an asynq task that triggers QR generation
// for all guests in an event. Enqueued to the "critical" queue with up to
// 3 retries.
func NewGenerateBatchTask(p GenerateBatchPayload) (*asynq.Task, error) {
	payload, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("worker: marshal batch payload: %w", err)
	}
	return asynq.NewTask(TaskQRGenerateBatch, payload, asynq.MaxRetry(3), asynq.Queue("critical")), nil
}

// NewGenerateSingleTask creates an asynq task that generates QR codes for
// a single guest. Enqueued to the "critical" queue with up to 3 retries.
func NewGenerateSingleTask(p GenerateSinglePayload) (*asynq.Task, error) {
	payload, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("worker: marshal single payload: %w", err)
	}
	return asynq.NewTask(TaskQRGenerateSingle, payload, asynq.MaxRetry(3), asynq.Queue("critical")), nil
}
