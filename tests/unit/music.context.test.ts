import { describe, expect, it } from 'vitest'
import { selectContextExamples } from '../../server/services/music/context.js'
import { makeTrack } from '../helpers/fakes.js'

describe('selectContextExamples', () => {
  it('returns an empty list for an empty database', () => {
    expect(selectContextExamples([], { maxTotal: 10, perStyle: 2 })).toEqual([])
  })

  it('keeps the most recent entries per style and respects maxTotal', () => {
    const tracks = [
      makeTrack({ id: 'a'.repeat(64), style: 'Rock', detectedAt: '2024-01-01T00:00:00Z' }),
      makeTrack({ id: 'b'.repeat(64), style: 'Rock', detectedAt: '2025-01-01T00:00:00Z' }),
      makeTrack({ id: 'c'.repeat(64), style: 'Rock', detectedAt: '2023-01-01T00:00:00Z' }),
      makeTrack({ id: 'd'.repeat(64), style: 'Pop', detectedAt: '2025-06-01T00:00:00Z' }),
      makeTrack({ id: 'e'.repeat(64), style: 'Jazz', detectedAt: '2025-06-02T00:00:00Z' }),
    ]

    const selected = selectContextExamples(tracks, { maxTotal: 4, perStyle: 2 })
    expect(selected).toHaveLength(4)

    const rock = selected.filter((example) => example.style === 'Rock')
    expect(rock).toHaveLength(2)
    expect(rock[0]?.fileName).toBe('track-one.mp3')

    const styles = selected.map((example) => example.style)
    expect(styles).toContain('Pop')
    expect(styles).toContain('Jazz')
  })

  it('interleaves styles so each style is represented before extras', () => {
    const tracks = [
      makeTrack({ id: '1'.repeat(64), style: 'A', detectedAt: '2025-01-01T00:00:00Z' }),
      makeTrack({ id: '2'.repeat(64), style: 'A', detectedAt: '2024-01-01T00:00:00Z' }),
      makeTrack({ id: '3'.repeat(64), style: 'B', detectedAt: '2025-01-01T00:00:00Z' }),
      makeTrack({ id: '4'.repeat(64), style: 'B', detectedAt: '2024-01-01T00:00:00Z' }),
    ]
    const selected = selectContextExamples(tracks, { maxTotal: 3, perStyle: 2 })
    expect(selected.map((example) => example.style)).toEqual(['A', 'B', 'A'])
  })

  it('omits empty optional fields', () => {
    const track = makeTrack({ id: 'f'.repeat(64) })
    const [example] = selectContextExamples([track], { maxTotal: 1, perStyle: 1 })
    expect(example).toBeDefined()
    expect('substyles' in (example ?? {})).toBe(false)
  })
})
