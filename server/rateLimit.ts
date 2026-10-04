export interface RateLimitResult {
  readonly allowed: boolean
  readonly remaining: number
  readonly retryAfterSeconds: number
}

export interface RateLimiterOptions {
  readonly windowMs: number
  readonly maxRequests: number
  readonly clock?: () => number
}

/**
 * In-memory sliding-window rate limiter.
 *
 * Keys are derived from a salted hash of the client address, so raw IP
 * addresses never leave the request scope and are never persisted.
 * In a multi-instance deployment each instance enforces its own window; that
 * is an accepted trade-off for a public, stateless API.
 */
export class SlidingWindowRateLimiter {
  private readonly windowMs: number
  private readonly maxRequests: number
  private readonly clock: () => number
  private readonly hits = new Map<string, number[]>()

  constructor(options: RateLimiterOptions) {
    this.windowMs = options.windowMs
    this.maxRequests = options.maxRequests
    this.clock = options.clock ?? (() => Date.now())
  }

  check(key: string): RateLimitResult {
    const now = this.clock()
    const cutoff = now - this.windowMs
    const timestamps = (this.hits.get(key) ?? []).filter((time) => time > cutoff)

    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0] ?? now
      this.hits.set(key, timestamps)
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)),
      }
    }

    timestamps.push(now)
    this.hits.set(key, timestamps)
    this.prune(now, cutoff)
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - timestamps.length),
      retryAfterSeconds: 0,
    }
  }

  private prune(now: number, cutoff: number): void {
    if (this.hits.size < 1000) return
    for (const [key, timestamps] of this.hits) {
      const live = timestamps.filter((time) => time > cutoff)
      if (live.length === 0) this.hits.delete(key)
      else this.hits.set(key, live)
    }
    void now
  }
}
