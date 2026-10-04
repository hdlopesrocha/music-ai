import { collapseWhitespace, stripControlCharacters } from '../../utils/text.js'

const DASHES = /[\u2010-\u2015\u2212]/g

/**
 * Normalization is deliberately conservative:
 * Unicode NFKC, control/zero-width removal, dash unification, whitespace
 * collapsing and case folding. No stemming, no token reordering, no fuzzy
 * matching - unrelated genres must never collapse into one another.
 */
export function normalizeStyleToken(value: string): string {
  return collapseWhitespace(stripControlCharacters(value).normalize('NFKC').replace(DASHES, '-'))
    .toLowerCase()
    .trim()
}

export interface StyleCatalog {
  readonly styles: readonly string[]
  readonly canonicalByToken: ReadonlyMap<string, string>
  normalize(value: string): string
  resolve(value: string): string | null
  has(value: string): boolean
}

export function createStyleCatalog(styles: readonly string[]): StyleCatalog {
  const canonicalByToken = new Map<string, string>()
  const canonical: string[] = []

  for (const style of styles) {
    const name = collapseWhitespace(stripControlCharacters(style))
    if (name.length === 0) continue
    const token = normalizeStyleToken(name)
    if (token.length === 0 || canonicalByToken.has(token)) continue
    canonicalByToken.set(token, name)
    canonical.push(name)
  }

  return {
    styles: canonical,
    canonicalByToken,
    normalize: normalizeStyleToken,
    resolve(value: string): string | null {
      return canonicalByToken.get(normalizeStyleToken(value)) ?? null
    },
    has(value: string): boolean {
      return canonicalByToken.has(normalizeStyleToken(value))
    },
  }
}
