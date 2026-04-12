package sse

import (
	"sync"
	"testing"
	"time"
)

func TestNewSSEBrokerCreatesEmptyClientMap(t *testing.T) {
	broker := NewSSEBroker()
	if broker == nil {
		t.Fatal("NewSSEBroker returned nil")
	}
	if broker.TotalClients() != 0 {
		t.Errorf("expected 0 total clients, got %d", broker.TotalClients())
	}
}

func TestSubscribeAddsClientAndCleanupRemoves(t *testing.T) {
	broker := NewSSEBroker()
	ch, cleanup := broker.Subscribe("event-1")

	if ch == nil {
		t.Fatal("Subscribe returned nil channel")
	}
	if broker.ClientCount("event-1") != 1 {
		t.Errorf("expected 1 client after subscribe, got %d", broker.ClientCount("event-1"))
	}

	cleanup()

	if broker.ClientCount("event-1") != 0 {
		t.Errorf("expected 0 clients after cleanup, got %d", broker.ClientCount("event-1"))
	}
}

func TestUnsubscribeViaCleanupRemovesClient(t *testing.T) {
	broker := NewSSEBroker()
	_, cleanup1 := broker.Subscribe("event-1")
	_, cleanup2 := broker.Subscribe("event-1")

	if broker.ClientCount("event-1") != 2 {
		t.Fatalf("expected 2 clients, got %d", broker.ClientCount("event-1"))
	}

	cleanup1()
	if broker.ClientCount("event-1") != 1 {
		t.Errorf("expected 1 client after first cleanup, got %d", broker.ClientCount("event-1"))
	}

	cleanup2()
	if broker.ClientCount("event-1") != 0 {
		t.Errorf("expected 0 clients after second cleanup, got %d", broker.ClientCount("event-1"))
	}
}

func TestBroadcastSendsToAllSubscribers(t *testing.T) {
	broker := NewSSEBroker()
	ch, cleanup := broker.Subscribe("event-1")
	defer cleanup()

	event := SSEEvent{ID: "1", Event: "counters", Data: `{"test":true}`}
	broker.Broadcast("event-1", event)

	select {
	case received := <-ch:
		if received.ID != event.ID || received.Event != event.Event || received.Data != event.Data {
			t.Errorf("received event mismatch: got %+v, want %+v", received, event)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for broadcast event")
	}
}

func TestBroadcastToEventWithNoSubscribersDoesNotPanic(t *testing.T) {
	broker := NewSSEBroker()
	// Should not panic or block
	broker.Broadcast("nonexistent-event", SSEEvent{ID: "1", Event: "test", Data: "{}"})
}

func TestMultipleClientsForSameEventAllReceiveBroadcast(t *testing.T) {
	broker := NewSSEBroker()
	ch1, cleanup1 := broker.Subscribe("event-1")
	defer cleanup1()
	ch2, cleanup2 := broker.Subscribe("event-1")
	defer cleanup2()

	event := SSEEvent{ID: "1", Event: "counters", Data: `{"attendance":42}`}
	broker.Broadcast("event-1", event)

	for i, ch := range []chan SSEEvent{ch1, ch2} {
		select {
		case received := <-ch:
			if received.Data != event.Data {
				t.Errorf("client %d: got data %q, want %q", i, received.Data, event.Data)
			}
		case <-time.After(time.Second):
			t.Fatalf("client %d: timed out waiting for broadcast event", i)
		}
	}
}

func TestClientForDifferentEventDoesNotReceiveBroadcast(t *testing.T) {
	broker := NewSSEBroker()
	ch1, cleanup1 := broker.Subscribe("event-1")
	defer cleanup1()
	ch2, cleanup2 := broker.Subscribe("event-2")
	defer cleanup2()

	event := SSEEvent{ID: "1", Event: "counters", Data: `{"attendance":42}`}
	broker.Broadcast("event-1", event)

	// event-1 client should receive
	select {
	case <-ch1:
		// ok
	case <-time.After(time.Second):
		t.Fatal("event-1 client did not receive broadcast")
	}

	// event-2 client should NOT receive
	select {
	case ev := <-ch2:
		t.Fatalf("event-2 client should not receive event-1 broadcast, got %+v", ev)
	case <-time.After(100 * time.Millisecond):
		// ok — no event received
	}
}

func TestSlowClientIsDroppedWithoutBlocking(t *testing.T) {
	broker := NewSSEBroker()

	// Create a broker with a subscriber, but we'll test by filling the channel buffer
	ch, cleanup := broker.Subscribe("event-1")
	defer cleanup()

	// Fill the channel buffer completely
	for i := 0; i < clientBufferSize; i++ {
		ch <- SSEEvent{ID: "fill", Event: "fill", Data: "{}"}
	}

	// Now broadcast — the buffer is full, so the event should be dropped (not block)
	done := make(chan struct{})
	go func() {
		broker.Broadcast("event-1", SSEEvent{ID: "overflow", Event: "test", Data: "{}"})
		close(done)
	}()

	select {
	case <-done:
		// Broadcast returned without blocking — correct behavior
	case <-time.After(2 * time.Second):
		t.Fatal("Broadcast blocked on slow client — should have dropped the event")
	}
}

func TestConcurrentAccessDoesNotPanic(t *testing.T) {
	broker := NewSSEBroker()
	var wg sync.WaitGroup

	// Spawn concurrent subscribers
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ch, cleanup := broker.Subscribe("event-concurrent")
			defer cleanup()
			// Read one event (or timeout)
			select {
			case <-ch:
			case <-time.After(200 * time.Millisecond):
			}
		}()
	}

	// Spawn concurrent broadcasters
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			broker.Broadcast("event-concurrent", SSEEvent{
				ID:    "concurrent",
				Event: "test",
				Data:  "{}",
			})
		}(i)
	}

	wg.Wait()
}
