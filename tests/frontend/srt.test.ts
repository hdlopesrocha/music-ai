// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildSrt, formatSrtTime } from '@/utils/srt'

describe('formatSrtTime', () => {
  it('formats seconds as HH:MM:SS,mmm', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000')
    expect(formatSrtTime(3.5)).toBe('00:00:03,500')
    expect(formatSrtTime(61.25)).toBe('00:01:01,250')
    expect(formatSrtTime(3661.001)).toBe('01:01:01,001')
  })

  it('clamps invalid values', () => {
    expect(formatSrtTime(-4)).toBe('00:00:00,000')
    expect(formatSrtTime(Number.NaN)).toBe('00:00:00,000')
  })
})

describe('buildSrt', () => {
  it('builds a valid SRT document with sequential indices', () => {
    const srt = buildSrt([
      { start: 0, end: 3.5, text: 'First line' },
      { start: 4, end: 7, text: 'Second line' },
    ])

    expect(srt).toBe(
      [
        '1',
        '00:00:00,000 --> 00:00:03,500',
        'First line',
        '',
        '2',
        '00:00:04,000 --> 00:00:07,000',
        'Second line',
        '',
      ].join('\n'),
    )
  })

  it('repairs inverted ranges and skips empty lines', () => {
    const srt = buildSrt([
      { start: 5, end: 4, text: 'Fixed' },
      { start: 9, end: 10, text: '   ' },
    ])
    expect(srt).toContain('00:00:05,000 --> 00:00:07,000')
    expect(srt).not.toContain('9')
  })

  it('returns an empty string without segments', () => {
    expect(buildSrt([])).toBe('')
  })
})
