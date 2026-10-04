import { describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { Semaphore } from '../../server/concurrency.js'
import { OpenCodeError } from '../../server/errors.js'
import type { ApiRequest, ApiResponse } from '../../server/http/types.js'
import { SlidingWindowRateLimiter } from '../../server/rateLimit.js'
import { GitHubDatabaseSource } from '../../server/services/database/source.js'
import { parseMusicDatabase, serializeMusicDatabase } from '../../server/services/music/database.js'
import type { ModelCatalog } from '../../server/services/opencode/modelCatalog.js'
import type { MusicAnalysisAgent } from '../../server/services/opencode/types.js'
import { NoopSongIdentificationService } from '../../server/services/song/types.js'
import { FeedbackWorkflow } from '../../server/services/workflow/submitFeedback.js'
import { MusicSubmissionWorkflow } from '../../server/services/workflow/submitMusic.js'
import { fakeFlac, fakeMp3 } from '../helpers/audio.js'
import {
  FakeGitHubClient,
  FakeModelCatalog,
  FakeMusicAnalysisAgent,
  makeTrack,
  silentLogger,
  testConfig,
} from '../helpers/fakes.js'

interface HarnessOptions {
  env?: Record<string, string>
  agent?: MusicAnalysisAgent
  modelCatalog?: ModelCatalog
  seedMusic?: boolean
  clock?: () => number
}

function createHarness(options: HarnessOptions = {}) {
  const config = testConfig(options.env)
  const github = new FakeGitHubClient()
  github.seedBaseFile(
    config.styleDatabasePath,
    JSON.stringify({ version: 1, styles: ['Electronic', 'Techno', 'Jazz'] }),
  )
  if (options.seedMusic !== false) {
    github.seedBaseFile(
      config.musicDatabasePath,
      serializeMusicDatabase({ version: 1, tracks: [] }),
    )
  }

  const databaseSource = new GitHubDatabaseSource(
    github,
    { styles: config.styleDatabasePath, music: config.musicDatabasePath },
    config.github.baseBranch,
  )
  const agent = options.agent ?? new FakeMusicAnalysisAgent()
  const logger = silentLogger()

  const workflow = new MusicSubmissionWorkflow({
    config,
    agent,
    songIdentification: new NoopSongIdentificationService(),
    databaseSource,
    github,
    logger,
    now: () => new Date('2026-10-04T12:00:00.000Z'),
    sleep: async () => undefined,
  })
  const feedbackWorkflow = new FeedbackWorkflow({ config, github, logger })
  const rateLimiter = new SlidingWindowRateLimiter({
    windowMs: config.rateLimitWindowMs,
    maxRequests: config.rateLimitMaxRequests,
    ...(options.clock ? { clock: options.clock } : {}),
  })

  const modelCatalog = options.modelCatalog ?? new FakeModelCatalog([], config.opencode.model)
  const app = createApp({
    config,
    workflow,
    feedbackWorkflow,
    modelCatalog,
    rateLimiter,
    semaphore: new Semaphore(2),
    logger,
    generateRequestId: () => 'test-request',
  })

  return { app, github, config, agent }
}

interface SubmissionOverrides {
  path?: string
  method?: string
  filename?: string | null
  body?: Buffer
  contentType?: string
  headers?: Record<string, string>
}

function submissionRequest(overrides: SubmissionOverrides = {}): ApiRequest {
  const headers: Record<string, string> = {
    'content-type': overrides.contentType ?? 'audio/mpeg',
    ...overrides.headers,
  }
  if (overrides.filename !== null) {
    headers['x-music-filename'] = encodeURIComponent(overrides.filename ?? 'song.mp3')
  }
  return {
    method: overrides.method ?? 'POST',
    path: overrides.path ?? '/api/submit',
    query: {},
    headers,
    body: overrides.body ?? fakeMp3(),
  }
}

function jsonRequest(path: string, payload: unknown): ApiRequest {
  return {
    method: 'POST',
    path,
    query: {},
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify(payload)),
  }
}

function bodyOf(response: ApiResponse): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>
}

describe('health and routing', () => {
  it('reports health without secrets', async () => {
    const { app } = createHarness()
    const response = await app.handle({
      method: 'GET',
      path: '/api/health',
      query: {},
      headers: {},
      body: Buffer.alloc(0),
    })
    expect(response.status).toBe(200)
    const body = bodyOf(response)
    expect(body.status).toBe('ok')
    expect(JSON.stringify(body)).not.toContain('test-owner')
  })

  it('returns 404 for unknown routes and 405 for wrong methods', async () => {
    const { app } = createHarness()
    expect(
      (
        await app.handle({
          method: 'POST',
          path: '/api/nope',
          query: {},
          headers: {},
          body: Buffer.alloc(0),
        })
      ).status,
    ).toBe(404)
    expect((await app.handle(submissionRequest({ method: 'GET' }))).status).toBe(405)
  })
})

