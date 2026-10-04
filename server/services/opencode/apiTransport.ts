import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { OpenCodeConfig } from '../../config.js'
import { OpenCodeError } from '../../errors.js'
import { isRecord, truncate } from '../../utils/text.js'
import type { AudioAnalysisInput, OpenCodeTransport } from './types.js'

type FetchLike = typeof fetch

const AUDIO_FORMATS: Record<string, 'wav' | 'mp3'> = {
  '.wav': 'wav',
  '.mp3': 'mp3',
}

function audioFormat(fileName: string): 'wav' | 'mp3' | null {
  return AUDIO_FORMATS[extname(fileName).toLowerCase()] ?? null
}

function mapApiError(status: number, body: string): OpenCodeError {
  const detail = truncate(body.replace(/\s+/g, ' ').trim(), 300)
  if (status === 401 || status === 403) {
    return new OpenCodeError('UNAVAILABLE', `The OpenCode API key was rejected (HTTP ${status})`)
  }
  if (status === 402) {
    return new OpenCodeError('EXECUTION_FAILED', 'The OpenCode account has insufficient funds')
  }
  if (status === 429) {
    return new OpenCodeError('EXECUTION_FAILED', 'The OpenCode API rate limit was reached')
  }
  return new OpenCodeError(
    'EXECUTION_FAILED',
    `OpenCode API responded with HTTP ${status}: ${detail}`,
  )
}

function extractContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    return ''
  }
  const first = payload.choices[0]
  if (!isRecord(first) || !isRecord(first.message)) return ''
  const content = first.message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (isRecord(part) && typeof part.text === 'string') return part.text
        return ''
      })
      .join('')
  }
  return ''
}

/**
 * Calls the OpenCode Go/Zen API directly with an API key.
 *
 * Unlike the CLI transport, this sends the audio as an `input_audio` content
 * part, so the model can actually listen to it. Only WAV and MP3 are accepted
 * (the OpenAI-compatible audio formats); the model list exposed by the catalog
 * is limited to models that advertise audio input.
 */
export class OpenCodeApiTransport implements OpenCodeTransport {
  readonly name = 'api'
  private readonly fetchFn: FetchLike

  constructor(
    private readonly config: OpenCodeConfig,
    fetchFn: FetchLike = fetch,
  ) {
    this.fetchFn = fetchFn
  }

  async run(params: {
    input: AudioAnalysisInput
    systemPrompt: string
    prompt: string
    model?: string
  }): Promise<string> {
    const { config } = this
    if (!config.apiKey) {
      throw new OpenCodeError('UNAVAILABLE', 'OPENCODE_API_KEY is not configured')
    }

    const format = audioFormat(params.input.fileName)
    if (!format) {
      throw new OpenCodeError(
        'EXECUTION_FAILED',
        `Direct API analysis supports WAV and MP3 audio (received "${params.input.fileName}"). ` +
          'Use OPENCODE_MODE=cli or convert the file.',
      )
    }

    const audio = await readFile(params.input.filePath)
    if (audio.length > config.maxAudioBytes) {
      throw new OpenCodeError(
        'EXECUTION_FAILED',
        `The audio exceeds the direct-API limit of ${config.maxAudioBytes} bytes. ` +
          'Use a shorter excerpt or raise OPENCODE_MAX_AUDIO_BYTES.',
      )
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)

    try {
      const response = await this.fetchFn(`${config.apiUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
          'user-agent': 'ai-music-style-database/1.0',
          'x-opencode-session': `music-ai-${params.input.sha256.slice(0, 16)}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: params.model ?? config.model,
          temperature: 0,
          max_tokens: config.maxOutputTokens,
          messages: [
            { role: 'system', content: params.systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: params.prompt },
                {
                  type: 'input_audio',
                  input_audio: { data: audio.toString('base64'), format },
                },
              ],
            },
          ],
        }),
      })

      if (!response.ok) {
        throw mapApiError(response.status, await response.text())
      }

      const content = extractContent(await response.json()).trim()
      if (content.length === 0) {
        throw new OpenCodeError('EMPTY_RESPONSE', 'The OpenCode API returned no assistant content')
      }
      return content
    } catch (error) {
      if (error instanceof OpenCodeError) throw error
      if ((error as Error).name === 'AbortError') {
        throw new OpenCodeError(
          'TIMEOUT',
          `The OpenCode API did not respond within ${config.timeoutMs} ms`,
        )
      }
      throw new OpenCodeError(
        'EXECUTION_FAILED',
        `OpenCode API request failed: ${(error as Error).message}`,
      )
    } finally {
      clearTimeout(timer)
    }
  }
}
