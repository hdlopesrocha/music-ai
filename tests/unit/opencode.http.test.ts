import { readFile, writeFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenCodeError } from '../../server/errors.js'
import { HttpOpenCodeTransport } from '../../server/services/opencode/httpTransport.js'
import { makeAudioInput, testConfig } from '../helpers/fakes.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function prepareInput(): Promise<ReturnType<typeof makeAudioInput>> {
  const dir = await mkdtemp(join(tmpdir(), 'music-ai-http-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const filePath = join(dir, 'audio.mp3')
  await writeFile(filePath, 'audio-bytes')
  return makeAudioInput({ filePath })
}

describe('HttpOpenCodeTransport', () => {
  it('posts the audio and returns the gateway text', async () => {
    const input = await prepareInput()
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { audio: { base64: string }; prompt: string }
      expect(Buffer.from(body.audio.base64, 'base64').toString('utf8')).toBe('audio-bytes')
      expect(body.prompt).toBe('PROMPT')
      return new Response(JSON.stringify({ text: '{"style":"Techno","confidence":0.8}' }), {
        status: 200,
      })
    })

    const config = testConfig({ OPENCODE_MODE: 'http', OPENCODE_ENDPOINT: 'http://gateway.test/' })
    const transport = new HttpOpenCodeTransport(config.opencode, fetchFn)
    const text = await transport.run({ input, systemPrompt: 'system', prompt: 'PROMPT' })
    expect(text).toBe('{"style":"Techno","confidence":0.8}')
    expect(fetchFn).toHaveBeenCalledOnce()
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe('http://gateway.test/analyze')
  })

  it('accepts a structured result object from the gateway', async () => {
    const input = await prepareInput()
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: { style: 'Jazz', confidence: 0.9 } }), {
          status: 200,
        }),
    )
    const config = testConfig({ OPENCODE_MODE: 'http', OPENCODE_ENDPOINT: 'http://gateway.test' })
    const transport = new HttpOpenCodeTransport(config.opencode, fetchFn)
    const text = await transport.run({ input, systemPrompt: 's', prompt: 'p' })
    expect(JSON.parse(text)).toEqual({ style: 'Jazz', confidence: 0.9 })
  })

  it('fails without an endpoint', async () => {
    const transport = new HttpOpenCodeTransport(testConfig().opencode)
    await expect(
      transport.run({ input: makeAudioInput(), systemPrompt: 's', prompt: 'p' }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' })
  })

  it('maps non-2xx responses to EXECUTION_FAILED', async () => {
    const input = await prepareInput()
    const fetchFn = vi.fn(async () => new Response('nope', { status: 500 }))
    const config = testConfig({ OPENCODE_MODE: 'http', OPENCODE_ENDPOINT: 'http://gateway.test' })
    const transport = new HttpOpenCodeTransport(config.opencode, fetchFn)
    await expect(transport.run({ input, systemPrompt: 's', prompt: 'p' })).rejects.toBeInstanceOf(
      OpenCodeError,
    )
  })

  it('maps aborts to TIMEOUT', async () => {
    const input = await prepareInput()
    const fetchFn = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        }),
    )
    const config = testConfig({
      OPENCODE_MODE: 'http',
      OPENCODE_ENDPOINT: 'http://gateway.test',
      OPENCODE_TIMEOUT_MS: '20',
    })
    const transport = new HttpOpenCodeTransport(config.opencode, fetchFn as typeof fetch)
    await expect(transport.run({ input, systemPrompt: 's', prompt: 'p' })).rejects.toMatchObject({
      code: 'TIMEOUT',
    })
  })

  it('sends the gateway authorization token when configured', async () => {
    const input = await prepareInput()
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      expect(headers.authorization).toBe('Bearer gateway-secret')
      return new Response(JSON.stringify({ text: '{}' }), { status: 200 })
    })
    const config = testConfig({
      OPENCODE_MODE: 'http',
      OPENCODE_ENDPOINT: 'http://gateway.test',
      OPENCODE_GATEWAY_TOKEN: 'gateway-secret',
    })
    const transport = new HttpOpenCodeTransport(config.opencode, fetchFn)
    await transport.run({ input, systemPrompt: 's', prompt: 'p' })
    expect(fetchFn).toHaveBeenCalledOnce()
    await readFile(input.filePath)
  })
})
