import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenCodeApiTransport } from '../../server/services/opencode/apiTransport.js'
import { makeAudioInput, testConfig } from '../helpers/fakes.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function audioInput(fileName = 'song.wav'): Promise<ReturnType<typeof makeAudioInput>> {
  const dir = await mkdtemp(join(tmpdir(), 'music-ai-api-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const filePath = join(dir, fileName)
  await writeFile(filePath, Buffer.from('audio-bytes'))
  return makeAudioInput({ filePath, fileName })
}

function apiConfig(env: Record<string, string> = {}) {
  return testConfig({
    OPENCODE_MODE: 'api',
    OPENCODE_API_KEY: 'test-key',
    OPENCODE_API_URL: 'https://api.example.test',
    ...env,
  }).opencode
}

function completion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), {
    status: 200,
  })
}

describe('OpenCodeApiTransport', () => {
  it('sends the audio inline and honours the model override', async () => {
    const input = await audioInput()
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        model: string
        messages: Array<{ role: string; content: unknown }>
      }
      expect(body.model).toBe('mimo-v2.6-pro')
      const user = body.messages.find((message) => message.role === 'user')
      const parts = user?.content as Array<Record<string, unknown>>
      const audioPart = parts.find((part) => part.type === 'input_audio') as {
        input_audio: { data: string; format: string }
      }
      expect(audioPart.input_audio.format).toBe('wav')
      expect(Buffer.from(audioPart.input_audio.data, 'base64').toString('utf8')).toBe('audio-bytes')
      return completion('{"style":"Techno","confidence":0.9}')
    })

    const transport = new OpenCodeApiTransport(apiConfig(), fetchFn as typeof fetch)
    const text = await transport.run({
      input,
      systemPrompt: 'system',
      prompt: 'prompt',
      model: 'mimo-v2.6-pro',
    })
    expect(text).toBe('{"style":"Techno","confidence":0.9}')

    const headers = (fetchFn.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer test-key')
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe('https://api.example.test/chat/completions')
  })

  it('uses the configured model by default', async () => {
    const input = await audioInput('song.mp3')
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string }
      expect(body.model).toBe(apiConfig().model)
      return completion('{}')
    })
    const transport = new OpenCodeApiTransport(apiConfig(), fetchFn as typeof fetch)
    await transport.run({ input, systemPrompt: 's', prompt: 'p' })
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('rejects unsupported audio formats with a clear message', async () => {
    const input = await audioInput('song.flac')
    const transport = new OpenCodeApiTransport(apiConfig(), vi.fn() as unknown as typeof fetch)
    await expect(transport.run({ input, systemPrompt: 's', prompt: 'p' })).rejects.toMatchObject({
      code: 'EXECUTION_FAILED',
      message: expect.stringContaining('WAV and MP3'),
    })
  })

  it('requires an API key', async () => {
    const transport = new OpenCodeApiTransport(
      apiConfig({ OPENCODE_API_KEY: '' }),
      vi.fn() as unknown as typeof fetch,
    )
    await expect(
      transport.run({ input: makeAudioInput(), systemPrompt: 's', prompt: 'p' }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' })
  })

  it('maps insufficient funds and rejected keys', async () => {
    const input = await audioInput()
    const funds = new OpenCodeApiTransport(
      apiConfig(),
      vi.fn(
        async () => new Response('{"error":"nope"}', { status: 402 }),
      ) as unknown as typeof fetch,
    )
    await expect(funds.run({ input, systemPrompt: 's', prompt: 'p' })).rejects.toMatchObject({
      code: 'EXECUTION_FAILED',
      message: expect.stringContaining('insufficient funds'),
    })

    const unauthorized = new OpenCodeApiTransport(
      apiConfig(),
      vi.fn(async () => new Response('unauthorized', { status: 401 })) as unknown as typeof fetch,
    )
    await expect(unauthorized.run({ input, systemPrompt: 's', prompt: 'p' })).rejects.toMatchObject(
      { code: 'UNAVAILABLE' },
    )
  })

  it('maps aborts to TIMEOUT', async () => {
    const input = await audioInput()
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
    const transport = new OpenCodeApiTransport(
      apiConfig({ OPENCODE_TIMEOUT_MS: '20' }),
      fetchFn as typeof fetch,
    )
    await expect(transport.run({ input, systemPrompt: 's', prompt: 'p' })).rejects.toMatchObject({
      code: 'TIMEOUT',
    })
  })

  it('rejects audio above the direct-API size limit', async () => {
    const input = await audioInput()
    const transport = new OpenCodeApiTransport(
      apiConfig({ OPENCODE_MAX_AUDIO_BYTES: '4' }),
      vi.fn() as unknown as typeof fetch,
    )
    await expect(transport.run({ input, systemPrompt: 's', prompt: 'p' })).rejects.toMatchObject({
      code: 'EXECUTION_FAILED',
      message: expect.stringContaining('exceeds the direct-API limit'),
    })
  })

  it('reports an empty response as EMPTY_RESPONSE', async () => {
    const input = await audioInput()
    const transport = new OpenCodeApiTransport(
      apiConfig(),
      vi.fn(async () => completion('')) as unknown as typeof fetch,
    )
    await expect(transport.run({ input, systemPrompt: 's', prompt: 'p' })).rejects.toMatchObject({
      code: 'EMPTY_RESPONSE',
    })
  })
})
