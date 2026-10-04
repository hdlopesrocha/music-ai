import { describe, expect, it, vi } from 'vitest'
import { OpenCodeModelCatalog } from '../../server/services/opencode/modelCatalog.js'
import { testConfig } from '../helpers/fakes.js'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status })
}

const liveModels = {
  data: [
    { id: 'mimo-v2.6-flash' },
    { id: 'mimo-v2.5' },
    { id: 'deepseek-v4.1-flash' },
    { id: 'muse-spark-1.3-contributor' },
  ],
}

const catalog = {
  'opencode-go': {
    npm: '@ai-sdk/openai-compatible',
    models: {
      'mimo-v2.6-flash': {
        name: 'MiMo V2.6 Flash',
        attachment: true,
        modalities: { input: ['text', 'image', 'audio', 'video'] },
      },
      'mimo-v2.5': {
        name: 'MiMo V2.5',
        attachment: true,
        modalities: { input: ['text', 'image', 'audio'] },
      },
      'deepseek-v4.1-flash': {
        name: 'DeepSeek V4.1 Flash',
        attachment: true,
        modalities: { input: ['text', 'image'] },
      },
      'muse-spark-1.3-contributor': {
        name: 'Muse Spark',
        attachment: true,
        provider: { npm: '@ai-sdk/openai' },
        modalities: { input: ['text', 'audio'] },
      },
    },
  },
}

function createFetch() {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/models')) return jsonResponse(liveModels)
    if (url.includes('models.dev')) return jsonResponse(catalog)
    throw new Error(`unexpected url ${url}`)
  })
}

describe('OpenCodeModelCatalog', () => {
  it('discovers only audio-capable chat-completions models', async () => {
    const config = testConfig({ OPENCODE_MODE: 'api', OPENCODE_API_KEY: 'test-key' }).opencode
    const fetchFn = createFetch()
    const catalogService = new OpenCodeModelCatalog(config, fetchFn as typeof fetch)

    const info = await catalogService.info()
    expect(info.source).toBe('catalog')
    expect(info.allowOverride).toBe(true)
    expect(info.models.map((model) => model.id)).toEqual(['mimo-v2.5', 'mimo-v2.6-flash'])
    expect(info.models[0]?.media).toContain('audio')
  })

  it('caches discovery results', async () => {
    const config = testConfig({ OPENCODE_MODE: 'api', OPENCODE_API_KEY: 'test-key' }).opencode
    const fetchFn = createFetch()
    const catalogService = new OpenCodeModelCatalog(config, fetchFn as typeof fetch)
    await catalogService.info()
    await catalogService.info()
    expect(fetchFn).toHaveBeenCalledTimes(2) // one live list + one catalog
  })

  it('uses the explicit allowlist without network access', async () => {
    const config = testConfig({
      OPENCODE_MODE: 'api',
      OPENCODE_API_KEY: 'test-key',
      OPENCODE_MEDIA_MODELS: 'custom-audio-1, custom-audio-2',
    }).opencode
    const fetchFn = createFetch()
    const catalogService = new OpenCodeModelCatalog(config, fetchFn as typeof fetch)

    const info = await catalogService.info()
    expect(info.source).toBe('allowlist')
    expect(info.models.map((model) => model.id)).toEqual(['custom-audio-1', 'custom-audio-2'])
    expect(fetchFn).not.toHaveBeenCalled()
    expect(await catalogService.isAllowed('custom-audio-1')).toBe(true)
    expect(await catalogService.isAllowed('other')).toBe(false)
  })

  it('fails open with an empty catalog when discovery fails', async () => {
    const config = testConfig({ OPENCODE_MODE: 'api', OPENCODE_API_KEY: 'test-key' }).opencode
    const fetchFn = vi.fn(async () => {
      throw new Error('network down')
    })
    const catalogService = new OpenCodeModelCatalog(config, fetchFn as typeof fetch)
    const info = await catalogService.info()
    expect(info.models).toEqual([])
    expect(info.allowOverride).toBe(false)
    expect(await catalogService.isAllowed('mimo-v2.6-flash')).toBe(false)
  })

  it('survives catalog HTTP errors and filters unknown models', async () => {
    const config = testConfig({ OPENCODE_MODE: 'api', OPENCODE_API_KEY: 'test-key' }).opencode
    const fetchFn = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith('/models')
        ? jsonResponse({ data: [{ id: 'mystery-model' }] })
        : jsonResponse({ 'opencode-go': { models: {} } }),
    )
    const catalogService = new OpenCodeModelCatalog(config, fetchFn as typeof fetch)
    const info = await catalogService.info()
    expect(info.models).toEqual([])
  })
})
