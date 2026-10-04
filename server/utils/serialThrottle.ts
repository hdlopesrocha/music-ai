/**
 * Serializes calls and enforces a minimum delay between them.
 * MusicBrainz requires clients to stay at or below one request per second.
 */
export function createSerialThrottle(
  minIntervalMs: number,
): <T>(task: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve()
  let lastStart = 0

  return function schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      const wait = lastStart + minIntervalMs - Date.now()
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      lastStart = Date.now()
      return task()
    })
    chain = run.catch(() => undefined)
    return run
  }
}
