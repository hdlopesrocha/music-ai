import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '../../server/errors.js'
import { sha256Hex } from '../../server/utils/hash.js'
import {
  detectContainer,
  extractAudioMetadata,
  isMimeAllowed,
  normalizeMimeType,
  validateAudioUpload,
} from '../../server/services/music/audio.js'
import { buildWav, fakeFlac, fakeMp3 } from '../helpers/audio.js'
import { testConfig } from '../helpers/fakes.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

describe('sha256Hex', () => {
  it('computes a known SHA-256 digest', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('detectContainer', () => {
  it('detects common containers from magic bytes', () => {
    expect(detectContainer(fakeMp3())).toBe('mp3')
    expect(detectContainer(fakeFlac())).toBe('flac')
    expect(detectContainer(buildWav({ seconds: 0.1 }))).toBe('wav')
    expect(detectContainer(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(16)]))).toBe('ogg')
    const mp4 = Buffer.alloc(16)
    mp4.write('ftypM4A ', 4, 'latin1')
    expect(detectContainer(mp4)).toBe('m4a')
  })

  it('returns unknown for random data', () => {
    expect(detectContainer(Buffer.from('this is not audio at all'))).toBe('unknown')
    expect(detectContainer(Buffer.alloc(0))).toBe('unknown')
  })
})

describe('normalizeMimeType and isMimeAllowed', () => {
  it('strips parameters and lower-cases', () => {
    expect(normalizeMimeType('Audio/MPEG; charset=binary')).toBe('audio/mpeg')
    expect(normalizeMimeType(undefined)).toBe('')
  })

  it('allows generic octet-stream and extension-specific types', () => {
    expect(isMimeAllowed('application/octet-stream', 'mp3')).toBe(true)
    expect(isMimeAllowed('audio/mpeg', 'mp3')).toBe(true)
    expect(isMimeAllowed('audio/flac', 'mp3')).toBe(false)
    expect(isMimeAllowed('text/plain', 'mp3')).toBe(false)
  })
})

describe('validateAudioUpload', () => {
  const base = {
    fileName: 'song.mp3',
    extension: 'mp3' as const,
    mimeType: 'audio/mpeg',
  }

  it('accepts a valid upload and computes the hash', () => {
    const buffer = fakeMp3()
    const result = validateAudioUpload({ ...base, buffer, config: testConfig() })
    expect(result.sha256).toBe(sha256Hex(buffer))
    expect(result.container).toBe('mp3')
    expect(result.size).toBe(buffer.length)
  })

  it('rejects empty uploads', () => {
    expect(() =>
      validateAudioUpload({ ...base, buffer: Buffer.alloc(0), config: testConfig() }),
    ).toThrow(ApiError)
  })

  it('rejects oversized uploads', () => {
    const config = testConfig({ MAX_UPLOAD_SIZE: '8' })
    expect(() => validateAudioUpload({ ...base, buffer: fakeMp3(), config })).toThrowError(
      /maximum upload size/i,
    )
  })

  it('rejects disallowed MIME types', () => {
    expect(() =>
      validateAudioUpload({
        ...base,
        mimeType: 'text/plain',
        buffer: fakeMp3(),
        config: testConfig(),
      }),
    ).toThrowError(/does not match/i)
  })

  it('rejects content that conflicts with the extension', () => {
    expect(() =>
      validateAudioUpload({ ...base, buffer: fakeFlac(), config: testConfig() }),
    ).toThrowError(/does not match the extension/i)
  })

  it('accepts an AAC extension with M4A container (both are MP4 audio)', () => {
    const mp4 = Buffer.alloc(32)
    mp4.write('ftypM4A ', 4, 'latin1')
    const result = validateAudioUpload({
      fileName: 'song.m4a',
      extension: 'm4a',
      mimeType: 'audio/mp4',
      buffer: mp4,
      config: testConfig(),
    })
    expect(result.container).toBe('m4a')
  })
})

describe('extractAudioMetadata', () => {
  it('reads duration from a real WAV file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'music-ai-audio-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const filePath = join(dir, 'tone.wav')
    const buffer = buildWav({ seconds: 1, sampleRate: 8000 })
    await writeFile(filePath, buffer)

    const upload = validateAudioUpload({
      fileName: 'tone.wav',
      extension: 'wav',
      mimeType: 'audio/wav',
      buffer,
      config: testConfig(),
    })
    const metadata = await extractAudioMetadata(filePath, upload)
    expect(metadata.duration).toBeGreaterThanOrEqual(1)
    expect(metadata.duration).toBeLessThanOrEqual(2)
    expect(metadata.sha256).toBe(sha256Hex(buffer))
  })

  it('falls back to base metadata for unparseable files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'music-ai-audio-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const filePath = join(dir, 'broken.mp3')
    const buffer = fakeMp3('broken')
    await writeFile(filePath, buffer)

    const upload = validateAudioUpload({
      fileName: 'broken.mp3',
      extension: 'mp3',
      mimeType: 'audio/mpeg',
      buffer,
      config: testConfig(),
    })
    const metadata = await extractAudioMetadata(filePath, upload)
    expect(metadata.title).toBeUndefined()
    expect(metadata.duration).toBeUndefined()
    expect(metadata.fileName).toBe('broken.mp3')
  })
})
