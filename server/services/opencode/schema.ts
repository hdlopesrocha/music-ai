import { z } from 'zod'
import type { LyricSegment, MusicAnalysisResult } from './types.js'
import { OpenCodeError } from '../../errors.js'

const text = (max: number) => z.string().trim().min(1).max(max)
const stringList = (maxItems: number, maxLength: number) =>
  z.array(z.string().trim().min(1).max(maxLength)).max(maxItems)

export const AgentSongSchema = z.object({
  title: text(300),
  artist: text(300),
  confidence: z.number().min(0).max(1),
})

export const AgentLyricSegmentSchema = z.object({
  start: z.number().min(0).max(86_400),
  end: z.number().min(0).max(86_400),
  // Empty lines are filtered during normalization, so the schema stays lenient.
  text: z.string().max(500),
})

const AgentDiagnosticsSchema = z.object({
  bpm: z.number().positive().max(400).optional(),
  duration: z.number().nonnegative().max(86_400).optional(),
  key: z.string().trim().max(40).optional(),
  energy: z.number().min(0).max(1).optional(),
  instrumentation: stringList(30, 80).optional(),
})

/**
 * Schema for the raw JSON returned by the model. Unknown keys are stripped
 * (not rejected) so harmless extra fields never break an otherwise valid
 * classification, while everything the application relies on is validated.
 */
export const AgentAnalysisResultSchema = z.object({
  style: text(120),
  confidence: z.number().min(0).max(1),
  substyles: stringList(20, 100).optional(),
  tags: stringList(30, 100).optional(),
  lyrics: z.string().max(100_000).optional(),
  lyricsSegments: z.array(AgentLyricSegmentSchema).max(500).optional(),
  lyricsLanguage: z.string().trim().max(40).optional(),
  instrumental: z.boolean().optional(),
  songMatch: AgentSongSchema.nullish(),
  diagnostics: AgentDiagnosticsSchema.optional(),
})

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Sorts timed lyric lines, clamps invalid ranges and caps the list so a
 * misbehaving model cannot produce unbounded SRT output.
 */
function normalizeSegments(
  segments: readonly z.infer<typeof AgentLyricSegmentSchema>[],
): LyricSegment[] {
  const clamp = (value: number): number => Math.min(86_400, Math.max(0, value))
  return segments
    .map((segment) => {
      const start = clamp(segment.start)
      const rawEnd = clamp(segment.end)
      return {
        start,
        end: rawEnd > start ? rawEnd : start + 2,
        text: collapse(segment.text),
      }
    })
    .filter((segment) => segment.text.length > 0)
    .sort((a, b) => a.start - b.start)
    .slice(0, 500)
}

export function normalizeAnalysisResult(
  raw: z.infer<typeof AgentAnalysisResultSchema>,
): MusicAnalysisResult {
  const segments = raw.lyricsSegments ? normalizeSegments(raw.lyricsSegments) : []
  const providedLyrics = raw.lyrics ? raw.lyrics.replace(/\r\n/g, '\n').trim() : ''
  const lyrics =
    providedLyrics.length > 0 ? providedLyrics : segments.map((segment) => segment.text).join('\n')
  const language = raw.lyricsLanguage ? collapse(raw.lyricsLanguage) : ''
  const diagnostics = raw.diagnostics
    ? {
        ...(raw.diagnostics.bpm !== undefined ? { bpm: raw.diagnostics.bpm } : {}),
        ...(raw.diagnostics.duration !== undefined ? { duration: raw.diagnostics.duration } : {}),
        ...(raw.diagnostics.key ? { key: collapse(raw.diagnostics.key) } : {}),
        ...(raw.diagnostics.energy !== undefined ? { energy: raw.diagnostics.energy } : {}),
        ...(raw.diagnostics.instrumentation
          ? { instrumentation: raw.diagnostics.instrumentation.map(collapse).filter(Boolean) }
          : {}),
      }
    : undefined

  return {
    style: collapse(raw.style),
    confidence: Math.min(1, Math.max(0, raw.confidence)),
    ...(raw.substyles ? { substyles: raw.substyles.map(collapse).filter(Boolean) } : {}),
    ...(raw.tags ? { tags: raw.tags.map(collapse).filter(Boolean) } : {}),
    ...(lyrics.length > 0 ? { lyrics } : {}),
    ...(segments.length > 0 ? { lyricsSegments: segments } : {}),
    ...(language.length > 0 ? { lyricsLanguage: language } : {}),
    ...(typeof raw.instrumental === 'boolean' ? { instrumental: raw.instrumental } : {}),
    ...(raw.songMatch
      ? {
          songMatch: {
            title: collapse(raw.songMatch.title),
            artist: collapse(raw.songMatch.artist),
            confidence: Math.min(1, Math.max(0, raw.songMatch.confidence)),
          },
        }
      : raw.songMatch === null
        ? { songMatch: null }
        : {}),
    ...(diagnostics ? { diagnostics } : {}),
  }
}

export function parseAnalysisResult(value: unknown): MusicAnalysisResult {
  const parsed = AgentAnalysisResultSchema.safeParse(value)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new OpenCodeError('MALFORMED_RESPONSE', `OpenCode returned an invalid result: ${issues}`)
  }
  return normalizeAnalysisResult(parsed.data)
}