describe('anonymous submissions', () => {
  it('accepts a submission without any authentication and opens a PR', async () => {
    const { app, github } = createHarness()
    const response = await app.handle(submissionRequest())
    expect(response.status).toBe(201)

    const body = bodyOf(response)
    expect(body.success).toBe(true)
    expect(body.existing).toBe(false)
    expect(body.feedbackToken).toBeTypeOf('string')
    expect(body.requestId).toBe('test-request')

    const track = body.track as Record<string, unknown>
    expect(track.style).toBe('Electronic')
    expect(track.fileName).toBe('song.mp3')
    expect(github.pullRequests).toHaveLength(1)
    expect(body.pullRequest).toMatchObject({ number: github.pullRequests[0]?.number })
    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })

  it('analyzes without creating a Pull Request', async () => {
    const { app, github } = createHarness()
    const response = await app.handle(submissionRequest({ path: '/api/analyze' }))
    expect(response.status).toBe(200)
    const body = bodyOf(response)
    expect(body.success).toBe(true)
    expect(body.pullRequest).toBeUndefined()
    expect(github.pullRequests).toHaveLength(0)
    expect(github.updateFileCalls).toBe(0)
  })

  it('returns the existing entry for a duplicate submission', async () => {
    const { app } = createHarness()
    const first = await app.handle(submissionRequest())
    const second = await app.handle(submissionRequest())

    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(bodyOf(second).existing).toBe(true)
    expect(bodyOf(second).pullRequest).toBeTruthy()
  })

  it('rejects unknown styles without creating a PR', async () => {
    const { app, github } = createHarness({
      agent: new FakeMusicAnalysisAgent({
        style: 'Progressive Balkan Electronica',
        confidence: 0.99,
      }),
    })
    const response = await app.handle(submissionRequest())
    const body = bodyOf(response)
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ success: false, reason: 'UNKNOWN_STYLE' })
    expect(body.style).toBe('Progressive Balkan Electronica')
    expect(github.pullRequests).toHaveLength(0)
  })

  it('rejects low confidence without creating a PR', async () => {
    const { app, github } = createHarness({
      agent: new FakeMusicAnalysisAgent({ confidence: 0.42 }),
    })
    const response = await app.handle(submissionRequest())
    const body = bodyOf(response)
    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: false,
      reason: 'LOW_CONFIDENCE',
      confidence: 0.42,
      threshold: 0.7,
    })
    expect(github.pullRequests).toHaveLength(0)
  })
})

