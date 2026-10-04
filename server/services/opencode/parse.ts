import { OpenCodeError } from '../../errors.js'
import { truncate } from '../../utils/text.js'

// eslint-disable-next-line no-control-regex -- ANSI escapes from CLI output are stripped intentionally
const ANSI_PATTERN = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '')
}

function stripCodeFences(value: string): string {
  const trimmed = value.trim()
  const fence = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed)
  if (fence?.[1] !== undefined) return fence[1].trim()
  return trimmed
}

/**
 * Finds and parses the first JSON object contained in arbitrary model output.
 * Tolerates markdown fences, surrounding prose and partial streaming prefixes:
 * every `{` position is tried until one yields a complete, parseable object.
 */
export function extractJsonObject(value: string): unknown {
  const text = stripCodeFences(stripAnsi(value))
  if (text.length === 0) {
    throw new OpenCodeError('EMPTY_RESPONSE', 'OpenCode returned an empty response')
  }

  try {
    const direct = JSON.parse(text)
    if (direct !== null && typeof direct === 'object') return direct
  } catch {
    // fall through to scanning
  }

  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    const end = findMatchingBrace(text, start)
    if (end === -1) continue
    const candidate = text.slice(start, end + 1)
    try {
      const parsed = JSON.parse(candidate)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {
      // try the next opening brace
    }
  }

  throw new OpenCodeError(
    'MALFORMED_RESPONSE',
    `OpenCode did not return parseable JSON: ${truncate(collapse(value), 300)}`,
  )
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function findMatchingBrace(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (char === undefined) break

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }

  return -1
}

/**
 * Extracts assistant text from an OpenCode `--format json` event stream.
 * Any event object shaped `{ type: "text", text: "..." }` anywhere in the
 * stream is collected; duplicate streaming revisions are collapsed by id when
 * available. Falls back to the raw output when no events are recognized.
 */
export function extractAssistantText(output: string): string {
  const lines = output.split('\n')
  const byPart = new Map<string, string>()
  const orphan: string[] = []
  let recognized = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let event: unknown
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }
    recognized = true
    collectTextParts(event, byPart, orphan)
  }

  if (!recognized) return output

  const parts = [...byPart.values(), ...orphan]
  return parts.length > 0 ? parts.join('\n') : output
}

function collectTextParts(
  node: unknown,
  byPart: Map<string, string>,
  orphan: string[],
  depth = 0,
): void {
  if (depth > 8 || node === null || typeof node !== 'object') return

  if (Array.isArray(node)) {
    for (const item of node) collectTextParts(item, byPart, orphan, depth + 1)
    return
  }

  const record = node as Record<string, unknown>
  if (record.type === 'text' && typeof record.text === 'string') {
    const id = typeof record.id === 'string' ? record.id : undefined
    if (id) byPart.set(id, record.text)
    else orphan.push(record.text)
  }

  for (const value of Object.values(record)) {
    if (typeof value === 'object' && value !== null) {
      collectTextParts(value, byPart, orphan, depth + 1)
    }
  }
}
