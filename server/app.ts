import { createHmac, randomUUID } from 'node:crypto'
import { isGitHubWriterConfigured, type AppConfig } from './config.js'
import { corsHeaders, resolveCorsOrigin } from './cors.js'
import { ApiError, GitHubError, OpenCodeError } from './errors.js'
import { getHeader, jsonResponse, type ApiRequest, type ApiResponse } from './http/types.js'
import type { Logger } from './logger.js'
import { handleFeedback } from './handlers/feedback.js'
import { handleAnalyze, handleSubmit } from './handlers/musicSubmission.js'
import type { Semaphore } from './concurrency.js'
import type { SlidingWindowRateLimiter } from './rateLimit.js'
import { DatabaseValidationError } from './services/music/database.js'
import type { ModelCatalog } from './services/opencode/modelCatalog.js'
import type { FeedbackWorkflow } from './services/workflow/submitFeedback.js'
import type { MusicSubmissionWorkflow } from './services/workflow/submitMusic.js'

const SEMAPHORE_WAIT_MS = 30_000

export interface AppDependencies {
  readonly config: AppConfig
  readonly workflow: MusicSubmissionWorkflow
  readonly feedbackWorkflow: FeedbackWorkflow
  readonly modelCatalog: ModelCatalog
  readonly rateLimiter: SlidingWindowRateLimiter
  readonly semaphore: Semaphore
  readonly logger: Logger
  readonly now?: () => Date
  readonly generateRequestId?: () => string
}

export interface App {
  handle(request: ApiRequest): Promise<ApiResponse>
}

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.replace(/\/+$/, '')
  return path
}

function clientKey(request: ApiRequest, salt: string): string {
  const forwarded = getHeader(request, 'x-forwarded-for')?.split(',')[0]?.trim()
  const realIp = getHeader(request, 'x-real-ip')
  const address = forwarded || realIp || request.remoteAddress || 'unknown'
  return createHmac('sha256', salt).update(address).digest('hex').slice(0, 32)
}

function securityHeaders(): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  }
}

function errorResponse(error: unknown, logger: Logger, requestId: string): ApiResponse {
  if (error instanceof ApiError) {
    logger.warn('request failed', { requestId, code: error.code, message: error.message })
    return jsonResponse(error.status, {
      success: false,
      reason: error.code,
      message: error.message,
      ...(error.details ?? {}),
      requestId,
    })
  }

  if (error instanceof OpenCodeError) {
    logger.error('opencode failure', { requestId, code: error.code, message: error.message })
    const timeout = error.code === 'TIMEOUT'
    return jsonResponse(timeout ? 504 : 502, {
      success: false,
      reason: timeout ? 'OPENCODE_TIMEOUT' : 'OPENCODE_FAILED',
      message: timeout
        ? 'The AI analysis service did not finish in time. Please try again.'
        : 'The AI analysis service could not produce a usable classification.',
      requestId,
    })
  }

  if (error instanceof GitHubError) {
    logger.error('github failure', {
      requestId,
      code: error.code,
      status: error.status,
      message: error.message,
    })
    if (error.isConflict) {
      return jsonResponse(409, {
        success: false,
        reason: 'CONFLICT',
        message: 'The database changed concurrently. Please try again.',
        requestId,
      })
    }
    return jsonResponse(502, {
      success: false,
      reason: 'GITHUB_FAILED',
      message: 'The repository service is temporarily unavailable. Please try again later.',
      requestId,
    })
  }

  if (error instanceof DatabaseValidationError) {
    logger.error('database validation failure', {
      requestId,
      message: error.message,
      issues: error.issues.slice(0, 10),
    })
    return jsonResponse(502, {
      success: false,
      reason: 'DATABASE_INVALID',
      message: 'The public database failed validation; no changes were made.',
      requestId,
    })
  }

  logger.error('unhandled error', {
    requestId,
    message: (error as Error).message,
    stack: (error as Error).stack?.split('\n').slice(0, 4).join(' | '),
  })
  return jsonResponse(500, {
    success: false,
    reason: 'INTERNAL',
    message: 'An unexpected error occurred.',
    requestId,
  })
}

