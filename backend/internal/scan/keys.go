package scan

import "fmt"

// Redis key builders. Centralizes all key patterns to prevent typo-induced
// data misses across service, food_service, and event_sync.

// GuestKey returns the key for a guest's cached profile.
// Pattern: guest:{eventId}:{guestId}
func GuestKey(eventID, guestID string) string {
	return fmt.Sprintf("guest:%s:%s", eventID, guestID)
}

// CheckedInKey returns the set key tracking which guests are checked in.
// Pattern: checkedin:{eventId}
func CheckedInKey(eventID string) string {
	return fmt.Sprintf("checkedin:%s", eventID)
}

// CheckInKey returns the hash key for a specific guest's check-in details.
// Pattern: checkin:{eventId}:{guestId}
func CheckInKey(eventID, guestID string) string {
	return fmt.Sprintf("checkin:%s:%s", eventID, guestID)
}

// CountersKey returns the hash key for event-level atomic counters.
// Pattern: counters:{eventId}
func CountersKey(eventID string) string {
	return fmt.Sprintf("counters:%s", eventID)
}

// EventKey returns the hash key for cached event configuration.
// Pattern: event:{eventId}
func EventKey(eventID string) string {
	return fmt.Sprintf("event:%s", eventID)
}

// FoodConsumptionKey returns the key for a guest's food consumption tracking.
// Pattern: food:{eventId}:{guestId}
func FoodConsumptionKey(eventID, guestID string) string {
	return fmt.Sprintf("food:%s:%s", eventID, guestID)
}

// AnonFoodConsumptionKey returns the key for an anonymous token's food consumption.
// Pattern: food:{eventId}:anon:{tokenId}
func AnonFoodConsumptionKey(eventID, tokenID string) string {
	return fmt.Sprintf("food:%s:anon:%s", eventID, tokenID)
}

// FoodLogKey returns the list key for food consumption log entries.
// Pattern: foodlog:{eventId}:{guestId}
func FoodLogKey(eventID, guestID string) string {
	return fmt.Sprintf("foodlog:%s:%s", eventID, guestID)
}

// AnonFoodLogKey returns the list key for anonymous food consumption log.
// Pattern: foodlog:{eventId}:anon:{tokenId}
func AnonFoodLogKey(eventID, tokenID string) string {
	return fmt.Sprintf("foodlog:%s:anon:%s", eventID, tokenID)
}

// FoodRulesKey returns the hash key for event food rules.
// Pattern: foodrules:{eventId}
func FoodRulesKey(eventID string) string {
	return fmt.Sprintf("foodrules:%s", eventID)
}

// StallKey returns the hash key for stall metadata.
// Pattern: stall:{eventId}:{stallId}
func StallKey(eventID, stallID string) string {
	return fmt.Sprintf("stall:%s:%s", eventID, stallID)
}

// FoodCategoryKey returns the hash key for food category metadata.
// Pattern: foodcategory:{eventId}:{categoryId}
func FoodCategoryKey(eventID, categoryID string) string {
	return fmt.Sprintf("foodcategory:%s:%s", eventID, categoryID)
}

// AnonTokenKey returns the hash key for anonymous QR token metadata.
// Pattern: anontoken:{eventId}:{tokenId}
func AnonTokenKey(eventID, tokenID string) string {
	return fmt.Sprintf("anontoken:%s:%s", eventID, tokenID)
}

// SessionKey returns the key for a device session.
// Pattern: session:{token}
func SessionKey(token string) string {
	return "session:" + token
}

// GuestPattern returns a glob pattern for all guest keys under an event.
// Pattern: guest:{eventId}:*
func GuestPattern(eventID string) string {
	return fmt.Sprintf("guest:%s:*", eventID)
}

// StallPattern returns a glob pattern for all stall keys under an event.
// Pattern: stall:{eventId}:*
func StallPattern(eventID string) string {
	return fmt.Sprintf("stall:%s:*", eventID)
}

// FoodCategoryPattern returns a glob pattern for all food category keys under an event.
// Pattern: foodcategory:{eventId}:*
func FoodCategoryPattern(eventID string) string {
	return fmt.Sprintf("foodcategory:%s:*", eventID)
}
