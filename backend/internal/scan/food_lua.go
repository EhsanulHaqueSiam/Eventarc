package scan

import "github.com/redis/go-redis/v9"

// foodScanLua is the Redis Lua script for atomic food scan processing.
// It performs: (1) read limit from rules cache, (2) check current consumption,
// (3) increment if allowed, (4) update dashboard counters, (5) log consumption.
//
// KEYS[1] = food:{eventId}:{guestOrTokenId}     (HASH - per-guest/token consumption counts)
// KEYS[2] = foodrules:{eventId}                   (HASH - food rules cache)
// KEYS[3] = counters:{eventId}                    (HASH - dashboard counters)
// KEYS[4] = foodlog:{eventId}:{guestOrTokenId}   (LIST - consumption history log)
//
// ARGV[1] = guestCategoryId (for rule lookup: "{guestCategoryId}:{foodCategoryId}")
// ARGV[2] = foodCategoryId (food category being scanned)
// ARGV[3] = stallId
// ARGV[4] = timestamp (ISO 8601 string)
// ARGV[5] = deviceId
// ARGV[6] = stallName (human-readable, for log entry)
//
// Returns table:
//
//	[1] = "OK" | "LIMIT_REACHED" | "NO_RULE"
//	[2] = current count (after increment if OK, or current count if rejected)
//	[3] = limit value (-1 for unlimited, 0+ for specific limit)
const foodScanLua = `
local ruleKey = ARGV[1] .. ':' .. ARGV[2]
local limit = redis.call('HGET', KEYS[2], ruleKey)

if limit == false then
  return {'NO_RULE', '0', '0'}
end

limit = tonumber(limit)

if limit == -1 then
  local newCount = redis.call('HINCRBY', KEYS[1], ARGV[2], 1)
  redis.call('HINCRBY', KEYS[3], 'food:' .. ARGV[2] .. ':served', 1)
  redis.call('HINCRBY', KEYS[3], 'stall:' .. ARGV[3] .. ':served', 1)
  local logEntry = ARGV[4] .. '|' .. ARGV[3] .. '|' .. ARGV[6]
  redis.call('LPUSH', KEYS[4], logEntry)
  redis.call('LTRIM', KEYS[4], 0, 49)
  return {'OK', tostring(newCount), '-1'}
end

local current = tonumber(redis.call('HGET', KEYS[1], ARGV[2]) or '0')

if current >= limit then
  return {'LIMIT_REACHED', tostring(current), tostring(limit)}
end

local newCount = redis.call('HINCRBY', KEYS[1], ARGV[2], 1)
redis.call('HINCRBY', KEYS[3], 'food:' .. ARGV[2] .. ':served', 1)
redis.call('HINCRBY', KEYS[3], 'stall:' .. ARGV[3] .. ':served', 1)

local logEntry = ARGV[4] .. '|' .. ARGV[3] .. '|' .. ARGV[6]
redis.call('LPUSH', KEYS[4], logEntry)
redis.call('LTRIM', KEYS[4], 0, 49)

return {'OK', tostring(newCount), tostring(limit)}
`

// foodScanScript is the preloaded Redis script for atomic food scan processing.
var foodScanScript = redis.NewScript(foodScanLua)
