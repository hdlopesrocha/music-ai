import type { AppConfig } from '../config.js'
import { ApiError } from '../errors.js'
import { getHeader, jsonResponse, type ApiRequest, type ApiResponse } from '../http/types.js'
import type { Logger } from '../logger.js'
import type { Track } from '../services/music/database.js'
import type { ModelCatalog } from '../services/opencode/modelCatalog.js'
import type { MusicAnalysisResult } from '../services/opencode/types.js'
import type {
  AnalysisOptions,
  AnalyzeOutcome,
  MusicSubmissionWorkflow,
  Publication,
  SubmitOutcome,
} from '../services/workflow/submitMusic.js'
import { createFeedbackToken } from '../utils/hash.js'
import { truncate } from '../utils/text.js'
import { prepareSubmission } from './upload.js'

export interface SubmissionHandlerDependencies {
  readonly config: AppConfig
  readonly workflow: MusicSubmissionWorkflow
  readonly modelCatalog: ModelCatalog
  readonly logger: Logger
  readonly requestId: string
}

/**
 * Reads optional per-request analysis settings from headers. The model must be
 * present in the media-capable catalog; the context size is clamped so an
 * anonymous caller can never inflate prompts beyond the configured maximum.
 */
async function resolveAnalysisOptions(
  req: ApiRequest,
  deps: SubmissionHandlerDependencies,
): Promise<AnalysisOptions> {
  const options: { model?: string; contextExamples?: number } = {}

  const modelHeader = getHeader(req, 'x-analysis-model')?.trim()
  if (modelHeader && modelHeader.length > 0) {
    if (!(await deps.modelCatalog.isAllowed(modelHeader))) {
      throw ApiError.badRequest(
        `Model "${truncate(modelHeader, 80)}" is not available for media analysis`,
      )
    }
    options.model = modelHeader
  }

  const contextHeader = getHeader(req, 'x-context-examples')?.trim()
  if (contextHeader && contextHeader.length > 0) {
    const parsed = Number.parseInt(contextHeader, 10)
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw ApiError.badRequest('x-context-examples must be a non-negative integer')
    }
    options.contextExamples = Math.min(parsed, deps.config.maxContextExamples)
  }

  return options
}

function publicClassification(classification: MusicAnalysisResult): Record<string, unknown> {
  return {
    style: classification.style,
    confidence: classification.confidence,
    substyles: classification.substyles ?? [],
    tags: classification.tags ?? [],
    instrumental: classification.instrumental ?? null,
    lyrics: classification.lyrics ?? '',
    lyricsLanguage: classification.lyricsLanguage ?? null,
    songMatch: classification.songMatch ?? null,
    diagnostics: classification.diagnostics ?? null,
  }
}

function rejectionResponse(
  outcome: Extract<AnalyzeOutcome, { status: 'unknown_style' | 'low_confidence' }>,
  requestId: string,
): ApiResponse {
  if (outcome.status === 'unknown_style') {
    return jsonResponse(200, {
      success: false,
      reason: 'UNKNOWN_STYLE',
      style: outcome.detectedStyle,
      confidence: outcome.confidence,
      classification: publicClassification(outcome.classification),
      requiredAction: 'The detected style is not part of styles.json. No Pull Request was created.',
      requestId,
    })
  }
  return jsonResponse(200, {
    success: false,
    reason: 'LOW_CONFIDENCE',
    style: outcome.detectedStyle,
    confidence: outcome.confidence,
    threshold: outcome.threshold,
    classification: publicClassification(outcome.classification),
    requiredAction:
      'The classification did not reach the configured confidence threshold. No Pull Request was created.',
    requestId,
  })
}

export async function handleAnalyze(
  req: ApiRequest,
  deps: SubmissionHandlerDependencies,
): Promise<ApiResponse> {
  const prepared = await prepareSubmission(req, deps.config)
  try {
    const options = await resolveAnalysisOptions(req, deps)
    const outcome = await deps.workflow.analyze({
      input: prepared.input,
      requestId: deps.requestId,
      options,
    })

    if (outcome.status === 'existing') {
      return jsonResponse(200, {
        success: true,
        existing: true,
        track: outcome.track,
        requestId: deps.requestId,
      })
    }
    if (outcome.status === 'unknown_style' || outcome.status === 'low_confidence') {
      return rejectionResponse(outcome, deps.requestId)
    }

    return jsonResponse(200, {
      success: true,
      existing: false,
      classification: publicClassification(outcome.classification),
      song: outcome.song,
      track: outcome.track,
      requestId: deps.requestId,
    })
  } finally {
    await prepared.workspace.cleanup()
  }
}

export async function handleSubmit(
  req: ApiRequest,
  deps: SubmissionHandlerDependencies,
): Promise<ApiResponse> {
  const prepared = await prepareSubmission(req, deps.config)
  try {
    const options = await resolveAnalysisOptions(req, deps)
    const outcome: SubmitOutcome = await deps.workflow.submit({
      input: prepared.input,
      requestId: deps.requestId,
      options,
    })

    if (outcome.status === 'unknown_style' || outcome.status === 'low_confidence') {
      return rejectionResponse(outcome, deps.requestId)
    }

    if (outcome.status === 'existing') {
      return jsonResponse(200, {
        success: true,
        existing: true,
        track: outcome.track,
        publication: publicPublication(outcome.publication),
        pullRequest: publicPullRequest(outcome.publication),
        commit: publicCommit(outcome.publication),
        feedbackToken: null,
        requestId: deps.requestId,
      })
    }

    const publication = outcome.publication
    const pullRequest = publicPullRequest(publication)
    const feedbackNumber = publication.type === 'pull-request' ? publication.number : undefined

    return jsonResponse(
      201,
      {
        success: true,
        existing: false,
        classification: publicClassification(outcome.classification),
        song: outcome.song,
        track: outcome.track,
        publication: publicPublication(publication),
        pullRequest,
        commit: publicCommit(publication),
        feedbackToken:
          feedbackNumber !== undefined
            ? buildFeedbackToken(deps.config, outcome.track, feedbackNumber)
            : null,
        requestId: deps.requestId,
      },
      { location: publication.url },
    )
  } finally {
    await prepared.workspace.cleanup()
  }
}

function publicPublication(publication: Publication | null): Record<string, unknown> | null {
  if (!publication) return null
  return {
    type: publication.type,
    url: publication.url,
    branch: publication.branch,
    number: publication.number ?? null,
    commitSha: publication.commitSha ?? null,
  }
}

function publicPullRequest(publication: Publication | null): Record<string, unknown> | null {
  if (!publication || publication.type !== 'pull-request' || publication.number === undefined) {
    return null
  }
  return { number: publication.number, url: publication.url, branch: publication.branch }
}

function publicCommit(publication: Publication | null): Record<string, unknown> | null {
  if (!publication || publication.type !== 'commit') return null
  return {
    sha: publication.commitSha ?? null,
    url: publication.url,
    branch: publication.branch,
  }
}

function buildFeedbackToken(
  config: AppConfig,
  track: Track,
  pullRequestNumber: number,
): string | null {
  if (!config.github.owner || !config.github.repository) return null
  return createFeedbackToken(config.feedbackTokenSecret, {
    repository: `${config.github.owner}/${config.github.repository}`,
    pullRequestNumber,
    trackId: track.id,
  })
}
