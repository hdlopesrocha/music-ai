import { z } from 'zod'
import type { AudioMetadata } from './audio.js'
import type {
  LyricSegment,
  MusicAnalysisDiagnostics,
  MusicAnalysisResult,
} from '../opencode/types.js'
import type { VerifiedSongMatch } from '../song/types.js'
import { optionalTrimmed } from '../../utils/text.js'

export const DiagnosticsSchema = z
  .object({
    bpm: z.number().positive().max(400).optional(),
    duration: z.number().nonnegative().max(86_400).optional(),
    key: z.string().max(40).optional(),
    energy: z.number().min(0).max(1).optional(),
    instrumentation: z.array(z.string().max(80)).max(30).optional(),
  })
  .strict()

export const SubtitleSegmentSchema = z
  .object({
    start: z.number().min(0).max(86_400),
    end: z.number().min(0).max(86_400),
    text: z.string().min(1).max(500),
  })
  .strict()

export const SongSchema = z
  .object({
    title: z.string().min(1).max(300),
    artist: z.string().min(1).max(300),
    album: z.string().max(300).optional(),
    year: z.number().int().min(1800).max(2200).optional(),
    provider: z.enum(['musicbrainz']),
    recordingId: z.string().max(100).optional(),
    score: z.number().min(0).max(100).optional(),
  })
  .strict()

export const TrackSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/, 'id must be a lowercase SHA-256 hex string'),
    fileName: z.string().min(1).max(300),
    title: z.string().max(300).optional(),
    artist: z.string().max(300).optional(),
    album: z.string().max(300).optional(),
    year: z.number().int().min(1800).max(2200).optional(),
    duration: z.number().nonnegative().max(86_400).optional(),
    style: z.string().min(1).max(100),
    substyles: z.array(z.string().max(100)).max(20).optional(),
    tags: z.array(z.string().max(100)).max(30).optional(),
    confidence: z.number().min(0).max(1),
    hasLyrics: z.boolean().optional(),
    lyricsLanguage: z.string().max(40).optional(),
    /** Full transcription. Only stored when STORE_SUBTITLES=true. */
    lyrics: z.string().min(1).max(100_000).optional(),
    /** Timed lyric lines. Only stored when STORE_SUBTITLES=true. */
    subtitles: z.array(SubtitleSegmentSchema).max(500).optional(),
    song: SongSchema.optional(),
    detectedAt: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), 'detectedAt must be an ISO date string'),
    source: z.literal('opencode'),
    diagnostics: DiagnosticsSchema.optional(),
  })
  .strict()

export const MusicDatabaseSchema = z
  .object({
    version: z.number().int().positive(),
    tracks: z.array(TrackSchema),
  })
  .strict()

export const StyleDatabaseSchema = z
  .object({
    version: z.number().int().positive(),
    styles: z.array(z.string().min(1).max(100)).min(1),
  })
  .strict()

export type Track = z.infer<typeof TrackSchema>
export type MusicDatabase = z.infer<typeof MusicDatabaseSchema>
export type StyleDatabase = z.infer<typeof StyleDatabaseSchema>

export class DatabaseValidationError extends Error {
  readonly issues: string[]

  constructor(message: string, issues: string[] = []) {
    super(message)
    this.name = 'DatabaseValidationError'
    this.issues = issues
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
}

export function parseMusicDatabase(text: string): MusicDatabase {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new DatabaseValidationError(
      `music database is not valid JSON: ${(error as Error).message}`,
    )
  }
  const result = MusicDatabaseSchema.safeParse(raw)
  if (!result.success) {
    throw new DatabaseValidationError(
      'music database failed schema validation',
      formatIssues(result.error),
    )
  }
  return result.data
}

export function parseStyleDatabase(text: string): StyleDatabase {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new DatabaseValidationError(
      `style database is not valid JSON: ${(error as Error).message}`,
    )
  }
  const result = StyleDatabaseSchema.safeParse(raw)
  if (!result.success) {
    throw new DatabaseValidationError(
      'style database failed schema validation',
      formatIssues(result.error),
    )
  }
  return result.data
}

export function serializeMusicDatabase(database: MusicDatabase): string {
  return `${JSON.stringify(database, null, 2)}\n`
}

export function findTrackById(database: MusicDatabase, id: string): Track | undefined {
  const normalized = id.toLowerCase()
  return database.tracks.find((track) => track.id === normalized)
}

export function insertTrack(database: MusicDatabase, track: Track): MusicDatabase {
  if (findTrackById(database, track.id)) {
    throw new DatabaseValidationError(`track ${track.id} already exists`)
  }
  return { ...database, tracks: [...database.tracks, track] }
}

/**
 * Replaces the entry with the same id in place (order preserved) or appends it
 * when it does not exist yet.
 */
