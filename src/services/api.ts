import type {
  Classification,
  CommitRef,
  Publication,
  PullRequestRef,
  Track,
  VerifiedSong,
} from '@/models/music'
import { isGitHubPagesHost, resolveApiBaseUrl } from '@/services/runtimeConfig'

const API_NOT_CONFIGURED_MESSAGE =
  'This deployment has no Submission API configured, so analysis is disabled here. ' +
  'A maintainer must deploy the API and set its URL in config.json. ' +
  'See the README for deployment instructions.'

export interface SubmissionResponse {
  success: boolean
  existing?: boolean
  replaced?: boolean
  track?: Track
  classification?: Classification
  song?: VerifiedSong | null
  publication?: Publication | null
  pullRequest?: PullRequestRef | null
  commit?: CommitRef | null
  feedbackToken?: string | null
  reason?: string
  style?: string
  confidence?: number
  threshold?: number
  message?: string
  requiredAction?: string
  requestId?: string
}

export interface FeedbackRequest {
  pullRequestNumber: number
  trackId: string
  confirmed: boolean
  token: string
  song?: { title: string; artist: string }
}

export interface FeedbackResponse {
  success: boolean
  updated?: boolean
  commentUrl?: string
  message?: string
}

export interface AnalysisModelOption {
  id: string
  label: string
  media: string[]
}

export interface AnalysisOptionsResponse {
  models: AnalysisModelOption[]
  defaultModel: string
  allowOverride: boolean
  source: 'allowlist' | 'catalog' | 'none'
  contextExamples: { default: number; max: number }
}

export interface SubmitOptions {
  model?: string
  contextExamples?: number
  /** Re-analyze and replace the existing entry when the audio was seen before. */
  replace?: boolean
}

export class ApiRequestError extends Error {
  readonly status: number
  readonly reason: string | undefined

  constructor(message: string, status: number, reason: string | undefined) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.reason = reason
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function buildHeaders(file: File, options: SubmitOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': file.type && file.type.length > 0 ? file.type : 'application/octet-stream',
    'x-music-filename': encodeURIComponent(file.name),
  }
  if (options.model) headers['x-analysis-model'] = options.model
  if (options.contextExamples !== undefined) {
    headers['x-context-examples'] = String(options.contextExamples)
  }
  if (options.replace) headers['x-replace-existing'] = 'true'
  return headers
}

async function parseResponse(response: Response): Promise<SubmissionResponse> {
  const text = await response.text()
  let payload: unknown = null
  if (text.length > 0) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.message === 'string'
        ? payload.message
        : `The request failed with status ${response.status}`
    const reason =
      isRecord(payload) && typeof payload.reason === 'string' ? payload.reason : undefined
    throw new ApiRequestError(message, response.status, reason)
  }

  if (!isRecord(payload)) {
    throw new ApiRequestError(
      'The server returned an unexpected response',
      response.status,
      undefined,
    )
  }

  return payload as unknown as SubmissionResponse
}

async function resolveUrl(path: string): Promise<string> {
  const base = await resolveApiBaseUrl()
  if (base.length > 0) return `${base}${path}`
  // Same-origin is legitimate for dev (Vite proxy) and self-hosted deployments,
  // but impossible on GitHub Pages, where POST would return a confusing 405.
  if (isGitHubPagesHost()) {
    throw new ApiRequestError(API_NOT_CONFIGURED_MESSAGE, 0, 'API_NOT_CONFIGURED')
  }
  return path
}

async function postAudio(
  path: string,
  file: File,
  options: SubmitOptions = {},
): Promise<SubmissionResponse> {
  const response = await fetch(await resolveUrl(path), {
    method: 'POST',
    headers: buildHeaders(file, options),
    body: file,
  })
  return parseResponse(response)
}

/** Full workflow: analyze, validate and (on success) open a public Pull Request. */
export function submitMusic(file: File, options: SubmitOptions = {}): Promise<SubmissionResponse> {
  return postAudio('/api/submit', file, options)
}

/** Analysis only: never creates a Pull Request. */
export function analyzeMusic(file: File, options: SubmitOptions = {}): Promise<SubmissionResponse> {
  return postAudio('/api/analyze', file, options)
}

export interface SimilarArtistsResponse {
  success: boolean
  artist: string
  neighbors: string[]
  source: 'music-map' | 'disabled'
}

/**
 * Fetches similar artists from the server, which proxies music-map.com with
 * caching and rate limiting.
 */
export async function fetchSimilarArtists(artist: string): Promise<SimilarArtistsResponse> {
  const url = new URL(await resolveUrl('/api/similar-artists'), window.location.origin)
  url.searchParams.set('artist', artist)
  const response = await fetch(url.toString(), {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  const text = await response.text()
  let payload: unknown = null
  if (text.length > 0) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.message === 'string'
        ? payload.message
        : `The discovery request failed with status ${response.status}`
    const reason =
      isRecord(payload) && typeof payload.reason === 'string' ? payload.reason : undefined
    throw new ApiRequestError(message, response.status, reason)
  }
  return payload as unknown as SimilarArtistsResponse
}

/**
 * Lists the media-capable models the server allows and the context-size bounds.
 * Returns null when the API is unreachable or not configured; the Analyze page
 * then simply uses the server default.
 */
export async function fetchAnalysisOptions(): Promise<AnalysisOptionsResponse | null> {
  try {
    const response = await fetch(await resolveUrl('/api/opencode/models'), {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    if (!response.ok) return null
    const payload: unknown = await response.json()
    return isRecord(payload) ? (payload as unknown as AnalysisOptionsResponse) : null
  } catch {
    return null
  }
}

export async function sendFeedback(request: FeedbackRequest): Promise<FeedbackResponse> {
  const response = await fetch(await resolveUrl('/api/feedback'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  const text = await response.text()
  let payload: unknown = null
  if (text.length > 0) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.message === 'string'
        ? payload.message
        : `The feedback request failed with status ${response.status}`
    const reason =
      isRecord(payload) && typeof payload.reason === 'string' ? payload.reason : undefined
    throw new ApiRequestError(message, response.status, reason)
  }
  return (isRecord(payload) ? payload : { success: true }) as unknown as FeedbackResponse
}
