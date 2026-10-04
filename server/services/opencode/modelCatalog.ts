import type { OpenCodeConfig } from '../../config.js'
import { isRecord } from '../../utils/text.js'

export interface MediaModelInfo {
  readonly id: string
  readonly label: string
  readonly media: readonly string[]
}

export interface ModelCatalogInfo {
  readonly models: MediaModelInfo[]
  readonly defaultModel: string
  readonly allowOverride: boolean
  readonly source: 'allowlist' | 'catalog' | 'none'
}

export interface ModelCatalog {
  info(): Promise<ModelCatalogInfo>
  isAllowed(model: string): Promise<boolean>
}

type FetchLike = typeof fetch

interface CatalogSnapshot {
  at: number
  models: MediaModelInfo[]
  source: 'allowlist' | 'catalog' | 'none'
}

const REQUEST_TIMEOUT_MS = 8_000
const CATALOG_TIMEOUT_MS = 20_000

function withTimeout(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetchFn(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

function modelName(model: Record<string, unknown>, fallback: string): string {
  return typeof model.name === 'string' && model.name.length > 0 ? model.name : fallback
}

function inputModalities(model: Record<string, unknown>): string[] {
  if (!isRecord(model.modalities)) return []
  const input = model.modalities.input
  return Array.isArray(input)
    ? input.filter((value): value is string => typeof value === 'string')
    : []
}

interface CatalogLookup {
  readonly providers: Record<string, unknown>
}

function findModelMeta(
  lookup: CatalogLookup,
  id: string,
): { provider: Record<string, unknown>; model: Record<string, unknown> } | null {
  const candidates = new Set([
    id,
    id.replace(/-free$/, ''),
    `${id}-free`,
    id.replace(/-contributor-free$/, '-contributor'),
  ])
  for (const providerId of ['opencode-go', 'opencode']) {
    const provider = lookup.providers[providerId]
    if (!isRecord(provider) || !isRecord(provider.models)) continue
    for (const candidate of candidates) {
      const model = provider.models[candidate]
      if (isRecord(model)) return { provider, model }
    }
  }
  return null
}

/**
 * Discovers which OpenCode models can analyse audio directly through the API.
 *
 * The live `GET /models` endpoint only returns ids, so capabilities are joined
 * against the public models.dev catalogue. Only models that accept audio input
 * and speak the OpenAI-compatible chat-completions protocol are advertised,
 * because those are the ones this transport can actually drive.
 */
export class OpenCodeModelCatalog implements ModelCatalog {
  private snapshot: CatalogSnapshot | null = null
  private readonly fetchFn: FetchLike
  private readonly now: () => number

  constructor(
    private readonly config: OpenCodeConfig,
    fetchFn: FetchLike = fetch,
    now: () => number = () => Date.now(),
  ) {
    this.fetchFn = fetchFn
    this.now = now
  }

  async info(): Promise<ModelCatalogInfo> {
    const models = await this.list()
    return {
      models,
      defaultModel: this.config.model,
      allowOverride: models.length > 0,
      source: this.snapshot?.source ?? 'none',
    }
  }

  async isAllowed(model: string): Promise<boolean> {
    const models = await this.list()
    return models.some((entry) => entry.id === model)
  }

  private async list(): Promise<MediaModelInfo[]> {
    const current = this.now()
    if (this.snapshot && current - this.snapshot.at < this.config.catalogTtlMs) {
      return this.snapshot.models
    }

    let models: MediaModelInfo[]
    let source: CatalogSnapshot['source']

    if (this.config.mediaModels.length > 0) {
      models = this.config.mediaModels.map((id) => ({ id, label: id, media: ['audio'] }))
      source = 'allowlist'
    } else {
      try {
        models = await this.discover()
        source = models.length > 0 ? 'catalog' : 'none'
      } catch {
        models = []
        source = 'none'
      }
    }

    this.snapshot = { at: current, models, source }
    return models
  }

  private async discover(): Promise<MediaModelInfo[]> {
    if (!this.config.apiKey) return []

    const [liveIds, lookup] = await Promise.all([this.fetchLiveModelIds(), this.fetchCatalog()])
    const models: MediaModelInfo[] = []

    for (const id of liveIds) {
      const meta = findModelMeta(lookup, id)
      if (!meta) continue
      const modalities = inputModalities(meta.model)
      if (!modalities.includes('audio')) continue
      if (meta.model.attachment === false) continue
      const npm =
        (isRecord(meta.model.provider) && typeof meta.model.provider.npm === 'string'
          ? meta.model.provider.npm
          : undefined) ?? (typeof meta.provider.npm === 'string' ? meta.provider.npm : undefined)
      if (npm !== undefined && npm !== '@ai-sdk/openai-compatible') continue
      models.push({ id, label: modelName(meta.model, id), media: modalities })
    }

    return models.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
  }

  private async fetchLiveModelIds(): Promise<string[]> {
    const url = `${this.config.apiUrl.replace(/\/+$/, '')}/models`
    const response = await withTimeout(
      this.fetchFn,
      url,
      {
        headers: {
          authorization: `Bearer ${this.config.apiKey ?? ''}`,
          accept: 'application/json',
          'user-agent': 'ai-music-style-database/1.0',
        },
      },
      REQUEST_TIMEOUT_MS,
    )
    if (!response.ok) throw new Error(`model list HTTP ${response.status}`)
    const payload: unknown = await response.json()
    const list = Array.isArray(payload)
      ? payload
      : isRecord(payload) && Array.isArray(payload.data)
        ? payload.data
        : []
    return list
      .map((entry) => (isRecord(entry) && typeof entry.id === 'string' ? entry.id : null))
      .filter((id): id is string => id !== null)
  }

  private async fetchCatalog(): Promise<CatalogLookup> {
    const response = await withTimeout(
      this.fetchFn,
      this.config.catalogUrl,
      { headers: { accept: 'application/json', 'user-agent': 'ai-music-style-database/1.0' } },
      CATALOG_TIMEOUT_MS,
    )
    if (!response.ok) throw new Error(`catalog HTTP ${response.status}`)
    const payload: unknown = await response.json()
    if (!isRecord(payload)) throw new Error('catalog payload is not an object')
    return { providers: payload }
  }
}

/**
 * Used outside `api` mode: the configured model is the only one available and
 * per-request selection is disabled.
 */
export class StaticModelCatalog implements ModelCatalog {
  constructor(private readonly defaultModel: string) {}

  async info(): Promise<ModelCatalogInfo> {
    return { models: [], defaultModel: this.defaultModel, allowOverride: false, source: 'none' }
  }

  async isAllowed(): Promise<boolean> {
    return false
  }
}
