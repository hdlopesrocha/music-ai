import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStaticHandler, type StaticHandler } from '../../server/static.js'

let parent: string
let root: string
let handler: StaticHandler

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), 'music-ai-static-'))
  root = join(parent, 'site')
  await mkdir(join(root, 'assets'), { recursive: true })
  await mkdir(join(root, 'data'), { recursive: true })
  await writeFile(join(root, 'index.html'), '<html>app</html>')
  await writeFile(join(root, 'assets', 'index-abc123.js'), 'console.log("app")')
  await writeFile(join(root, 'data', 'music.json'), '{"version":1,"tracks":[]}')
  await writeFile(join(root, 'config.json'), '{"apiBaseUrl":""}')
  await writeFile(join(parent, 'outside-secret.txt'), 'secret')
  handler = createStaticHandler(root)
})

afterEach(async () => {
  await rm(parent, { recursive: true, force: true })
})

describe('createStaticHandler', () => {
  it('serves index.html at the root', async () => {
    const response = await handler.handle('/')
    expect(response?.status).toBe(200)
    expect(response?.headers['content-type']).toContain('text/html')
    expect(response?.body.toString()).toContain('<html>app</html>')
  })

  it('serves hashed assets with immutable caching', async () => {
    const response = await handler.handle('/assets/index-abc123.js')
    expect(response?.status).toBe(200)
    expect(response?.headers['cache-control']).toContain('immutable')
    expect(response?.headers['content-type']).toContain('text/javascript')
  })

  it('serves mutable files with revalidation', async () => {
    const data = await handler.handle('/data/music.json')
    expect(data?.headers['cache-control']).toBe('no-cache')
    const config = await handler.handle('/config.json')
    expect(config?.status).toBe(200)
  })

  it('never handles API paths', async () => {
    expect(await handler.handle('/api/submit')).toBeNull()
    expect(await handler.handle('/api/health')).toBeNull()
  })

  it('rejects path traversal attempts', async () => {
    expect(await handler.handle('/../outside-secret.txt')).toBeNull()
    expect(await handler.handle('/%2e%2e%2foutside-secret.txt')).toBeNull()
    expect(await handler.handle('/data/..%2f..%2foutside-secret.txt')).toBeNull()
  })

  it('falls back to index.html for extension-less paths', async () => {
    const response = await handler.handle('/database')
    expect(response?.body.toString()).toContain('<html>app</html>')
  })

  it('returns null for missing files with extensions', async () => {
    expect(await handler.handle('/missing.js')).toBeNull()
  })
})