export function replaceTrack(database: MusicDatabase, track: Track): MusicDatabase {
  const index = database.tracks.findIndex((entry) => entry.id === track.id)
  if (index === -1) return { ...database, tracks: [...database.tracks, track] }
  const tracks = [...database.tracks]
  tracks[index] = track
  return { ...database, tracks }
}

function uniqueLimited(values: readonly string[], maxItems: number, maxLength: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const cleaned = optionalTrimmed(value, maxLength)
    if (!cleaned) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(cleaned)
    if (result.length >= maxItems) break
  }
  return result
}

function sanitizeDiagnostics(
  diagnostics: MusicAnalysisDiagnostics | undefined,
): Track['diagnostics'] {
  if (!diagnostics) return undefined
  const result: NonNullable<Track['diagnostics']> = {}
  if (
    typeof diagnostics.bpm === 'number' &&
    Number.isFinite(diagnostics.bpm) &&
    diagnostics.bpm > 0
  ) {
    result.bpm = Math.round(diagnostics.bpm * 100) / 100
  }
  if (
    typeof diagnostics.duration === 'number' &&
    Number.isFinite(diagnostics.duration) &&
    diagnostics.duration >= 0
  ) {
    result.duration = Math.round(diagnostics.duration)
  }
  const key = optionalTrimmed(diagnostics.key, 40)
  if (key) result.key = key
  if (typeof diagnostics.energy === 'number' && Number.isFinite(diagnostics.energy)) {
    result.energy = Math.min(1, Math.max(0, Math.round(diagnostics.energy * 1000) / 1000))
  }
  if (Array.isArray(diagnostics.instrumentation)) {
    const instrumentation = uniqueLimited(diagnostics.instrumentation, 30, 80)
    if (instrumentation.length > 0) result.instrumentation = instrumentation
  }
  return Object.keys(result).length > 0 ? result : undefined
}

export interface BuildTrackRecordParams {
  readonly metadata: AudioMetadata
  readonly classification: MusicAnalysisResult
  readonly style: string
  readonly song: VerifiedSongMatch | null
  readonly now: Date
  /** When provided, timed lyric lines are persisted for SRT export. */
  readonly subtitles?: readonly LyricSegment[]
  /** When provided, the full transcription is persisted. */
  readonly lyrics?: string
}

export function buildTrackRecord(params: BuildTrackRecordParams): Track {
  const { metadata, classification, style, song, now } = params
  const lyrics = classification.lyrics?.trim() ?? ''
  const hasLyrics = lyrics.length > 0 && classification.instrumental !== true

  const diagnostics = sanitizeDiagnostics(classification.diagnostics)
  const duration = metadata.duration ?? diagnostics?.duration

  const record: Track = {
    id: metadata.sha256.toLowerCase(),
    fileName: metadata.fileName,
    style,
    confidence: Math.round(Math.min(1, Math.max(0, classification.confidence)) * 10_000) / 10_000,
    detectedAt: now.toISOString(),
    source: 'opencode',
  }

  // Fall back to the AI-proposed song when the file has no tags and the
  // proposal was not verified against MusicBrainz.
  const proposed = classification.songMatch ?? null
  const title = metadata.title ?? song?.title ?? proposed?.title
  const artist = metadata.artist ?? song?.artist ?? proposed?.artist
  const album = metadata.album ?? song?.album
  const year = metadata.year ?? song?.year

  if (title) record.title = title
  if (artist) record.artist = artist
  if (album) record.album = album
  if (year !== undefined) record.year = year
  if (duration !== undefined) record.duration = duration

  if (classification.substyles && classification.substyles.length > 0) {
    record.substyles = uniqueLimited(classification.substyles, 20, 100)
  }
  if (classification.tags && classification.tags.length > 0) {
    record.tags = uniqueLimited(classification.tags, 30, 100)
  }

  record.hasLyrics = hasLyrics
  const language = hasLyrics ? optionalTrimmed(classification.lyricsLanguage, 40) : undefined
  if (language) record.lyricsLanguage = language

  const storedLyrics = params.lyrics?.replace(/\r\n/g, '\n').trim()
  if (storedLyrics) record.lyrics = storedLyrics.slice(0, 100_000)

  if (params.subtitles && params.subtitles.length > 0) {
    record.subtitles = params.subtitles
      .filter((segment) => segment.text.trim().length > 0)
      .map((segment) => ({
        start: Math.max(0, segment.start),
        end: segment.end > segment.start ? segment.end : segment.start + 2,
        text: segment.text.trim(),
      }))
      .slice(0, 500)
  }

  if (song) {
    record.song = {
      title: song.title,
      artist: song.artist,
      provider: song.provider,
      ...(song.album ? { album: song.album } : {}),
      ...(song.year !== undefined ? { year: song.year } : {}),
      ...(song.recordingId ? { recordingId: song.recordingId } : {}),
      ...(song.score !== undefined ? { score: song.score } : {}),
    }
  }

  if (diagnostics) record.diagnostics = diagnostics
  return record
}
