import { describe, expect, it } from 'vitest'
import { OpenCodeError } from '../../server/errors.js'
import { extractAssistantText, extractJsonObject } from '../../server/services/opencode/parse.js'
import { parseAnalysisResult } from '../../server/services/opencode/schema.js'

describe('extractJsonObject', () => {
  it('parses plain JSON', () => {
    expect(extractJsonObject('{"style":"Electronic","confidence":0.9}')).toEqual({
      style: 'Electronic',
      confidence: 0.9,
    })
  })

  it('parses JSON inside markdown fences', () => {
    const text = '```json\n{"style":"Techno","confidence":0.8}\n```'
    expect(extractJsonObject(text)).toEqual({ style: 'Techno', confidence: 0.8 })
  })

  it('parses JSON surrounded by prose', () => {
    const text = 'Here is the result:\n{"style":"Jazz","confidence":0.7}\nHope that helps!'
    expect(extractJsonObject(text)).toEqual({ style: 'Jazz', confidence: 0.7 })
  })

  it('tolerates streaming prefixes before the final object', () => {
    const text = '{"style":"Elec\n{"style":"Electronic","confidence":0.95}'
    expect(extractJsonObject(text)).toEqual({ style: 'Electronic', confidence: 0.95 })
  })

  it('handles braces inside strings', () => {
    const text = '{"style":"Electronic","tags":["{weird}"],"confidence":0.9}'
    expect(extractJsonObject(text)).toMatchObject({ tags: ['{weird}'] })
  })

  it('throws EMPTY_RESPONSE on empty output', () => {
    expect(() => extractJsonObject('   ')).toThrowError(OpenCodeError)
    try {
      extractJsonObject('')
    } catch (error) {
      expect((error as OpenCodeError).code).toBe('EMPTY_RESPONSE')
    }
  })

  it('throws MALFORMED_RESPONSE on garbage', () => {
    try {
      extractJsonObject('I cannot classify this track.')
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(OpenCodeError)
      expect((error as OpenCodeError).code).toBe('MALFORMED_RESPONSE')
    }
  })
})

describe('extractAssistantText', () => {
  it('collects text parts from an OpenCode event stream', () => {
    const stream = [
      JSON.stringify({ type: 'step_start', id: 'step-1' }),
      JSON.stringify({
        type: 'text',
        id: 'part-1',
        text: '{"style":"Electronic",',
      }),
      JSON.stringify({
        type: 'message.part.updated',
        properties: {
          part: { type: 'text', id: 'part-1', text: '{"style":"Electronic","confidence":0.9}' },
        },
      }),
      JSON.stringify({ type: 'step_finish', id: 'step-1' }),
    ].join('\n')

    const text = extractAssistantText(stream)
    expect(text).toContain('"style":"Electronic"')
    expect(extractJsonObject(text)).toEqual({ style: 'Electronic', confidence: 0.9 })
  })

  it('falls back to raw output when no events are recognised', () => {
    const raw = '{"style":"Jazz","confidence":0.8}'
    expect(extractAssistantText(raw)).toBe(raw)
  })

  it('strips ANSI escape codes', () => {
    const text = '{"style":"Rock","confidence":0.9}\u001b[0m'
    expect(extractJsonObject(text)).toEqual({ style: 'Rock', confidence: 0.9 })
  })
})

describe('parseAnalysisResult', () => {
  it('accepts and normalizes a full result', () => {
    const result = parseAnalysisResult({
      style: '  Electronic ',
      confidence: 0.94,
      substyles: ['Synthwave'],
      tags: ['analog', 'retro'],
      instrumental: false,
      lyrics: 'line one\r\nline two',
      lyricsLanguage: ' English ',
      songMatch: { title: ' Song ', artist: ' Artist ', confidence: 0.8 },
      diagnostics: { bpm: 128, key: 'A Minor' },
      ignoredExtraField: true,
    })
    expect(result.style).toBe('Electronic')
    expect(result.lyrics).toBe('line one\nline two')
    expect(result.songMatch?.title).toBe('Song')
    expect('ignoredExtraField' in result).toBe(false)
  })

  it('rejects a missing style', () => {
    expect(() => parseAnalysisResult({ confidence: 0.9 })).toThrowError(OpenCodeError)
  })

  it('rejects an invalid confidence', () => {
    expect(() => parseAnalysisResult({ style: 'Rock', confidence: 1.5 })).toThrowError(
      OpenCodeError,
    )
    expect(() => parseAnalysisResult({ style: 'Rock', confidence: 'high' })).toThrowError(
      OpenCodeError,
    )
  })

  it('normalizes timed lyric segments and derives lyrics from them', () => {
    const result = parseAnalysisResult({
      style: 'Pop',
      confidence: 0.9,
      lyricsSegments: [
        { start: 5, end: 4, text: ' Second line ' },
        { start: 0, end: 3, text: 'First line' },
        { start: 10, end: 12, text: '   ' },
      ],
    })

    expect(result.lyrics).toBe('First line\nSecond line')
    expect(result.lyricsSegments).toEqual([
      { start: 0, end: 3, text: 'First line' },
      { start: 5, end: 7, text: 'Second line' },
    ])
  })

  it('rejects a malformed song match', () => {
    expect(() =>
      parseAnalysisResult({ style: 'Rock', confidence: 0.9, songMatch: { title: 'x' } }),
    ).toThrowError(OpenCodeError)
  })

  it('accepts an unknown style at parse time (validated later)', () => {
    const result = parseAnalysisResult({
      style: 'Progressive Balkan Electronica',
      confidence: 0.9,
    })
    expect(result.style).toBe('Progressive Balkan Electronica')
  })

  it('accepts a low confidence result', () => {
    const result = parseAnalysisResult({ style: 'Rock', confidence: 0.42 })
    expect(result.confidence).toBe(0.42)
  })
})
