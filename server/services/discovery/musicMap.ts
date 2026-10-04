import type { MusicMapConfig } from '../../config.js'
import type { Logger } from '../../logger.js'
import { createSerialThrottle } from '../../utils/serialThrottle.js'
import { collapseWhitespace, truncate } from '../../utils/text.js'

export interface SimilarArtistsResult {
  readonly artist: string
  readonly neighbors: string[]
  readonly source: 'music-map' | 'disabled'
}

export interface SimilarArtistService {
  findNeighbors(artist: string): Promise<SimilarArtistsResult>
}

type FetchLike = typeof fetch

const MAX_CACHE_ENTRIES = 250

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code: string) => {
    try {
      if (code.startsWith('#x') || code.startsWith('#X')) {
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16))
      }
      if (code.startsWith('#')) {
        return String.fromCodePoint(Number.parseInt(code.slice(1), 10))
      }
      return NAMED_ENTITIES[code.toLowerCase()] ?? match
    } catch {
      return match
    }
  })
}

/**
 * Extracts artist names from a music-map.com result page. The neighbour links
 * are anchors with `class=S`; the first one is the queried artist itself.
 */
export function parseMusicMapHtml(html: string, limit: number): string[] {
  const pattern = /<a\b[^>]*\bclass=["']?S["']?[^>]*>([^<]*)<\/a>/gi
  const names: string[] = []
  const seen = new Set<string>()

  for (const match of html.matchAll(pattern)) {
    const raw = match[1]
    if (raw === undefined) continue
    const name = collapseWhitespace(decodeEntities(raw))
    if (name.length === 0) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
    if (names.length >= limit + 1) break
  }

  return names
}

/**
 * Fetches similar artists from music-map.com. Responses are cached and
 * upstream requests are serialized to at most one per second, with a
 * descriptive user-agent and a hard timeout.
 */
export class MusicMapService implements SimilarArtistService {
  private readonly cache = new Map<string, { at: number; value: SimilarArtistsResult }>()
  private readonly schedule: ReturnType<typeof createSerialThrottle>
  private readonly fetchFn: FetchLike
  private readonly now: () => number

  constructor(
    private readonly config: MusicMapConfig,
    private readonly logger: Logger,
    fetchFn: FetchLike = fetch,
    now: () => number = () => Date.now(),
    throttleMs = 1000,
  ) {
    this.fetchFn = fetchFn
    this.now = now
    this.schedule = createSerialThrottle(throttleMs)
  }

  async findNeighbors(artist: string): Promise<SimilarArtistsResult> {
    const name = collapseWhitespace(artist)
    const key = name.toLowerCase()
    const cached = this.cache.get(key)
    if (cached && this.now() - cached.at < this.config.cacheTtlMs) {
      return cached.value
    }

    const path = encodeURIComponent(name).replace(/%20/g, '+')
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/${path}`

    const html = await this.schedule(() => this.fetchPage(url))
    const parsed = parseMusicMapHtml(html, this.config.maxNeighbors)
    const neighbors = parsed.filter((candidate) => candidate.toLowerCase() !== key)

    const value: SimilarArtistsResult = { artist: name, neighbors, source: 'music-map' }
    this.cache.set(key, { at: this.now(), value })
    if (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }

    this.logger.info('similar artists fetched', {
      artist: truncate(name, 80),
      neighbors: neighbors.length,
    })
    return value
  }

  private async fetchPage(url: string): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const response = await this.fetchFn(url, {
        headers: {
          accept: 'text/html',
          'user-agent': 'ai-music-style-database/1.0 (+https://github.com/hdlopesrocha/music-ai)',
        },
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`music-map.com responded with HTTP ${response.status}`)
      }
      return await response.text()
    } finally {
      clearTimeout(timer)
    }
  }
}

export class DisabledSimilarArtistService implements SimilarArtistService {
  async findNeighbors(artist: string): Promise<SimilarArtistsResult> {
    return { artist: collapseWhitespace(artist), neighbors: [], source: 'disabled' }
  }
}
