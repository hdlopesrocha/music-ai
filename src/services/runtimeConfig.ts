export interface RuntimeConfig {
  apiBaseUrl?: string
}

let cached: RuntimeConfig | null = null

export function isGitHubPagesHost(hostname: string = window.location.hostname): boolean {
  return hostname === 'github.io' || hostname.endsWith('.github.io')
}

function configUrl(): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${base.replace(/\/?$/, '/')}config.json`
}

function parseRuntimeConfig(value: unknown): RuntimeConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const apiBaseUrl =
    typeof record.apiBaseUrl === 'string' && record.apiBaseUrl.trim().length > 0
      ? record.apiBaseUrl
      : undefined
  return { ...(apiBaseUrl ? { apiBaseUrl } : {}) }
}

/**
 * Loads `config.json` shipped next to the built site.
 *
 * This lets an operator point a deployed frontend at a Submission API without
 * rebuilding: edit `config.json` in the gh-pages branch (or in `public/` before
 * building). The build-time `VITE_API_BASE_URL` takes precedence when set.
 */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (cached) return cached
  try {
    const response = await fetch(configUrl(), {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) {
      cached = {}
      return cached
    }
    cached = parseRuntimeConfig(await response.json())
  } catch {
    cached = {}
  }
  return cached
}

export async function resolveApiBaseUrl(): Promise<string> {
  const fromEnv = (import.meta.env.VITE_API_BASE_URL ?? '').trim()
  if (fromEnv.length > 0) return fromEnv.replace(/\/+$/, '')
  const config = await loadRuntimeConfig()
  return (config.apiBaseUrl ?? '').replace(/\/+$/, '')
}
