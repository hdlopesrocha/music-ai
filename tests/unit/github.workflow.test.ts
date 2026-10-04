import { describe, expect, it } from 'vitest'
import { ApiError, GitHubError } from '../../server/errors.js'
import { GitHubDatabaseSource } from '../../server/services/database/source.js'
import { buildBranchName } from '../../server/services/github/paths.js'
import { parseMusicDatabase, serializeMusicDatabase } from '../../server/services/music/database.js'
import { NoopSongIdentificationService } from '../../server/services/song/types.js'
import { MusicSubmissionWorkflow } from '../../server/services/workflow/submitMusic.js'
import type { MusicAnalysisResult } from '../../server/services/opencode/types.js'
import {
  FakeGitHubClient,
  FakeMusicAnalysisAgent,
  makeAudioInput,
  silentLogger,
  testConfig,
} from '../helpers/fakes.js'

function createWorkflow(
  options: {
    agentResult?: Partial<MusicAnalysisResult>
    music?: unknown
    env?: Record<string, string>
  } = {},
) {
  const config = testConfig(options.env)
  const github = new FakeGitHubClient()
  github.seedBaseFile(
    config.styleDatabasePath,
    JSON.stringify({ version: 1, styles: ['Electronic', 'Techno', 'Jazz'] }),
  )
  github.seedBaseFile(
    config.musicDatabasePath,
    serializeMusicDatabase((options.music as never) ?? { version: 1, tracks: [] }),
  )

  const agent = new FakeMusicAnalysisAgent(options.agentResult)
  const databaseSource = new GitHubDatabaseSource(
    github,
    { styles: config.styleDatabasePath, music: config.musicDatabasePath },
    config.github.baseBranch,
  )

  const workflow = new MusicSubmissionWorkflow({
    config,
    agent,
    songIdentification: new NoopSongIdentificationService(),
    databaseSource,
    github,
    logger: silentLogger(),
    now: () => new Date('2026-10-04T12:00:00.000Z'),
    sleep: async () => undefined,
  })

  return { workflow, github, agent, config }
}

describe('analyze', () => {
  it('classifies a track, canonicalizing the style', async () => {
    const { workflow, github, agent } = createWorkflow({
      agentResult: { style: 'techno', confidence: 0.95 },
    })
    const outcome = await workflow.analyze({ input: makeAudioInput(), requestId: 'r1' })

    expect(outcome.status).toBe('classified')
    if (outcome.status === 'classified') {
      expect(outcome.track.style).toBe('Techno')
      expect(outcome.track.id).toBe(makeAudioInput().sha256)
      expect(outcome.track.source).toBe('opencode')
      expect(outcome.track.confidence).toBe(0.95)
    }
    expect(agent.calls).toBe(1)
    expect(github.updateFileCalls).toBe(0)
  })

  it('short-circuits duplicates without invoking OpenCode', async () => {
    const input = makeAudioInput()
    const existingTrack = {
      id: input.sha256,
      fileName: 'old-name.mp3',
      style: 'Electronic',
      confidence: 0.9,
      detectedAt: '2025-01-01T00:00:00.000Z',
      source: 'opencode',
    }
    const { workflow, agent } = createWorkflow({ music: { version: 1, tracks: [existingTrack] } })
    const outcome = await workflow.analyze({ input, requestId: 'r2' })

    expect(outcome.status).toBe('existing')
    if (outcome.status === 'existing') {
      expect(outcome.track.fileName).toBe('old-name.mp3')
    }
    expect(agent.calls).toBe(0)
  })

  it('reports unknown styles without writing anything', async () => {
    const { workflow, github } = createWorkflow({
      agentResult: { style: 'Progressive Balkan Electronica', confidence: 0.99 },
    })
    const outcome = await workflow.analyze({ input: makeAudioInput(), requestId: 'r3' })
    expect(outcome.status).toBe('unknown_style')
    expect(github.updateFileCalls).toBe(0)
  })

  it('reports low confidence with the threshold', async () => {
    const { workflow } = createWorkflow({ agentResult: { confidence: 0.42 } })
    const outcome = await workflow.analyze({ input: makeAudioInput(), requestId: 'r4' })
    expect(outcome.status).toBe('low_confidence')
    if (outcome.status === 'low_confidence') {
      expect(outcome.threshold).toBe(0.7)
      expect(outcome.confidence).toBe(0.42)
    }
  })

  it('rejects a malformed database before analysis', async () => {
    const { workflow, agent } = createWorkflow({ music: { version: 1, tracks: [{ bad: true }] } })
    await expect(
      workflow.analyze({ input: makeAudioInput(), requestId: 'r5' }),
    ).rejects.toThrowError(/failed schema validation/)
    expect(agent.calls).toBe(0)
  })
})

