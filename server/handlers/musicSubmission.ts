import type { AppConfig } from '../config.js'
import { jsonResponse, type ApiRequest, type ApiResponse } from '../http/types.js'
import type { Logger } from '../logger.js'
import type { Track } from '../services/music/database.js'
import type { MusicAnalysisResult } from '../services/opencode/types.js'
import type {
  AnalyzeOutcome,
  MusicSubmissionWorkflow,
  SubmitOutcome,
} from '../services/workflow/submitMusic.js'
import { createFeedbackToken } from '../utils/hash.js'
import { prepareSubmission } from './upload.js'

export interface SubmissionHandlerDependencies {
  readonly config: AppConfig
  readonly workflow: MusicSubmissionWorkflow
  readonly logger: Logger
  readonly requestId: string
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
    const outcome = await deps.workflow.analyze({
      input: prepared.input,
      requestId: deps.requestId,
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
    const outcome: SubmitOutcome = await deps.workflow.submit({
      input: prepared.input,
      requestId: deps.requestId,
    })

    if (outcome.status === 'unknown_style' || outcome.status === 'low_confidence') {
      return rejectionResponse(outcome, deps.requestId)
    }

    if (outcome.status === 'existing') {
      return jsonResponse(200, {
        success: true,
        existing: true,
        track: outcome.track,
        pullRequest: outcome.pullRequest,
        feedbackToken: null,
        requestId: deps.requestId,
      })
    }

    return jsonResponse(
      201,
      {
        success: true,
        existing: false,
        classification: publicClassification(outcome.classification),
        song: outcome.song,
        track: outcome.track,
        pullRequest: {
          number: outcome.pullRequest.number,
          url: outcome.pullRequest.url,
          branch: outcome.pullRequest.branch,
        },
        feedbackToken: buildFeedbackToken(deps.config, outcome.track, outcome.pullRequest.number),
        requestId: deps.requestId,
      },
      { location: outcome.pullRequest.url },
    )
  } finally {
    await prepared.workspace.cleanup()
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
