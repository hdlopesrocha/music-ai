import { describe, expect, it } from 'vitest'
import { createStyleCatalog, normalizeStyleToken } from '../../server/services/music/styles.js'
import { validateClassification } from '../../server/services/music/classification.js'

describe('normalizeStyleToken', () => {
  it('normalizes case, whitespace, unicode and dashes', () => {
    expect(normalizeStyleToken('Electronic')).toBe('electronic')
    expect(normalizeStyleToken('ELECTRONIC')).toBe('electronic')
    expect(normalizeStyleToken('  electronic  ')).toBe('electronic')
    expect(normalizeStyleToken('electronic\t\n')).toBe('electronic')
    expect(normalizeStyleToken('E\u0301lectronic')).toBe('\u00e9lectronic')
    expect(normalizeStyleToken('Hip\u2013Hop')).toBe('hip-hop')
    expect(normalizeStyleToken('Drum  and\u00a0Bass')).toBe('drum and bass')
  })
})

describe('createStyleCatalog', () => {
  const catalog = createStyleCatalog(['Electronic', 'Hip Hop', 'Drum and Bass'])

  it('resolves variants to the canonical spelling', () => {
    expect(catalog.resolve('electronic')).toBe('Electronic')
    expect(catalog.resolve('  ELECTRONIC ')).toBe('Electronic')
    expect(catalog.resolve('Hip Hop')).toBe('Hip Hop')
    expect(catalog.resolve('\u0044rum and bass')).toBe('Drum and Bass')
  })

  it('returns null for unknown styles instead of fuzzy-matching', () => {
    expect(catalog.resolve('Rock')).toBeNull()
    expect(catalog.resolve('Electro')).toBeNull()
    expect(catalog.resolve('Electronic Dance Music')).toBeNull()
    expect(catalog.resolve('')).toBeNull()
  })

  it('does not merge unrelated genres', () => {
    const rockCatalog = createStyleCatalog(['Rock', 'Rock and Roll', 'Punk Rock'])
    expect(rockCatalog.resolve('rock')).toBe('Rock')
    expect(rockCatalog.resolve('rock and roll')).toBe('Rock and Roll')
    expect(rockCatalog.resolve('punk rock')).toBe('Punk Rock')
    expect(rockCatalog.resolve('rockabilly')).toBeNull()
  })

  it('skips duplicate canonical entries', () => {
    const duplicate = createStyleCatalog(['Techno', 'techno', 'TECHNO'])
    expect(duplicate.styles).toEqual(['Techno'])
  })
})

describe('validateClassification', () => {
  const catalog = createStyleCatalog(['Electronic', 'Techno'])

  it('accepts a known style above the threshold', () => {
    const result = validateClassification({ style: 'electronic', confidence: 0.9 }, catalog, 0.7)
    expect(result).toEqual({
      status: 'ok',
      classification: { style: 'electronic', confidence: 0.9 },
      resolvedStyle: 'Electronic',
    })
  })

  it('rejects unknown styles before considering confidence', () => {
    const result = validateClassification(
      { style: 'Progressive Balkan Electronica', confidence: 0.99 },
      catalog,
      0.7,
    )
    expect(result.status).toBe('unknown_style')
    if (result.status === 'unknown_style') {
      expect(result.detectedStyle).toBe('Progressive Balkan Electronica')
    }
  })

  it('rejects low confidence with the resolved style', () => {
    const result = validateClassification({ style: 'Techno', confidence: 0.42 }, catalog, 0.7)
    expect(result.status).toBe('low_confidence')
    if (result.status === 'low_confidence') {
      expect(result.detectedStyle).toBe('Techno')
      expect(result.confidence).toBe(0.42)
      expect(result.threshold).toBe(0.7)
    }
  })

  it('treats a non-finite confidence as zero', () => {
    const result = validateClassification({ style: 'Techno', confidence: Number.NaN }, catalog, 0.7)
    expect(result.status).toBe('low_confidence')
  })
})