describe('abuse protection', () => {
  it('enforces rate limits per client and route', async () => {
    const { app } = createHarness({ env: { RATE_LIMIT_MAX_REQUESTS: '2' } })
    expect((await app.handle(submissionRequest({ body: fakeMp3('one') }))).status).toBe(201)
    const second = await app.handle(
      submissionRequest({ filename: 'other.mp3', body: fakeMp3('two') }),
    )
    expect(second.status).toBe(201)

    const third = await app.handle(
      submissionRequest({ filename: 'third.mp3', body: fakeMp3('three') }),
    )
    expect(third.status).toBe(429)
    expect(third.headers['retry-after']).toBeDefined()
    expect(bodyOf(third).reason).toBe('RATE_LIMITED')
  })

  it('rejects requests without a file name', async () => {
    const { app } = createHarness()
    const response = await app.handle(submissionRequest({ filename: null }))
    expect(response.status).toBe(400)
    expect(bodyOf(response).message).toContain('X-Music-Filename')
  })

  it('sanitizes malicious file names', async () => {
    const { app } = createHarness()
    const response = await app.handle(submissionRequest({ filename: '../../etc/passwd.mp3' }))
    expect(response.status).toBe(201)
    const track = bodyOf(response).track as Record<string, unknown>
    expect(track.fileName).toBe('passwd.mp3')
  })

  it('rejects unsupported extensions', async () => {
    const { app } = createHarness()
    const response = await app.handle(
      submissionRequest({ filename: 'exploit.exe', contentType: 'application/octet-stream' }),
    )
    expect(response.status).toBe(400)
    expect(bodyOf(response).message).toContain('Unsupported file extension')
  })

  it('rejects mismatched content types', async () => {
    const { app } = createHarness()
    const response = await app.handle(submissionRequest({ contentType: 'text/plain' }))
    expect(response.status).toBe(415)
  })

  it('rejects content that does not match the extension', async () => {
    const { app } = createHarness()
    const response = await app.handle(submissionRequest({ filename: 'fake.mp3', body: fakeFlac() }))
    expect(response.status).toBe(415)
  })

  it('rejects oversized uploads', async () => {
    const { app } = createHarness({ env: { MAX_UPLOAD_SIZE: '16' } })
    const response = await app.handle(submissionRequest())
    expect(response.status).toBe(413)
    expect(bodyOf(response).reason).toBe('PAYLOAD_TOO_LARGE')
  })

  it('rejects malformed JSON on the feedback endpoint', async () => {
    const { app } = createHarness()
    const response = await app.handle({
      method: 'POST',
      path: '/api/feedback',
      query: {},
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{not-json'),
    })
    expect(response.status).toBe(400)
    expect(bodyOf(response).message).toContain('valid JSON')
  })

  it('rejects feedback payloads that fail schema validation', async () => {
    const { app } = createHarness()
    const response = await app.handle(
      jsonRequest('/api/feedback', {
        pullRequestNumber: -1,
        trackId: 'nope',
        confirmed: 'yes',
        token: 'x',
      }),
    )
    expect(response.status).toBe(400)
    expect(bodyOf(response).reason).toBe('BAD_REQUEST')
  })

  it('rejects feedback with a forged token', async () => {
    const { app, github } = createHarness()
    const submit = await app.handle(submissionRequest())
    const body = bodyOf(submit)
    const track = body.track as Record<string, unknown>
    const pullRequest = body.pullRequest as Record<string, unknown>

    const response = await app.handle(
      jsonRequest('/api/feedback', {
        pullRequestNumber: pullRequest.number,
        trackId: track.id,
        confirmed: true,
        token: 'f'.repeat(64),
      }),
    )
    expect(response.status).toBe(400)
    expect(github.comments.size).toBe(0)
  })
})

describe('feedback', () => {
  it('records feedback as a public PR comment', async () => {
    const { app, github } = createHarness()
    const submit = await app.handle(submissionRequest())
    const body = bodyOf(submit)
    const track = body.track as Record<string, unknown>
    const pullRequest = body.pullRequest as Record<string, unknown>

    const response = await app.handle(
      jsonRequest('/api/feedback', {
        pullRequestNumber: pullRequest.number,
        trackId: track.id,
        confirmed: true,
        token: body.feedbackToken,
      }),
    )

    expect(response.status).toBe(200)
    expect(bodyOf(response).success).toBe(true)
    expect(github.comments.get(Number(pullRequest.number))).toHaveLength(1)
  })
})

describe('upstream failures', () => {
  it('maps OpenCode failures to 502 without leaking internals', async () => {
    const failingAgent: MusicAnalysisAgent = {
      name: 'failing',
      async analyze() {
        throw new OpenCodeError('EXECUTION_FAILED', 'provider exploded with secret-key-123')
      },
    }
    const { app } = createHarness({ agent: failingAgent })
    const response = await app.handle(submissionRequest())
    expect(response.status).toBe(502)
    const body = bodyOf(response)
    expect(body.reason).toBe('OPENCODE_FAILED')
    expect(response.body).not.toContain('secret-key-123')
  })

  it('maps OpenCode timeouts to 504', async () => {
    const failingAgent: MusicAnalysisAgent = {
      name: 'timeout',
      async analyze() {
        throw new OpenCodeError('TIMEOUT', 'too slow')
      },
    }
    const { app } = createHarness({ agent: failingAgent })
    expect((await app.handle(submissionRequest())).status).toBe(504)
  })

  it('maps GitHub failures to 502', async () => {
    const { app } = createHarness({ seedMusic: false })
    const response = await app.handle(submissionRequest())
    expect(response.status).toBe(502)
    expect(bodyOf(response).reason).toBe('GITHUB_FAILED')
  })

  it('maps invalid databases to DATABASE_INVALID', async () => {
    const { app, github, config } = createHarness()
    github.seedBaseFile(config.musicDatabasePath, '{"version":1,"tracks":[{"bad":true}]}')
    const response = await app.handle(submissionRequest())
    expect(response.status).toBe(502)
    expect(bodyOf(response).reason).toBe('DATABASE_INVALID')
  })
})

describe('CORS', () => {
  it('answers preflight requests for allowed origins', async () => {
    const { app } = createHarness({ env: { ALLOWED_ORIGINS: 'http://localhost:5173' } })
    const response = await app.handle({
      method: 'OPTIONS',
      path: '/api/submit',
      query: {},
      headers: { origin: 'http://localhost:5173' },
      body: Buffer.alloc(0),
    })
    expect(response.status).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })

  it('does not send CORS headers to disallowed origins', async () => {
    const { app } = createHarness({ env: { ALLOWED_ORIGINS: 'http://localhost:5173' } })
    const response = await app.handle(
      submissionRequest({ headers: { origin: 'https://evil.example' } }),
    )
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })
})

describe('analysis options', () => {
  const mediaModel = { id: 'mimo-v2.6-flash', label: 'MiMo V2.6 Flash', media: ['audio'] }

  it('exposes media-capable models and context bounds', async () => {
    const { app } = createHarness({
      modelCatalog: new FakeModelCatalog([mediaModel], 'mimo-v2.6-pro'),
    })
    const response = await app.handle({
      method: 'GET',
      path: '/api/opencode/models',
      query: {},
      headers: {},
      body: Buffer.alloc(0),
    })
    expect(response.status).toBe(200)
    const body = bodyOf(response)
    expect(body.defaultModel).toBe('mimo-v2.6-pro')
    expect(body.allowOverride).toBe(true)
    expect(body.models).toHaveLength(1)
    expect((body.contextExamples as Record<string, number>).max).toBeGreaterThan(0)
  })

  it('applies an allowed model override and clamps the context size', async () => {
    const agent = new FakeMusicAnalysisAgent()
    const { app, github, config } = createHarness({
      agent,
      env: { MAX_CONTEXT_EXAMPLES: '3' },
      modelCatalog: new FakeModelCatalog([mediaModel], 'mimo-v2.6-pro'),
      seedMusic: false,
    })
    const tracks = Array.from({ length: 6 }, (_, index) =>
      makeTrack({
        id: `${index}`.repeat(64).slice(0, 64),
        style: index % 2 === 0 ? 'Electronic' : 'Techno',
      }),
    )
    github.seedBaseFile(config.musicDatabasePath, serializeMusicDatabase({ version: 1, tracks }))

    const response = await app.handle(
      submissionRequest({
        headers: { 'x-analysis-model': 'mimo-v2.6-flash', 'x-context-examples': '99' },
      }),
    )
    expect(response.status).toBe(201)
    expect(agent.lastContext?.model).toBe('mimo-v2.6-flash')
    expect(agent.lastContext?.examples.length).toBe(3)
  })

  it('rejects models outside the media catalog', async () => {
    const { app } = createHarness({
      modelCatalog: new FakeModelCatalog([mediaModel], 'mimo-v2.6-pro'),
    })
    const response = await app.handle(
      submissionRequest({ headers: { 'x-analysis-model': 'expensive-text-model' } }),
    )
    expect(response.status).toBe(400)
    expect(bodyOf(response).reason).toBe('BAD_REQUEST')
  })

  it('rejects malformed context sizes', async () => {
    const { app } = createHarness()
    const response = await app.handle(
      submissionRequest({ headers: { 'x-context-examples': 'lots' } }),
    )
    expect(response.status).toBe(400)
  })
})

describe('direct write mode', () => {
  it('commits to the base branch instead of opening a Pull Request', async () => {
    const { app, github, config } = createHarness({ env: { GITHUB_WRITE_MODE: 'direct' } })
    const response = await app.handle(submissionRequest())

    expect(response.status).toBe(201)
    const body = bodyOf(response)
    expect(body.pullRequest).toBeNull()
    expect(body.commit).toBeTruthy()
    expect((body.publication as Record<string, unknown>).type).toBe('commit')
    expect(body.feedbackToken).toBeNull()
    expect(String(response.headers.location)).toContain('/commit/')
    expect(github.pullRequests).toHaveLength(0)

    const database = parseMusicDatabase(github.baseFiles.get(config.musicDatabasePath) ?? '')
    expect(database.tracks).toHaveLength(1)
  })
})

describe('database consistency', () => {
  it('commits valid JSON containing exactly one new track', async () => {
    const { app, github, config } = createHarness()
    await app.handle(submissionRequest())
    const branch = github.pullRequests[0]?.branch ?? ''
    const content = github.branchFiles.get(branch)?.get(config.musicDatabasePath) ?? ''
    const database = parseMusicDatabase(content)
    expect(database.tracks).toHaveLength(1)
  })
})
