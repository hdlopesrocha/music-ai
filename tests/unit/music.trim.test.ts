import { describe, expect, it } from 'vitest'
import { trimAudioForAnalysis } from '../../server/services/music/trim.js'
import { buildWav, fakeMp3 } from '../helpers/audio.js'

function wavDataBytes(buffer: Buffer): number {
  return buffer.readUInt32LE(40)
}

describe('trimAudioForAnalysis', () => {
  it('trims WAV frame-accurately to the configured seconds', () => {
    const wav = buildWav({ seconds: 10, sampleRate: 8000 })
    const trimmed = trimAudioForAnalysis(wav, 'song.wav', 10, 3)

    expect(trimmed.length).toBe(44 + 3 * 8000 * 2)
    expect(wavDataBytes(trimmed)).toBe(3 * 8000 * 2)
    expect(trimmed.toString('latin1', 0, 4)).toBe('RIFF')
    expect(trimmed.toString('latin1', 8, 12)).toBe('WAVE')
    expect(trimmed.readUInt32LE(24)).toBe(8000)
  })

  it('leaves short WAV files untouched', () => {
    const wav = buildWav({ seconds: 2, sampleRate: 8000 })
    expect(trimAudioForAnalysis(wav, 'song.wav', 2, 120)).toBe(wav)
  })

  it('trims MP3 proportionally using the known duration', () => {
    const mp3 = fakeMp3('x'.repeat(30_000))
    const trimmed = trimAudioForAnalysis(mp3, 'song.mp3', 300, 60)
    expect(trimmed.length).toBeLessThan(mp3.length)
    expect(trimmed.length).toBeGreaterThan(1024)
    expect(trimmed.length / mp3.length).toBeCloseTo(0.2, 1)
  })

  it('leaves MP3 files untouched when the duration is unknown or short', () => {
    const mp3 = fakeMp3('x'.repeat(1000))
    expect(trimAudioForAnalysis(mp3, 'song.mp3', undefined, 60)).toBe(mp3)
    expect(trimAudioForAnalysis(mp3, 'song.mp3', 30, 60)).toBe(mp3)
  })

  it('disables trimming when maxSeconds is zero', () => {
    const wav = buildWav({ seconds: 10, sampleRate: 8000 })
    expect(trimAudioForAnalysis(wav, 'song.wav', 10, 0)).toBe(wav)
  })

  it('returns the original buffer for other formats and malformed WAV', () => {
    const flac = Buffer.from('fLaC-not-really')
    expect(trimAudioForAnalysis(flac, 'song.flac', 300, 60)).toBe(flac)
    const broken = Buffer.from('not a wav file at all')
    expect(trimAudioForAnalysis(broken, 'song.wav', 300, 60)).toBe(broken)
  })
})
