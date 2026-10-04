import { describe, expect, it } from 'vitest'
import { SlidingWindowRateLimiter } from '../../server/rateLimit.js'

describe('SlidingWindowRateLimiter', () => {
  it('allows requests up to the limit and then blocks with a retry delay', () => {
    let now = 1_000_000
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 2,
      clock: () => now,
    })

    expect(limiter.check('client')).toMatchObject({ allowed: true, remaining: 1 })
    expect(limiter.check('client')).toMatchObject({ allowed: true, remaining: 0 })

    const blocked = limiter.check('client')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)

    now += 60_001
    expect(limiter.check('client').allowed).toBe(true)
  })

  it('tracks clients independently', () => {
    const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 1 })
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('b').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(false)
  })

  it('computes a shrinking retry window as time passes', () => {
    let now = 0
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 10_000,
      maxRequests: 1,
      clock: () => now,
    })
    limiter.check('client')
    now = 4_000
    const result = limiter.check('client')
    expect(result.allowed).toBe(false)
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(6)
    now = 10_001
    expect(limiter.check('client').allowed).toBe(true)
  })
})