export function createApp(dependencies: AppDependencies): App {
  const { config, logger } = dependencies
  const now = dependencies.now ?? (() => new Date())
  const generateRequestId = dependencies.generateRequestId ?? (() => randomUUID())

  async function dispatch(request: ApiRequest, requestId: string): Promise<ApiResponse> {
    const path = normalizePath(request.path)

    if (path === '/api/health') {
      if (request.method !== 'GET') {
        return jsonResponse(405, { success: false, reason: 'METHOD_NOT_ALLOWED' }, { allow: 'GET' })
      }
      return jsonResponse(200, {
        status: 'ok',
        time: now().toISOString(),
        opencodeMode: config.opencode.mode,
        songLookup: config.songLookup.enabled ? config.songLookup.provider : 'none',
        githubMode: config.github.mode,
        githubWriter: isGitHubWriterConfigured(config),
      })
    }

    if (path === '/api/opencode/models') {
      if (request.method !== 'GET') {
        return jsonResponse(405, { success: false, reason: 'METHOD_NOT_ALLOWED' }, { allow: 'GET' })
      }
      const info = await dependencies.modelCatalog.info()
      return jsonResponse(200, {
        ...info,
        contextExamples: {
          default: config.maxContextExamples,
          max: config.maxContextExamples,
        },
      })
    }

    const isAnalyze = path === '/api/analyze'
    const isSubmit = path === '/api/submit'
    const isFeedback = path === '/api/feedback'

    if (!isAnalyze && !isSubmit && !isFeedback) {
      return jsonResponse(404, { success: false, reason: 'NOT_FOUND' })
    }

    if (request.method !== 'POST') {
      return jsonResponse(
        405,
        { success: false, reason: 'METHOD_NOT_ALLOWED' },
        { allow: 'POST, OPTIONS' },
      )
    }

    const limitKey = `${clientKey(request, config.rateLimitSalt)}:${path}`
    const limit = dependencies.rateLimiter.check(limitKey)
    if (!limit.allowed) {
      return jsonResponse(
        429,
        {
          success: false,
          reason: 'RATE_LIMITED',
          message: 'Too many submissions from this client. Please wait and try again.',
          retryAfterSeconds: limit.retryAfterSeconds,
        },
        { 'retry-after': String(limit.retryAfterSeconds) },
      )
    }

    if (isFeedback) {
      return handleFeedback(request, {
        workflow: dependencies.feedbackWorkflow,
        logger,
        requestId,
      })
    }

    const release = await dependencies.semaphore.acquireWithTimeout(SEMAPHORE_WAIT_MS)
    if (!release) {
      return jsonResponse(
        503,
        {
          success: false,
          reason: 'BUSY',
          message: 'The analysis service is busy. Please try again in a moment.',
        },
        { 'retry-after': '30' },
      )
    }

    try {
      const handlerDeps = {
        config,
        workflow: dependencies.workflow,
        modelCatalog: dependencies.modelCatalog,
        logger,
        requestId,
      }
      return isAnalyze
        ? await handleAnalyze(request, handlerDeps)
        : await handleSubmit(request, handlerDeps)
    } finally {
      release()
    }
  }

  return {
    async handle(request: ApiRequest): Promise<ApiResponse> {
      const requestId = generateRequestId()
      const origin = resolveCorsOrigin(getHeader(request, 'origin'), config.allowedOrigins)
      const cors = origin ? corsHeaders(origin) : {}

      try {
        if (request.method === 'OPTIONS') {
          return {
            status: 204,
            headers: { ...securityHeaders(), ...cors },
            body: '',
          }
        }
        const response = await dispatch(request, requestId)
        return {
          status: response.status,
          headers: { ...response.headers, ...securityHeaders(), ...cors },
          body: response.body,
        }
      } catch (error) {
        const response = errorResponse(error, logger, requestId)
        return {
          status: response.status,
          headers: { ...response.headers, ...securityHeaders(), ...cors },
          body: response.body,
        }
      }
    },
  }
}
