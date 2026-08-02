import NodeCache from 'node-cache'

// NodeCache.set() restarts an entry's TTL on every write, which would turn a
// rate-limit window into a sliding one: each attempt pushes the expiry out
// again, so someone retrying steadily would never leave the window. Restoring
// the entry's original expiry keeps the window fixed, counted from the first
// attempt.
export const incrementFixedWindowCount = (cache: NodeCache, key: string): number => {
  const expiresAtMs = cache.getTtl(key)
  const count = (cache.get<number>(key) ?? 0) + 1
  cache.set(key, count)
  if (expiresAtMs) {
    cache.ttl(key, (expiresAtMs - Date.now()) / 1000)
  }
  return count
}
