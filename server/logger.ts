export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const REDACTED_KEY = /token|secret|password|private|authorization|api[-_]?key/i

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  child(bindings: Record<string, unknown>): Logger
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = REDACTED_KEY.test(key) ? '[redacted]' : redact(item, depth + 1)
  }
  return result
}

export function createLogger(
  level: LogLevel = 'info',
  sink: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> = console,
  bindings: Record<string, unknown> = {},
): Logger {
  const threshold = LEVEL_ORDER[level]

  const emit = (entryLevel: LogLevel, message: string, meta?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[entryLevel] < threshold) return
    const payload = {
      level: entryLevel,
      time: new Date().toISOString(),
      message,
      ...(Object.keys(bindings).length > 0 ? { context: bindings } : {}),
      ...(meta && Object.keys(meta).length > 0
        ? { meta: redact(meta) as Record<string, unknown> }
        : {}),
    }
    sink[entryLevel](JSON.stringify(payload))
  }

  return {
    debug: (message, meta) => emit('debug', message, meta),
    info: (message, meta) => emit('info', message, meta),
    warn: (message, meta) => emit('warn', message, meta),
    error: (message, meta) => emit('error', message, meta),
    child: (extra) => createLogger(level, sink, { ...bindings, ...extra }),
  }
}
