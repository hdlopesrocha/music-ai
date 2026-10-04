import { z } from 'zod'
import type { MusicAnalysisResult } from './types.js'
import { OpenCodeError } from '../../errors.js'

const text = (max: number) => z.string().trim().min(1).max(max)
const stringList = (maxItems: number, maxLength: number) =>
  z.array(z.string().trim().min(1).max(maxLength)).max(maxItems)

export const AgentSongSchema = z.object({
  title: text(300),
  artist: text(300),
  confidence: z.number().min(0).max(1),
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
  lyricsLanguage: z.string().trim().max(40).optional(),
  instrumental: z.boolean().optional(),
  songMatch: AgentSongSchema.nullish(),
  diagnostics: AgentDiagnosticsSchema.optional(),
})

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeAnalysisResult(
  raw: z.infer<typeof AgentAnalysisResultSchema>,
): MusicAnalysisResult {
  const lyrics = raw.lyrics ? raw.lyrics.replace(/\r\n/g, '\n').trim() : ''
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
