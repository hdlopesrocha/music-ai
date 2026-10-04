import type { AppConfig } from '../../config.js'
import type {
  AudioAnalysisInput,
  MusicAnalysisAgent,
  MusicAnalysisContext,
  MusicAnalysisResult,
  OpenCodeTransport,
} from './types.js'
import { SYSTEM_PROMPT, buildTaskPrompt } from './prompts.js'
import { extractJsonObject } from './parse.js'
import { parseAnalysisResult } from './schema.js'
import { CliOpenCodeTransport } from './cliTransport.js'
import { HttpOpenCodeTransport } from './httpTransport.js'
import { OpenCodeApiTransport } from './apiTransport.js'

/**
 * The only agent implementation that knows about OpenCode. It translates the
 * abstract agent interface into an OpenCode invocation and strictly parses the
 * machine-readable response. It never modifies the repository.
 */
export class OpenCodeMusicAnalysisAgent implements MusicAnalysisAgent {
  readonly name = 'opencode'

  constructor(private readonly transport: OpenCodeTransport) {}

  async analyze(
    input: AudioAnalysisInput,
    context: MusicAnalysisContext,
  ): Promise<MusicAnalysisResult> {
    const prompt = buildTaskPrompt(input, context)
    const raw = await this.transport.run({
      input,
      systemPrompt: SYSTEM_PROMPT,
      prompt,
      ...(context.model ? { model: context.model } : {}),
    })
    return parseAnalysisResult(extractJsonObject(raw))
  }
}

/**
 * Deterministic offline classifier used for local development and tests when
 * OPENCODE_MODE=mock. Never used in production.
 *
 * File-name hints (for manual testing):
 *   *unknown*        -> returns a style that is not in styles.json
 *   *lowconfidence*  -> returns a below-threshold confidence
 *   *instrumental*   -> reports an instrumental track with no lyrics
 *   *song-*          -> reports a song match to exercise MusicBrainz lookup
 */
export class MockMusicAnalysisAgent implements MusicAnalysisAgent {
  readonly name = 'mock'

  async analyze(
    input: AudioAnalysisInput,
    context: MusicAnalysisContext,
  ): Promise<MusicAnalysisResult> {
    const fileName = input.fileName.toLowerCase()
    const hash = parseInt(input.sha256.slice(0, 8), 16)
    const index = Number.isFinite(hash) ? hash % context.allowedStyles.length : 0
    const style = context.allowedStyles[index] ?? 'Electronic'

    if (fileName.includes('unknown')) {
      return { style: 'Progressive Balkan Electronica', confidence: 0.91 }
    }

    const base: MusicAnalysisResult = {
      style,
      confidence:
        fileName.includes('lowconfidence') || fileName.includes('low-confidence') ? 0.42 : 0.93,
      substyles: [],
      tags: ['mock-analysis'],
      diagnostics: {
        ...(input.metadata.duration !== undefined ? { duration: input.metadata.duration } : {}),
        energy: 0.5,
      },
    }

    if (fileName.includes('instrumental')) {
      return { ...base, instrumental: true, lyrics: '', songMatch: null }
    }

    const result: MusicAnalysisResult = {
      ...base,
      instrumental: false,
      lyrics: `Mock transcription for ${input.fileName} line one\nMock transcription line two`,
      lyricsLanguage: 'English',
      songMatch: null,
    }

    if (fileName.includes('song-')) {
      return {
        ...result,
        songMatch: { title: 'Mock Song', artist: 'Mock Artist', confidence: 0.82 },
      }
    }

    return result
  }
}

export function createMusicAnalysisAgent(config: AppConfig): MusicAnalysisAgent {
  switch (config.opencode.mode) {
    case 'mock':
      return new MockMusicAnalysisAgent()
    case 'http':
      return new OpenCodeMusicAnalysisAgent(new HttpOpenCodeTransport(config.opencode))
    case 'api':
      return new OpenCodeMusicAnalysisAgent(new OpenCodeApiTransport(config.opencode))
    case 'cli':
    default:
      return new OpenCodeMusicAnalysisAgent(new CliOpenCodeTransport(config.opencode))
  }
}
