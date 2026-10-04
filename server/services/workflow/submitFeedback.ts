import type { AppConfig } from '../../config.js'
import { ApiError } from '../../errors.js'
import type { Logger } from '../../logger.js'
import { verifyFeedbackToken } from '../../utils/hash.js'
import { buildFeedbackComment, feedbackMarker } from '../github/paths.js'
import type { GitHubRepositoryClient } from '../github/types.js'

export interface FeedbackInput {
  readonly pullRequestNumber: number
  readonly trackId: string
  readonly confirmed: boolean
  readonly token: string
  readonly song?: { readonly title: string; readonly artist: string }
}

export interface FeedbackResult {
  readonly commentUrl: string
  readonly updated: boolean
}

export interface FeedbackWorkflowDependencies {
  readonly config: AppConfig
  readonly github: GitHubRepositoryClient | null
  readonly logger: Logger
}

/**
 * Records anonymous user feedback about a detected song match by posting (or
 * updating) a public comment on the submission's Pull Request. The stateless
 * HMAC token binds the feedback to one repository + PR + track id.
 */
export class FeedbackWorkflow {
  constructor(private readonly dependencies: FeedbackWorkflowDependencies) {}

  async giveFeedback(input: FeedbackInput): Promise<FeedbackResult> {
    const github = this.dependencies.github
    const config = this.dependencies.config
    if (!github || !config.github.owner || !config.github.repository) {
      throw ApiError.misconfigured('The GitHub App is not configured')
    }

    const repository = `${config.github.owner}/${config.github.repository}`
    const tokenValid = verifyFeedbackToken(config.feedbackTokenSecret, input.token, {
      repository,
      pullRequestNumber: input.pullRequestNumber,
      trackId: input.trackId,
    })
    if (!tokenValid) {
      throw ApiError.badRequest('The feedback token is invalid')
    }

    const pullRequest = await github.getPullRequest(input.pullRequestNumber)

    if (!pullRequest.branch.startsWith('submissions/')) {
      throw ApiError.badRequest('Feedback is only accepted for automated submission Pull Requests')
    }
    if (pullRequest.state !== 'open') {
      throw ApiError.conflict('This Pull Request is no longer open; feedback cannot be recorded')
    }

    const marker = feedbackMarker(input.trackId)
    const body = buildFeedbackComment(
      {
        trackId: input.trackId,
        ...(input.song ? { song: input.song } : {}),
      },
      input.confirmed,
    )

    const comments = await github.listIssueComments(input.pullRequestNumber)
    const existing = comments.find((comment) => comment.body.includes(marker))

    if (existing) {
      const updated = await github.updateIssueComment(existing.id, body)
      this.dependencies.logger.info('feedback updated on pull request', {
        pullRequest: input.pullRequestNumber,
        confirmed: input.confirmed,
      })
      return { commentUrl: updated.url, updated: true }
    }

    const created = await github.createIssueComment(input.pullRequestNumber, body)
    this.dependencies.logger.info('feedback added to pull request', {
      pullRequest: input.pullRequestNumber,
      confirmed: input.confirmed,
    })
    return { commentUrl: created.url, updated: false }
  }
}
