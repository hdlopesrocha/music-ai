import { describe, expect, it } from 'vitest'
import { ApiError } from '../../server/errors.js'
import { FeedbackWorkflow } from '../../server/services/workflow/submitFeedback.js'
import { createFeedbackToken } from '../../server/utils/hash.js'
import { FakeGitHubClient, silentLogger, testConfig } from '../helpers/fakes.js'

const trackId = 'a'.repeat(64)

function setup(options: { branch?: string; state?: string; withGithub?: boolean } = {}) {
  const config = testConfig()
  const github = options.withGithub === false ? null : new FakeGitHubClient()
  github?.seedPullRequest({
    number: 152,
    branch: options.branch ?? 'submissions/electronic-abcdef123456',
    state: options.state ?? 'open',
  })

  const workflow = new FeedbackWorkflow({ config, github, logger: silentLogger() })
  const token = createFeedbackToken(config.feedbackTokenSecret, {
    repository: 'test-owner/test-repo',
    pullRequestNumber: 152,
    trackId,
  })

  return { workflow, github, config, token }
}

describe('FeedbackWorkflow', () => {
  it('adds a public comment to the submission Pull Request', async () => {
    const { workflow, github, token } = setup()
    const result = await workflow.giveFeedback({
      pullRequestNumber: 152,
      trackId,
      confirmed: true,
      token,
      song: { title: 'Song', artist: 'Artist' },
    })

    expect(result.updated).toBe(false)
    if (!github) throw new Error('expected github')
    const comments = github.comments.get(152) ?? []
    expect(comments).toHaveLength(1)
    expect(comments[0]?.body).toContain(`<!-- music-ai-feedback:${trackId} -->`)
    expect(comments[0]?.body).toContain('correct')
    expect(comments[0]?.body).toContain('Song')
  })

  it('updates the existing feedback comment instead of duplicating it', async () => {
    const { workflow, github, token } = setup()
    await workflow.giveFeedback({ pullRequestNumber: 152, trackId, confirmed: true, token })
    const second = await workflow.giveFeedback({
      pullRequestNumber: 152,
      trackId,
      confirmed: false,
      token,
    })

    expect(second.updated).toBe(true)
    if (!github) throw new Error('expected github')
    const comments = github.comments.get(152) ?? []
    expect(comments).toHaveLength(1)
    expect(comments[0]?.body).toContain('incorrect')
  })

  it('rejects an invalid token before calling GitHub', async () => {
    const { workflow, github } = setup()
    await expect(
      workflow.giveFeedback({
        pullRequestNumber: 152,
        trackId,
        confirmed: true,
        token: 'f'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(ApiError)
    expect(github?.comments.size ?? 0).toBe(0)
  })

  it('rejects feedback for non-submission branches', async () => {
    const { workflow, token } = setup({ branch: 'feature/manual-work' })
    await expect(
      workflow.giveFeedback({ pullRequestNumber: 152, trackId, confirmed: true, token }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects feedback for closed Pull Requests', async () => {
    const { workflow, token } = setup({ state: 'closed' })
    await expect(
      workflow.giveFeedback({ pullRequestNumber: 152, trackId, confirmed: true, token }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('fails cleanly when GitHub is not configured', async () => {
    const { workflow, token } = setup({ withGithub: false })
    await expect(
      workflow.giveFeedback({ pullRequestNumber: 152, trackId, confirmed: true, token }),
    ).rejects.toMatchObject({ code: 'SERVER_MISCONFIGURED' })
  })
})
