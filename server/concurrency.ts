/**
 * Minimal counting semaphore used to bound concurrent OpenCode analyses and
 * protect limited local resources (CPU, memory, provider rate limits).
 */
export class Semaphore {
  private available: number
  private readonly waiters: Array<() => void> = []

  constructor(limit: number) {
    if (limit < 1) throw new Error('Semaphore limit must be >= 1')
    this.available = limit
  }

  tryAcquire(): (() => void) | null {
    if (this.available <= 0) return null
    this.available -= 1
    return this.createRelease()
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1
      return this.createRelease()
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    return this.createRelease()
  }

  /**
   * Waits up to `timeoutMs` for a slot. Returns null when the system stays
   * busy, letting the API answer 503 instead of queueing unbounded work.
   */
  async acquireWithTimeout(timeoutMs: number): Promise<(() => void) | null> {
    const immediate = this.tryAcquire()
    if (immediate) return immediate
    if (timeoutMs <= 0) return null

    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs)
    })
    const acquired = new Promise<() => void>((resolve) => {
      this.waiters.push(() => resolve(this.createRelease()))
    })

    const result = await Promise.race([acquired, timeout])
    if (timer) clearTimeout(timer)
    return result
  }

  private createRelease(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.waiters.shift()
      if (next) next()
      else this.available += 1
    }
  }
}
