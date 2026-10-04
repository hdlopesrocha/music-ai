import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../../server/utils/hash.js'
import {
  DatabaseValidationError,
  buildTrackRecord,
  findTrackById,
  insertTrack,
  parseMusicDatabase,
  parseStyleDatabase,
  serializeMusicDatabase,
} from '../../server/services/music/database.js'
import { makeTrack } from '../helpers/fakes.js'

const validId = sha256Hex('track-one')

function databaseWith(tracks: unknown[]): string {
  return JSON.stringify({ version: 1, tracks }, null, 2)
}

const validTrack = {
  id: validId,
  fileName: 'track-one.mp3',
  title: 'Track One',
  artist: 'Artist',
  style: 'Electronic',
  confidence: 0.9,
  detectedAt: '2026-10-04T12:00:00.000Z',
  source: 'opencode',
}

describe('parseMusicDatabase', () => {
  it('accepts a valid database', () => {
    const database = parseMusicDatabase(databaseWith([validTrack]))
    expect(database.tracks).toHaveLength(1)
    expect(database.tracks[0]?.style).toBe('Electronic')
  })

  it('accepts an empty database', () => {
    expect(parseMusicDatabase('{"version":1,"tracks":[]}').tracks).toEqual([])
  })

  it('rejects invalid JSON', () => {
    expect(() => parseMusicDatabase('{not json')).toThrowError(/not valid JSON/)
  })

  it('rejects schema violations', () => {
    expect(() => parseMusicDatabase(databaseWith([{ ...validTrack, id: 'sha256-bad' }]))).toThrow(
      DatabaseValidationError,
    )
    expect(() => parseMusicDatabase(databaseWith([{ ...validTrack, confidence: 2 }]))).toThrow(
      DatabaseValidationError,
    )
    expect(() =>
      parseMusicDatabase(databaseWith([{ ...validTrack, detectedAt: 'not-a-date' }])),
    ).toThrow(DatabaseValidationError)
  })

  it('rejects unexpected fields rather than silently accepting them', () => {
    expect(() => parseMusicDatabase(databaseWith([{ ...validTrack, unexpected: true }]))).toThrow(
      DatabaseValidationError,
    )
  })

  it('accepts lyric flags and verified song metadata', () => {
    const database = parseMusicDatabase(
      databaseWith([
        {
          ...validTrack,
          hasLyrics: true,
          lyricsLanguage: 'English',
          song: { title: 'Song', artist: 'Artist', provider: 'musicbrainz', score: 95 },
          substyles: ['Synthwave'],
          tags: ['retro'],
        },
      ]),
    )
    expect(database.tracks[0]?.song?.title).toBe('Song')
    expect(database.tracks[0]?.hasLyrics).toBe(true)
  })
})

describe('parseStyleDatabase', () => {
  it('accepts a valid styles file', () => {
    const database = parseStyleDatabase('{"version":1,"styles":["Rock","Pop"]}')
    expect(database.styles).toEqual(['Rock', 'Pop'])
  })

  it('rejects empty style lists and wrong types', () => {
    expect(() => parseStyleDatabase('{"version":1,"styles":[]}')).toThrow(DatabaseValidationError)
    expect(() => parseStyleDatabase('{"version":1,"styles":[42]}')).toThrow(DatabaseValidationError)
  })
})

describe('insertTrack and findTrackById', () => {
  it('inserts a new track without mutating the original database', () => {
    const database = parseMusicDatabase(databaseWith([]))
    const track = makeTrack()
    const updated = insertTrack(database, track)
    expect(database.tracks).toHaveLength(0)
    expect(updated.tracks).toHaveLength(1)
    expect(findTrackById(updated, track.id)?.style).toBe('Electronic')
  })

  it('rejects duplicate ids (case-insensitive)', () => {
    const track = makeTrack()
    const database = parseMusicDatabase(serializeMusicDatabase({ version: 1, tracks: [track] }))
    expect(() => insertTrack(database, track)).toThrowError(/already exists/)
  })
})

describe('serializeMusicDatabase', () => {
  it('produces stable, pretty-printed JSON with a trailing newline', () => {
    const database = parseMusicDatabase(databaseWith([validTrack]))
    const serialized = serializeMusicDatabase(database)
    expect(serialized.endsWith('\n')).toBe(true)
    expect(parseMusicDatabase(serialized)).toEqual(database)
    expect(serialized).toContain('\n  "tracks": [')
  })
})

