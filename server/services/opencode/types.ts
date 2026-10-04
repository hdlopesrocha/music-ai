import type { AudioMetadata } from '../music/audio.js'

export interface AudioAnalysisInput {
  readonly filePath: string
  readonly fileName: string
  readonly mimeType: string
  readonly size: number
  readonly sha256: string
  readonly metadata: AudioMetadata
}

export interface MusicExample {
  readonly fileName: string
  readonly style: string
  readonly title?: string
  readonly artist?: string
  readonly substyles?: readonly string[]
  readonly tags?: readonly string[]
}

export interface MusicAnalysisContext {
  readonly allowedStyles: readonly string[]
  readonly examples: readonly MusicExample[]
  readonly minConfidence: number
  /** Optional per-request model override, already validated against the catalog. */
  readonly model?: string
}

export interface SongProposal {
  readonly title: string
  readonly artist: string
  readonly confidence: number
}

export interface MusicAnalysisDiagnostics {
  readonly bpm?: number
  readonly duration?: number
  readonly key?: string
  readonly energy?: number
  readonly instrumentation?: readonly string[]
}

export interface MusicAnalysisResult {
  readonly style: string
  readonly confidence: number
  readonly substyles?: readonly string[]
  readonly tags?: readonly string[]
  /** Transient transcription. Never persisted in full; used only for identification. */
  readonly lyrics?: string
  readonly lyricsLanguage?: string
  readonly instrumental?: boolean
  readonly songMatch?: SongProposal | null
  readonly diagnostics?: MusicAnalysisDiagnostics
}

/**
 * The application depends only on this abstraction. OpenCode is one possible
 * implementation; it can be replaced without touching the Vue app or the
 * GitHub database logic.
 */
export interface MusicAnalysisAgent {
  readonly name: string
  analyze(input: AudioAnalysisInput, context: MusicAnalysisContext): Promise<MusicAnalysisResult>
}

export interface OpenCodeTransport {
  readonly name: string
  run(params: {
    input: AudioAnalysisInput
    systemPrompt: string
    prompt: string
    model?: string
  }): Promise<string>
}
