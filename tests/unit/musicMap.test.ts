import { describe, expect, it, vi } from 'vitest'
import {
  DisabledSimilarArtistService,
  MusicMapService,
  parseMusicMapHtml,
} from '../../server/services/discovery/musicMap.js'
import { silentLogger } from '../helpers/fakes.js'

const config = {
  enabled: true,
  baseUrl: 'https://music-map.test',
  timeoutMs: 1000,
  cacheTtlMs: 60_000,
  maxNeighbors: 4,
}

const fixture = `
<!doctype html>
<a class=project href="/">Music-Map</a><span id=the_title class=the_title>Daft Punk</span>
<a href="https://www.gnoosic.com/discussion/daft+punk.html" class=S id=s0>Daft Punk</a>
<a href="justice" class=S id=s1>Justice</a>
<a href="gorillaz" class=S id=s2>Gorillaz</a>
<a href="deadmau5" class="S" id=s3>Deadmau5</a>
<a href="earth" class=S id=s4>Earth, Wind &amp; Fire</a>
<a href="earth-again" class=S id=s5>Earth, Wind &amp; Fire</a>
<a href="bjork" class=S id=s6>Bj&#246;rk</a>
`

function createService(fetchFn: typeof fetch, now = () => 0) {
  return new MusicMapService(config, silentLogger(), fetchFn, now, 0)
}

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
}

describe('parseMusicMapHtml', () => {
  it('extracts neighbour names, decodes entities and de-duplicates', () => {
    expect(parseMusicMapHtml(fixture, 4)).toEqual([
      'Daft Punk',
      'Justice',
      'Gorillaz',
      'Deadmau5',
      'Earth, Wind & Fire',
    ])
  })

  it('returns an empty list for unrelated HTML', () => {
    expect(parseMusicMapHtml('<html><body>nope</body></html>', 10)).toEqual([])
  })
})

describe('MusicMapService', () => {
  it('fetches neighbours, excludes the queried artist and encodes the URL', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['user-agent']).toContain(
        'ai-music-style-database',
      )
      return htmlResponse(fixture)
    })

    const service = createService(fetchFn as typeof fetch)
    const result = await service.findNeighbors('Daft Punk')

    expect(result.source).toBe('music-map')
    expect(result.artist).toBe('Daft Punk')
    expect(result.neighbors).toEqual(['Justice', 'Gorillaz', 'Deadmau5', 'Earth, Wind & Fire'])
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe('https://music-map.test/Daft+Punk')
  })

  it('caches results for the TTL window', async () => {
    let now = 0
    const fetchFn = vi.fn(async () => htmlResponse(fixture))
    const service = createService(fetchFn as typeof fetch, () => now)

    await service.findNeighbors('Daft Punk')
    now = 30_000
    await service.findNeighbors('daft punk')
    expect(fetchFn).toHaveBeenCalledTimes(1)

    now = 120_000
    await service.findNeighbors('Daft Punk')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('fails on upstream errors and non-2xx responses', async () => {
    const failing = createService(
      vi.fn(async () => {
        throw new Error('network down')
      }) as unknown as typeof fetch,
    )
    await expect(failing.findNeighbors('Daft Punk')).rejects.toThrowError()

    const notFound = createService(
      vi.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch,
    )
    await expect(notFound.findNeighbors('Daft Punk')).rejects.toThrowError(/HTTP 503/)
  })
})

describe('DisabledSimilarArtistService', () => {
  it('returns a disabled marker without network access', async () => {
    const result = await new DisabledSimilarArtistService().findNeighbors('Daft Punk')
    expect(result).toEqual({ artist: 'Daft Punk', neighbors: [], source: 'disabled' })
  })
})
