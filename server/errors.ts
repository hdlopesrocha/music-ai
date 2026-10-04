export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'SERVER_MISCONFIGURED'
  | 'UPSTREAM_ERROR'
  | 'OPENCODE_FAILED'
  | 'GITHUB_FAILED'
  | 'CONFLICT'
  | 'INTERNAL'

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly details?: Record<string, unknown>

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  static badRequest(message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError(400, 'BAD_REQUEST', message, details)
  }

  static unsupportedMediaType(message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', message, details)
  }

  static payloadTooLarge(message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', message, details)
  }

  static rateLimited(message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError(429, 'RATE_LIMITED', message, details)
  }

  static misconfigured(message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError(503, 'SERVER_MISCONFIGURED', message, details)
  }

  static upstream(message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError(502, 'UPSTREAM_ERROR', message, details)
  }

  static conflict(message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError(409, 'CONFLICT', message, details)
  }
}

export class OpenCodeError extends Error {
  readonly code:
    'TIMEOUT' | 'EXECUTION_FAILED' | 'EMPTY_RESPONSE' | 'MALFORMED_RESPONSE' | 'UNAVAILABLE'

  constructor(code: OpenCodeError['code'], message: string) {
    super(message)
    this.name = 'OpenCodeError'
    this.code = code
  }
}

export class GitHubError extends Error {
  readonly status: number
  readonly code: 'CONFLICT' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'API_ERROR' | 'NETWORK'

  constructor(code: GitHubError['code'], status: number, message: string) {
    super(message)
    this.name = 'GitHubError'
    this.code = code
    this.status = status
  }

  get isConflict(): boolean {
    return this.code === 'CONFLICT'
  }
}
