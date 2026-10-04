import type { Classification, PullRequestRef, Track, VerifiedSong } from '@/models/music'
import { isGitHubPagesHost, resolveApiBaseUrl } from '@/services/runtimeConfig'

const API_NOT_CONFIGURED_MESSAGE =
  'This deployment has no Submission API configured, so analysis is disabled here. ' +
  'A maintainer must deploy the API and set its URL in config.json. ' +
  'See the README for deployment instructions.'

export interface SubmissionResponse {
  success: boolean
  existing?: boolean
  track?: Track
  classification?: Classification
  song?: VerifiedSong | null
  pullRequest?: PullRequestRef | null
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

function buildHeaders(file: File): Record<string, string> {
  return {
    'content-type': file.type && file.type.length > 0 ? file.type : 'application/octet-stream',
    'x-music-filename': encodeURIComponent(file.name),
  }
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

async function postAudio(path: string, file: File): Promise<SubmissionResponse> {
  const response = await fetch(await resolveUrl(path), {
    method: 'POST',
    headers: buildHeaders(file),
    body: file,
  })
  return parseResponse(response)
}

/** Full workflow: analyze, validate and (on success) open a public Pull Request. */
export function submitMusic(file: File): Promise<SubmissionResponse> {
  return postAudio('/api/submit', file)
}

/** Analysis only: never creates a Pull Request. */
export function analyzeMusic(file: File): Promise<SubmissionResponse> {
  return postAudio('/api/analyze', file)
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
