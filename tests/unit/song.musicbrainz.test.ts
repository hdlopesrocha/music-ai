import { describe, expect, it, vi } from 'vitest'
import type { SongLookupConfig } from '../../server/config.js'
import { MusicBrainzSongIdentificationService } from '../../server/services/song/musicbrainz.js'
import { silentLogger } from '../helpers/fakes.js'

const lookupConfig: SongLookupConfig = {
  enabled: true,
  provider: 'musicbrainz',
  timeoutMs: 1000,
  minScore: 75,
  baseUrl: 'https://musicbrainz.test',
  userAgent: 'test-agent/1.0',
}

const input = {
  proposal: { title: 'Around the World', artist: 'Daft Punk', confidence: 0.9 },
  metadata: {
    fileName: 'song.mp3',
    mimeType: 'audio/mpeg',
    size: 100,
    sha256: 'a'.repeat(64),
  },
}

function service(fetchFn: typeof fetch): MusicBrainzSongIdentificationService {
  return new MusicBrainzSongIdentificationService(lookupConfig, silentLogger(), fetchFn, 0)
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status })
}

const matchResponse = {
  recordings: [
    {
      id: 'recording-1',
      score: 98,
      title: 'Around the World',
      'artist-credit': [{ name: 'Daft Punk', joinphrase: '' }],
      releases: [{ title: 'Homework', date: '1997-01-20' }],
    },
    { id: 'recording-2', score: 60, title: 'Unrelated', 'artist-credit': [{ name: 'X' }] },
  ],
}

describe('MusicBrainzSongIdentificationService', () => {
  it('verifies a proposal and returns canonical metadata', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['user-agent']).toBe('test-agent/1.0')
      return jsonResponse(matchResponse)
    })
    const result = await service(fetchFn as typeof fetch).identify(input)

    expect(result).toMatchObject({
      title: 'Around the World',
      artist: 'Daft Punk',
      provider: 'musicbrainz',
      recordingId: 'recording-1',
      score: 98,
      album: 'Homework',
      year: 1997,
    })
  })

  it('returns null when no recording reaches the minimum score', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ recordings: [{ id: 'x', score: 40, title: 'T' }] }),
    )
    expect(await service(fetchFn as typeof fetch).identify(input)).toBeNull()
  })

  it('does not call the provider without a proposal', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(matchResponse))
    const result = await service(fetchFn as typeof fetch).identify({ ...input, proposal: null })
    expect(result).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('returns null on provider errors instead of failing the submission', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('network down')
    })
    expect(await service(fetchFn as typeof fetch).identify(input)).toBeNull()
  })

  it('returns null on HTTP errors', async () => {
    const fetchFn = vi.fn(async () => new Response('rate limited', { status: 503 }))
    expect(await service(fetchFn as typeof fetch).identify(input)).toBeNull()
  })

  it('returns null on malformed provider responses', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ recordings: 'nope' }))
    expect(await service(fetchFn as typeof fetch).identify(input)).toBeNull()
  })

  it('encodes the search query safely', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const decoded = decodeURIComponent(String(url))
      expect(decoded).toContain('recording:"Around the World"')
      expect(decoded).toContain('artist:"Daft Punk"')
      return jsonResponse({ recordings: [] })
    })
    await service(fetchFn as typeof fetch).identify(input)
    expect(fetchFn).toHaveBeenCalledOnce()
  })
})
