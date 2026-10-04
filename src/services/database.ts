import type { MusicDatabase, StyleDatabase } from '@/models/music'

function dataUrl(fileName: string): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${base.replace(/\/?$/, '/')}data/${fileName}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ensureMusicDatabase(value: unknown): MusicDatabase {
  if (!isRecord(value) || typeof value.version !== 'number' || !Array.isArray(value.tracks)) {
    throw new Error('The music database has an unexpected format')
  }
  return value as unknown as MusicDatabase
}

function ensureStyleDatabase(value: unknown): StyleDatabase {
  if (!isRecord(value) || typeof value.version !== 'number' || !Array.isArray(value.styles)) {
    throw new Error('The style database has an unexpected format')
  }
  return value as unknown as StyleDatabase
}

async function fetchJson(fileName: string): Promise<unknown> {
  const response = await fetch(dataUrl(fileName), {
    headers: { accept: 'application/json' },
    // Never let the browser or a CDN serve a stale database.
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`Unable to load ${fileName} (HTTP ${response.status})`)
  }
  return response.json()
}

let musicPromise: Promise<MusicDatabase> | null = null
let stylePromise: Promise<StyleDatabase> | null = null

export function loadMusicDatabase(force = false): Promise<MusicDatabase> {
  if (force || !musicPromise) {
    musicPromise = fetchJson('music.json')
      .then(ensureMusicDatabase)
      .catch((error: unknown) => {
        musicPromise = null
        throw error
      })
  }
  return musicPromise
}

export function loadStyleDatabase(force = false): Promise<StyleDatabase> {
  if (force || !stylePromise) {
    stylePromise = fetchJson('styles.json')
      .then(ensureStyleDatabase)
      .catch((error: unknown) => {
        stylePromise = null
        throw error
      })
  }
  return stylePromise
}

export const repositoryUrl = (import.meta.env.VITE_REPOSITORY_URL ?? '').replace(/\/+$/, '')

export function repositoryFileUrl(path: string): string | null {
  return repositoryUrl.length > 0 ? `${repositoryUrl}/blob/HEAD/${path}` : null
}