describe('submit', () => {
  it('creates a branch, commits music.json and opens a Pull Request', async () => {
    const input = makeAudioInput()
    const { workflow, github, config } = createWorkflow()
    const outcome = await workflow.submit({ input, requestId: 'r6' })

    expect(outcome.status).toBe('classified')
    if (outcome.status !== 'classified') throw new Error('expected classified')

    const expectedBranch = buildBranchName('Electronic', input.sha256)
    expect(outcome.publication.branch).toBe(expectedBranch)
    expect(github.branches.has(expectedBranch)).toBe(true)
    expect(outcome.publication.number).toBeGreaterThan(0)

    const committed = github.branchFiles.get(expectedBranch)?.get(config.musicDatabasePath)
    expect(committed).toBeDefined()
    const database = parseMusicDatabase(committed ?? '')
    expect(database.tracks).toHaveLength(1)
    expect(database.tracks[0]?.id).toBe(input.sha256)

    const body = github.pullRequests[0]?.body ?? ''
    expect(body).toContain('## Music Classification')
    expect(body).toContain('**Style:** Electronic')
    expect(body).toContain('**Confidence:** 94%')
    expect(body).toContain('**Analysis engine:** OpenCode')
    expect(body).toContain('The original audio file is not included')
    expect(body).not.toContain(input.filePath)
  })

  it('requires a configured GitHub writer', async () => {
    const config = testConfig()
    const github = new FakeGitHubClient()
    github.seedBaseFile(
      config.styleDatabasePath,
      JSON.stringify({ version: 1, styles: ['Electronic'] }),
    )
    github.seedBaseFile(
      config.musicDatabasePath,
      serializeMusicDatabase({ version: 1, tracks: [] }),
    )
    const databaseSource = new GitHubDatabaseSource(
      github,
      { styles: config.styleDatabasePath, music: config.musicDatabasePath },
      config.github.baseBranch,
    )
    const workflow = new MusicSubmissionWorkflow({
      config,
      agent: new FakeMusicAnalysisAgent(),
      songIdentification: new NoopSongIdentificationService(),
      databaseSource,
      github: null,
      logger: silentLogger(),
    })

    await expect(
      workflow.submit({ input: makeAudioInput(), requestId: 'r7' }),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('returns the existing entry when the id is already in music.json', async () => {
    const input = makeAudioInput()
    const { workflow, github } = createWorkflow({
      music: {
        version: 1,
        tracks: [
          {
            id: input.sha256,
            fileName: 'merged.mp3',
            style: 'Jazz',
            confidence: 0.8,
            detectedAt: '2025-01-01T00:00:00.000Z',
            source: 'opencode',
          },
        ],
      },
    })
    const outcome = await workflow.submit({ input, requestId: 'r8' })
    expect(outcome.status).toBe('existing')
    if (outcome.status === 'existing') {
      expect(outcome.publication).toBeNull()
      expect(outcome.track.style).toBe('Jazz')
    }
    expect(github.pullRequests).toHaveLength(0)
  })

  it('does not open a duplicate PR when an open PR already exists for the track', async () => {
    const input = makeAudioInput()
    const { workflow, github } = createWorkflow()
    const branch = buildBranchName('Electronic', input.sha256)
    github.seedPullRequest({ branch, number: 55 })

    const outcome = await workflow.submit({ input, requestId: 'r9' })
    expect(outcome.status).toBe('existing')
    if (outcome.status === 'existing') {
      expect(outcome.publication?.number).toBe(55)
    }
    expect(github.updateFileCalls).toBe(0)
  })

  it('retries safely on a concurrent database update', async () => {
    const { workflow, github } = createWorkflow()
    github.updateFileFailures = 1

    const outcome = await workflow.submit({ input: makeAudioInput(), requestId: 'r10' })
    expect(outcome.status).toBe('classified')
    expect(github.updateFileCalls).toBe(2)
    expect(github.pullRequests).toHaveLength(1)
  })

  it('survives a branch created by a concurrent request', async () => {
    const { workflow, github } = createWorkflow()
    github.createBranchConflict = true

    const outcome = await workflow.submit({ input: makeAudioInput(), requestId: 'r11' })
    expect(outcome.status).toBe('classified')
    expect(github.pullRequests).toHaveLength(1)
  })

  it('commits directly to the base branch without a Pull Request', async () => {
    const input = makeAudioInput()
    const { workflow, github, config } = createWorkflow({
      env: { GITHUB_WRITE_MODE: 'direct' },
    })
    const outcome = await workflow.submit({ input, requestId: 'direct-1' })

    expect(outcome.status).toBe('classified')
    if (outcome.status !== 'classified') throw new Error('expected classified')
    expect(outcome.publication.type).toBe('commit')
    expect(outcome.publication.branch).toBe('main')
    expect(outcome.publication.commitSha).toBeTruthy()
    expect(outcome.publication.url).toContain('/commit/')
    expect(github.pullRequests).toHaveLength(0)

    const database = parseMusicDatabase(github.baseFiles.get(config.musicDatabasePath) ?? '')
    expect(database.tracks).toHaveLength(1)
    expect(database.tracks[0]?.id).toBe(input.sha256)
  })

  it('replaces an existing entry when replace is requested', async () => {
    const input = makeAudioInput()
    const existingTrack = {
      id: input.sha256,
      fileName: 'old-name.mp3',
      style: 'Jazz',
      confidence: 0.8,
      detectedAt: '2025-01-01T00:00:00.000Z',
      source: 'opencode',
    }
    const { workflow, github, config } = createWorkflow({
      music: { version: 1, tracks: [existingTrack] },
      agentResult: { style: 'Techno', confidence: 0.91 },
      env: { GITHUB_WRITE_MODE: 'direct' },
    })

    const outcome = await workflow.submit({
      input,
      requestId: 'replace-1',
      options: { replace: true },
    })

    expect(outcome.status).toBe('classified')
    if (outcome.status !== 'classified') throw new Error('expected classified')
    expect(outcome.replaced).toBe(true)
    expect(outcome.track.style).toBe('Techno')

    const database = parseMusicDatabase(github.baseFiles.get(config.musicDatabasePath) ?? '')
    expect(database.tracks).toHaveLength(1)
    expect(database.tracks[0]?.style).toBe('Techno')
    expect(github.pullRequests).toHaveLength(0)
  })

  it('retries direct commits and reports duplicates from the base branch', async () => {
    const { workflow, github } = createWorkflow({ env: { GITHUB_WRITE_MODE: 'direct' } })
    github.updateFileFailures = 1

    const first = await workflow.submit({ input: makeAudioInput(), requestId: 'direct-2' })
    expect(first.status).toBe('classified')
    expect(github.updateFileCalls).toBe(2)
    expect(github.pullRequests).toHaveLength(0)

    const second = await workflow.submit({ input: makeAudioInput(), requestId: 'direct-3' })
    expect(second.status).toBe('existing')
    if (second.status === 'existing') {
      expect(second.publication).toBeNull()
    }
  })

  it('fails with a conflict when retries are exhausted', async () => {
    const { workflow, github } = createWorkflow()
    github.updateFileFailures = 10
    await expect(
      workflow.submit({ input: makeAudioInput(), requestId: 'r12' }),
    ).rejects.toBeInstanceOf(GitHubError)
    expect(github.pullRequests).toHaveLength(0)
  })
})
