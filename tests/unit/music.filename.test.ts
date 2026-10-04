import { describe, expect, it } from 'vitest'
import {
  InvalidFileNameError,
  extensionOf,
  inferFromFileName,
  isAllowedAudioExtension,
  parseMusicFileName,
  sanitizeFileName,
} from '../../server/services/music/filename.js'

describe('sanitizeFileName', () => {
  it('strips POSIX and Windows path components', () => {
    expect(sanitizeFileName('../../etc/passwd.mp3', 200)).toBe('passwd.mp3')
    expect(sanitizeFileName('..\\..\\windows\\evil.mp3', 200)).toBe('evil.mp3')
    expect(sanitizeFileName('/absolute/path/song.mp3', 200)).toBe('song.mp3')
  })

  it('decodes URL-encoded names', () => {
    expect(sanitizeFileName('My%20Song.mp3', 200)).toBe('My Song.mp3')
    expect(sanitizeFileName('%2e%2e%2fsecret.mp3', 200)).toBe('secret.mp3')
  })

  it('removes control and zero-width characters', () => {
    expect(sanitizeFileName('bad\u0000\u200bname.mp3', 200)).toBe('badname.mp3')
  })

  it('neutralises reserved device names and leading dots', () => {
    expect(sanitizeFileName('CON.mp3', 200)).toBe('file-CON.mp3')
    expect(sanitizeFileName('...hidden.mp3', 200)).toBe('hidden.mp3')
  })

  it('enforces the maximum length', () => {
    const name = `${'a'.repeat(500)}.mp3`
    expect(sanitizeFileName(name, 50).length).toBe(50)
  })

  it('rejects empty names', () => {
    expect(() => sanitizeFileName('   ', 200)).toThrow(InvalidFileNameError)
    expect(() => sanitizeFileName('...', 200)).toThrow(InvalidFileNameError)
  })
})

describe('parseMusicFileName', () => {
  it('accepts all supported extensions', () => {
    for (const extension of ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus']) {
      const parsed = parseMusicFileName(`song.${extension.toUpperCase()}`, 200)
      expect(parsed.fileName).toBe(`song.${extension.toUpperCase()}`)
      expect(parsed.extension).toBe(extension)
    }
  })

  it('rejects missing and unsupported extensions', () => {
    expect(() => parseMusicFileName('song', 200)).toThrow(InvalidFileNameError)
    expect(() => parseMusicFileName('song.exe', 200)).toThrow(InvalidFileNameError)
    expect(() => parseMusicFileName('song.svg', 200)).toThrow(InvalidFileNameError)
  })
})

describe('extension helpers', () => {
  it('extracts lower-case extensions', () => {
    expect(extensionOf('A.B.MP3')).toBe('mp3')
    expect(extensionOf('noextension')).toBe('')
    expect(extensionOf('.hidden')).toBe('')
    expect(extensionOf('trailingdot.')).toBe('')
  })

  it('recognises allowed audio extensions', () => {
    expect(isAllowedAudioExtension('flac')).toBe(true)
    expect(isAllowedAudioExtension('txt')).toBe(false)
  })
})

describe('inferFromFileName', () => {
  it('parses "Artist - Title" patterns', () => {
    expect(inferFromFileName('Daft Punk - Around the World.mp3')).toEqual({
      artist: 'Daft Punk',
      title: 'Around the World',
    })
  })

  it('strips leading track numbers', () => {
    expect(inferFromFileName('01. Artist - Title.flac')).toEqual({
      artist: 'Artist',
      title: 'Title',
    })
  })

  it('falls back to a title', () => {
    expect(inferFromFileName('JustATitle.wav')).toEqual({ title: 'JustATitle' })
  })
})
