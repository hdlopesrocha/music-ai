import { readFile } from 'node:fs/promises'
import type { OpenCodeConfig } from '../../config.js'
import { OpenCodeError } from '../../errors.js'
import { isRecord } from '../../utils/text.js'
import type { AudioAnalysisInput, OpenCodeTransport } from './types.js'

type FetchLike = typeof fetch

/**
 * Talks to a remote OpenCode analysis gateway (see server/opencode-gateway.ts).
 * This keeps OpenCode itself off the public serverless function: the gateway is
 * the only component that executes OpenCode, in its own isolated service.
 */
export class HttpOpenCodeTransport implements OpenCodeTransport {
  readonly name = 'http'

  constructor(
    private readonly config: OpenCodeConfig,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async run(params: {
    input: AudioAnalysisInput
    systemPrompt: string
    prompt: string
    model?: string
  }): Promise<string> {
    const endpoint = this.config.endpoint
    if (!endpoint) {
      throw new OpenCodeError('UNAVAILABLE', 'OPENCODE_ENDPOINT is not configured')
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)

    try {
      const audio = await readFile(params.input.filePath)
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (this.config.gatewayToken) {
        headers.authorization = `Bearer ${this.config.gatewayToken}`
      }

      const response = await this.fetchFn(`${endpoint.replace(/\/+$/, '')}/analyze`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: params.model ?? this.config.model,
          agent: this.config.agent,
          systemPrompt: params.systemPrompt,
          prompt: params.prompt,
          audio: {
            fileName: params.input.fileName,
            mimeType: params.input.mimeType,
            base64: audio.toString('base64'),
          },
        }),
      })

      if (!response.ok) {
        throw new OpenCodeError(
          'EXECUTION_FAILED',
          `OpenCode gateway responded with HTTP ${response.status}`,
        )
      }

      const payload: unknown = await response.json()
      if (isRecord(payload)) {
        if (typeof payload.text === 'string') return payload.text
        if (payload.result !== undefined) return JSON.stringify(payload.result)
      }
      return JSON.stringify(payload)
    } catch (error) {
      if (error instanceof OpenCodeError) throw error
      if ((error as Error).name === 'AbortError') {
        throw new OpenCodeError(
          'TIMEOUT',
          `OpenCode gateway did not respond within ${this.config.timeoutMs} ms`,
        )
      }
      throw new OpenCodeError(
        'EXECUTION_FAILED',
        `OpenCode gateway request failed: ${(error as Error).message}`,
      )
    } finally {
      clearTimeout(timer)
    }
  }
}
