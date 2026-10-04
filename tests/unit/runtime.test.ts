import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRuntime } from '../../server/container.js'
import { parseMusicDatabase } from '../../server/services/music/database.js'
import type { ApiRequest } from '../../server/http/types.js'
import { fakeMp3 } from '../helpers/audio.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function createSandbox(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'music-ai-runtime-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, 'data'), { recursive: true })
  await writeFile(
    join(dir, 'data', 'styles.json'),
    JSON.stringify({ version: 1, styles: ['Electronic', 'Techno'] }),
  )
  await writeFile(join(dir, 'data', 'music.json'), JSON.stringify({ version: 1, tracks: [] }))
  return dir
}

function submitRequest(): ApiRequest {
  return {
    method: 'POST',
    path: '/api/submit',
    query: {},
    headers: {
      'content-type': 'audio/mpeg',
      'x-music-filename': encodeURIComponent('runtime-test.mp3'),
    },
    body: fakeMp3(),
  }
}

describe('runtime end-to-end (mock OpenCode + dry-run GitHub)', () => {
  it('runs the full workflow without any credentials', async () => {
    const rootDir = await createSandbox()
    const runtime = createRuntime({
      rootDir,
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'error',
        OPENCODE_MODE: 'mock',
        GITHUB_MODE: 'dry-run',
        GITHUB_OWNER: 'local-owner',
        GITHUB_REPOSITORY: 'local-repo',
        GITHUB_BASE_BRANCH: 'main',
        RATE_LIMIT_SALT: 'test-salt',
        FEEDBACK_TOKEN_SECRET: 'feedback-secret',
        SONG_LOOKUP_ENABLED: 'false',
      },
    })

    const response = await runtime.app.handle(submitRequest())
    expect(response.status).toBe(201)
    const body = JSON.parse(response.body) as Record<string, unknown>
    expect(body.success).toBe(true)

    const track = body.track as Record<string, unknown>
    expect(track.style).toBeTypeOf('string')
    expect(body.feedbackToken).toBeTypeOf('string')

    const pullRequest = body.pullRequest as Record<string, unknown>
    expect(String(pullRequest.url)).toContain('/pull/1')
    expect(String(pullRequest.branch)).toContain('submissions/')

    // The returned track is valid database content.
    const database = parseMusicDatabase(JSON.stringify({ version: 1, tracks: [track] }))
    expect(database.tracks).toHaveLength(1)
  })

  it('rejects unknown styles in mock mode via the file-name hint', async () => {
    const rootDir = await createSandbox()
    const runtime = createRuntime({
      rootDir,
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'error',
        OPENCODE_MODE: 'mock',
        GITHUB_MODE: 'dry-run',
        RATE_LIMIT_SALT: 'test-salt',
      },
    })

    const request = submitRequest()
    request.headers['x-music-filename'] = encodeURIComponent('unknown-track.mp3')
    const response = await runtime.app.handle(request)
    expect(response.status).toBe(200)
    const body = JSON.parse(response.body) as Record<string, unknown>
    expect(body).toMatchObject({ success: false, reason: 'UNKNOWN_STYLE' })
  })
})
