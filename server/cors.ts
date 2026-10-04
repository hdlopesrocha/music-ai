import { getHeader, type ApiRequest } from './http/types.js'

export function resolveCorsOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): string | null {
  if (!origin) return null
  if (allowedOrigins.includes('*')) return origin
  return allowedOrigins.includes(origin) ? origin : null
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-music-filename, x-request-id, authorization',
    'access-control-max-age': '600',
    vary: 'Origin',
  }
}

export function requestOrigin(request: ApiRequest): string | undefined {
  return getHeader(request, 'origin')
}
