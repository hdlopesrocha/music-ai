import { z } from 'zod'
import type { SongLookupConfig } from '../../config.js'
import type { Logger } from '../../logger.js'
import { collapseWhitespace } from '../../utils/text.js'
import { createSerialThrottle } from '../../utils/serialThrottle.js'
import type {
  SongIdentificationInput,
  SongIdentificationService,
  VerifiedSongMatch,
} from './types.js'

const ArtistCreditSchema = z.object({
  name: z.string(),
  joinphrase: z.string().optional(),
})

const ReleaseSchema = z.object({
  title: z.string().optional(),
  date: z.string().optional(),
})

const RecordingSchema = z.object({
  id: z.string(),
  score: z.coerce.number().optional(),
  title: z.string(),
  'artist-credit': z.array(ArtistCreditSchema).optional(),
  releases: z.array(ReleaseSchema).optional(),
})

const SearchResponseSchema = z.object({
  recordings: z.array(RecordingSchema).optional(),
})

type FetchLike = typeof fetch

function artistName(recording: z.infer<typeof RecordingSchema>): string {
  const credits = recording['artist-credit'] ?? []
  return collapseWhitespace(
    credits.map((credit) => `${credit.name}${credit.joinphrase ?? ''}`).join(''),
  )
}

function releaseYear(recording: z.infer<typeof RecordingSchema>): number | undefined {
  for (const release of recording.releases ?? []) {
    if (!release.date) continue
    const match = /^(\d{4})/.exec(release.date)
    if (match?.[1]) {
      const year = Number.parseInt(match[1], 10)
      if (year >= 1800 && year <= 2200) return year
    }
  }
  return undefined
}

/**
 * Verifies an AI proposed song against the free MusicBrainz catalogue.
 * MusicBrainz requires a descriptive User-Agent and at most one request per
 * second, both of which are enforced here. Failures are non-fatal: a song
 * identification is a bonus, never a blocker for classification.
 */
export class MusicBrainzSongIdentificationService implements SongIdentificationService {
  readonly name = 'musicbrainz'
  private readonly schedule: ReturnType<typeof createSerialThrottle>
  private readonly fetchFn: FetchLike

  constructor(
    private readonly config: SongLookupConfig,
    private readonly logger: Logger,
    fetchFn: FetchLike = fetch,
    throttleMs = 1100,
  ) {
    this.fetchFn = fetchFn
    this.schedule = createSerialThrottle(throttleMs)
  }

  async identify(input: SongIdentificationInput): Promise<VerifiedSongMatch | null> {
    const proposal = input.proposal
    if (!proposal) return null

    const query = `recording:"${proposal.title}" AND artist:"${proposal.artist}"`
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/ws/2/recording?query=${encodeURIComponent(
      query,
    )}&fmt=json&limit=5`

    try {
      const payload = await this.schedule(() => this.fetchWithTimeout(url))
      const parsed = SearchResponseSchema.safeParse(payload)
      if (!parsed.success) {
        this.logger.warn('MusicBrainz response failed validation')
        return null
      }

      const recordings = parsed.data.recordings ?? []
      let best: { recording: (typeof recordings)[number]; score: number } | null = null
      for (const recording of recordings) {
        const score = recording.score ?? 0
        if (score < this.config.minScore) continue
        if (!best || score > best.score) best = { recording, score }
      }
      if (!best) return null

      const artist = artistName(best.recording)
      if (artist.length === 0) return null

      return {
        title: collapseWhitespace(best.recording.title),
        artist,
        provider: 'musicbrainz',
        recordingId: best.recording.id,
        score: best.score,
        ...(best.recording.releases?.[0]?.title
          ? { album: collapseWhitespace(best.recording.releases[0].title) }
          : {}),
        ...(releaseYear(best.recording) !== undefined ? { year: releaseYear(best.recording) } : {}),
      }
    } catch (error) {
      this.logger.warn('Song identification failed', { error: (error as Error).message })
      return null
    }
  }

  private async fetchWithTimeout(url: string): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const response = await this.fetchFn(url, {
        headers: {
          accept: 'application/json',
          'user-agent': this.config.userAgent,
        },
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`MusicBrainz responded with HTTP ${response.status}`)
      }
      return await response.json()
    } finally {
      clearTimeout(timer)
    }
  }
}
