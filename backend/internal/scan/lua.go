package scan

import "github.com/redis/go-redis/v9"

// checkInScript is the Redis Lua script for atomic entry check-in.
// It performs: (1) check if guest already checked in, (2) if not, mark as checked in,
// (3) store check-in details, (4) increment event attendance counter.
//
// KEYS[1] = checkedin:{eventId}          (SET — checked-in guest IDs)
// KEYS[2] = checkin:{eventId}:{guestId}  (HASH — check-in details)
// KEYS[3] = counters:{eventId}           (HASH — event counters)
//
// ARGV[1] = guestId
// ARGV[2] = timestamp (ISO 8601)
// ARGV[3] = stallId
// ARGV[4] = deviceId
// ARGV[5] = guestCategory (for per-category counter)
//
// Returns:
//
//	"OK"        — new check-in succeeded
//	"DUPLICATE" — guest already checked in
const checkInLua = `
local already = redis.call('SISMEMBER', KEYS[1], ARGV[1])
if already == 1 then
  return 'DUPLICATE'
end
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('HSET', KEYS[2], 'timestamp', ARGV[2], 'stallId', ARGV[3], 'deviceId', ARGV[4], 'status', 'valid')
redis.call('HINCRBY', KEYS[3], 'attendance', 1)
if ARGV[5] ~= '' then
  redis.call('HINCRBY', KEYS[3], ARGV[5] .. ':checkedin', 1)
end
return 'OK'
`

// checkInScript is the preloaded Redis script for atomic check-in.
var checkInScript = redis.NewScript(checkInLua)
