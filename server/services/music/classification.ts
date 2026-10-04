import type { MusicAnalysisResult } from '../opencode/types.js'
import type { StyleCatalog } from './styles.js'
import { truncate } from '../../utils/text.js'

export type ClassificationValidation =
  | {
      readonly status: 'ok'
      readonly classification: MusicAnalysisResult
      readonly resolvedStyle: string
    }
  | {
      readonly status: 'unknown_style'
      readonly detectedStyle: string
      readonly confidence: number
    }
  | {
      readonly status: 'low_confidence'
      readonly detectedStyle: string
      readonly confidence: number
      readonly threshold: number
    }

/**
 * Independently validates the AI proposal. The AI is never trusted:
 * the style must resolve (after conservative normalization) to an entry in
 * styles.json and the confidence must clear the configured threshold.
 */
export function validateClassification(
  classification: MusicAnalysisResult,
  catalog: StyleCatalog,
  minConfidence: number,
): ClassificationValidation {
  const detectedStyle = truncate(classification.style.trim(), 120)
  const confidence = classification.confidence
  const resolved = catalog.resolve(detectedStyle)

  if (!resolved) {
    return { status: 'unknown_style', detectedStyle, confidence }
  }

  if (!Number.isFinite(confidence) || confidence < minConfidence) {
    return {
      status: 'low_confidence',
      detectedStyle: resolved,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      threshold: minConfidence,
    }
  }

  return { status: 'ok', classification, resolvedStyle: resolved }
}
