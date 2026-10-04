export interface ApiRequest {
  readonly method: string
  readonly path: string
  readonly query: Record<string, string | undefined>
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: Buffer
  /**
   * Raw network peer address. Adapters should only set this when no
   * `x-forwarded-for` / `x-real-ip` header is available. It is never persisted;
   * it is hashed in memory purely for rate limiting.
   */
  readonly remoteAddress?: string
}

export interface ApiResponse {
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: string
}

export function getHeader(request: ApiRequest, name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(request.headers)) {
    if (key.toLowerCase() !== lower) continue
    if (Array.isArray(value)) return value[0]
    return value
  }
  return undefined
}

export function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): ApiResponse {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
    body: JSON.stringify(payload),
  }
}