describe('buildTrackRecord', () => {
  const metadata = {
    fileName: 'song.mp3',
    mimeType: 'audio/mpeg',
    size: 1000,
    sha256: sha256Hex('song-bytes'),
    title: 'Tagged Title',
    artist: 'Tagged Artist',
    duration: 241,
  }

  it('builds a record from validated classification data', () => {
    const track = buildTrackRecord({
      metadata,
      classification: {
        style: 'Electronic',
        confidence: 0.94123,
        substyles: ['Synthwave', 'synthwave'],
        tags: ['analog'],
        lyrics: 'line one\nline two',
        lyricsLanguage: 'English',
        instrumental: false,
        diagnostics: { bpm: 128.456, energy: 0.87654, key: 'A Minor' },
      },
      style: 'Electronic',
      song: null,
      now: new Date('2026-10-04T12:00:00.000Z'),
    })

    expect(track.id).toBe(metadata.sha256)
    expect(track.confidence).toBe(0.9412)
    expect(track.style).toBe('Electronic')
    expect(track.substyles).toEqual(['Synthwave'])
    expect(track.hasLyrics).toBe(true)
    expect(track.lyricsLanguage).toBe('English')
    expect(track.detectedAt).toBe('2026-10-04T12:00:00.000Z')
    expect(track.diagnostics?.bpm).toBe(128.46)
    expect(track.diagnostics?.energy).toBe(0.877)
    expect(JSON.stringify(track)).not.toContain('line one')
  })

  it('marks instrumental tracks and stores no lyrics language', () => {
    const track = buildTrackRecord({
      metadata,
      classification: {
        style: 'Ambient',
        confidence: 0.8,
        lyrics: '   ',
        instrumental: true,
      },
      style: 'Ambient',
      song: null,
      now: new Date('2026-10-04T12:00:00.000Z'),
    })
    expect(track.hasLyrics).toBe(false)
    expect(track.lyricsLanguage).toBeUndefined()
  })

  it('persists timed subtitles when provided', () => {
    const track = buildTrackRecord({
      metadata,
      classification: {
        style: 'Pop',
        confidence: 0.9,
        lyrics: 'First line\nSecond line',
        instrumental: false,
      },
      style: 'Pop',
      song: null,
      now: new Date('2026-10-04T12:00:00.000Z'),
      subtitles: [
        { start: 4, end: 3, text: ' Second line ' },
        { start: 0, end: 3, text: 'First line' },
      ],
    })

    expect(track.subtitles).toEqual([
      { start: 4, end: 6, text: 'Second line' },
      { start: 0, end: 3, text: 'First line' },
    ])
    expect(
      parseMusicDatabase(serializeMusicDatabase({ version: 1, tracks: [track] })).tracks[0]
        ?.subtitles,
    ).toHaveLength(2)
  })

  it('falls back to the AI song proposal for title and artist', () => {
    const track = buildTrackRecord({
      metadata: { ...metadata, title: undefined, artist: undefined },
      classification: {
        style: 'Pop',
        confidence: 0.9,
        songMatch: { title: 'AI Title', artist: 'AI Artist', confidence: 0.6 },
      },
      style: 'Pop',
      song: null,
      now: new Date('2026-10-04T12:00:00.000Z'),
    })
    expect(track.title).toBe('AI Title')
    expect(track.artist).toBe('AI Artist')
    expect(track.song).toBeUndefined()
  })

  it('prefers verified song metadata when tags are missing', () => {
    const track = buildTrackRecord({
      metadata: { ...metadata, title: undefined, artist: undefined },
      classification: { style: 'Pop', confidence: 0.9 },
      style: 'Pop',
      song: {
        title: 'Canonical Title',
        artist: 'Canonical Artist',
        provider: 'musicbrainz',
        score: 92,
        album: 'Canonical Album',
        year: 1999,
      },
      now: new Date('2026-10-04T12:00:00.000Z'),
    })
    expect(track.title).toBe('Canonical Title')
    expect(track.artist).toBe('Canonical Artist')
    expect(track.song?.provider).toBe('musicbrainz')
    expect(track.song?.score).toBe(92)
  })
})
