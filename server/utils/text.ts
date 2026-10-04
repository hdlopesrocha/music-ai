// eslint-disable-next-line no-control-regex -- control characters are exactly what must be stripped
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g
const ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\ufeff]/g

export function stripControlCharacters(value: string): string {
  return value.replace(CONTROL_CHARS, '').replace(ZERO_WIDTH, '')
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function slugify(value: string, fallback = 'track'): string {
  const slug = stripControlCharacters(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug.length > 0 ? slug : fallback
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1))}\u2026`
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function optionalTrimmed(value: unknown, maxLength = 300): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = collapseWhitespace(stripControlCharacters(value))
  if (cleaned.length === 0) return undefined
  return truncate(cleaned, maxLength)
}
