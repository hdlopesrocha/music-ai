// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('isGitHubPagesHost', () => {
  it('recognises GitHub Pages hosts', async () => {
    const { isGitHubPagesHost } = await import('@/services/runtimeConfig')
    expect(isGitHubPagesHost('hdlopesrocha.github.io')).toBe(true)
    expect(isGitHubPagesHost('github.io')).toBe(true)
    expect(isGitHubPagesHost('example.com')).toBe(false)
    expect(isGitHubPagesHost('notgithub.io')).toBe(false)
  })
})

describe('resolveApiBaseUrl', () => {
  it('uses the runtime config.json when no build-time URL is set', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ apiBaseUrl: 'https://api.example.com/' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { resolveApiBaseUrl } = await import('@/services/runtimeConfig')
    expect(await resolveApiBaseUrl()).toBe('https://api.example.com')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('config.json')
  })

  it('prefers the build-time environment variable', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://env.example.com/')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { resolveApiBaseUrl } = await import('@/services/runtimeConfig')
    expect(await resolveApiBaseUrl()).toBe('https://env.example.com')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns an empty string when config.json is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    )
    const { resolveApiBaseUrl } = await import('@/services/runtimeConfig')
    expect(await resolveApiBaseUrl()).toBe('')
  })

  it('ignores malformed runtime config', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([1, 2, 3]), { status: 200 })),
    )
    const { resolveApiBaseUrl } = await import('@/services/runtimeConfig')
    expect(await resolveApiBaseUrl()).toBe('')
  })

  it('caches the runtime config', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ apiBaseUrl: 'https://api.example.com' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { resolveApiBaseUrl } = await import('@/services/runtimeConfig')
    await resolveApiBaseUrl()
    await resolveApiBaseUrl()
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
