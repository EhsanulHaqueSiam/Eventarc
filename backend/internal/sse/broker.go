package sse

import (
	"log/slog"
	"sync"
)

const clientBufferSize = 64

// SSEBroker manages SSE client connections per event.
type SSEBroker struct {
	mu      sync.RWMutex
	clients map[string]map[chan SSEEvent]struct{} // eventID -> set of client channels
}

// NewSSEBroker creates a new SSE broker.
func NewSSEBroker() *SSEBroker {
	return &SSEBroker{
		clients: make(map[string]map[chan SSEEvent]struct{}),
	}
}

// Subscribe registers a client channel for an event. Returns the channel and a cleanup function.
func (b *SSEBroker) Subscribe(eventID string) (chan SSEEvent, func()) {
	ch := make(chan SSEEvent, clientBufferSize)
	b.mu.Lock()
	if b.clients[eventID] == nil {
		b.clients[eventID] = make(map[chan SSEEvent]struct{})
	}
	b.clients[eventID][ch] = struct{}{}
	b.mu.Unlock()

	cleanup := func() {
		b.mu.Lock()
		delete(b.clients[eventID], ch)
		if len(b.clients[eventID]) == 0 {
			delete(b.clients, eventID)
		}
		b.mu.Unlock()
		// Note: we do NOT close the channel here. Closing while Broadcast
		// might be sending causes a race. The channel becomes unreachable
		// after cleanup removes it from the map, so GC will collect it.
	}
	return ch, cleanup
}

// Broadcast sends an event to all clients subscribed to a given event ID.
// Slow clients (full buffer) are dropped to prevent blocking.
func (b *SSEBroker) Broadcast(eventID string, event SSEEvent) {
	b.mu.RLock()
	clients, ok := b.clients[eventID]
	if !ok {
		b.mu.RUnlock()
		return
	}
	// Copy client set under read lock to avoid holding lock during send
	chs := make([]chan SSEEvent, 0, len(clients))
	for ch := range clients {
		chs = append(chs, ch)
	}
	b.mu.RUnlock()

	for _, ch := range chs {
		select {
		case ch <- event:
		default:
			// Client buffer full — drop this event for this client
			slog.Warn("SSE client buffer full, dropping event", "event_id", eventID, "event_type", event.Event)
		}
	}
}

// ClientCount returns the number of connected clients for an event.
func (b *SSEBroker) ClientCount(eventID string) int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.clients[eventID])
}

// TotalClients returns the total number of connected clients across all events.
func (b *SSEBroker) TotalClients() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	total := 0
	for _, clients := range b.clients {
		total += len(clients)
	}
	return total
}
