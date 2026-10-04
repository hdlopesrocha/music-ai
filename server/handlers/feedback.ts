import { z } from 'zod'
import { ApiError } from '../errors.js'
import { jsonResponse, type ApiRequest, type ApiResponse } from '../http/types.js'
import type { Logger } from '../logger.js'
import type { FeedbackWorkflow } from '../services/workflow/submitFeedback.js'

const FeedbackRequestSchema = z
  .object({
    pullRequestNumber: z.number().int().positive().max(10_000_000),
    trackId: z.string().regex(/^[a-f0-9]{64}$/, 'trackId must be a SHA-256 hex string'),
    confirmed: z.boolean(),
    token: z.string().min(32).max(256),
    song: z
      .object({
        title: z.string().trim().min(1).max(300),
        artist: z.string().trim().min(1).max(300),
      })
      .strict()
      .optional(),
  })
  .strict()

export interface FeedbackHandlerDependencies {
  readonly workflow: FeedbackWorkflow
  readonly logger: Logger
  readonly requestId: string
}

export async function handleFeedback(
  req: ApiRequest,
  deps: FeedbackHandlerDependencies,
): Promise<ApiResponse> {
  let raw: unknown
  try {
    raw = JSON.parse(req.body.toString('utf8'))
  } catch {
    throw ApiError.badRequest('The request body must be valid JSON')
  }

  const parsed = FeedbackRequestSchema.safeParse(raw)
  if (!parsed.success) {
    throw ApiError.badRequest('Invalid feedback payload', {
      issues: parsed.error.issues.map((issue) => issue.path.join('.') || '(root)'),
    })
  }

  const result = await deps.workflow.giveFeedback({
    pullRequestNumber: parsed.data.pullRequestNumber,
    trackId: parsed.data.trackId,
    confirmed: parsed.data.confirmed,
    token: parsed.data.token,
    ...(parsed.data.song ? { song: parsed.data.song } : {}),
  })

  deps.logger.info('feedback recorded', {
    requestId: deps.requestId,
    pullRequest: parsed.data.pullRequestNumber,
    confirmed: parsed.data.confirmed,
    updated: result.updated,
  })

  return jsonResponse(200, {
    success: true,
    updated: result.updated,
    commentUrl: result.commentUrl,
  })
}
