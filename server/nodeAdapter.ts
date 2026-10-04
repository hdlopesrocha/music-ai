import type { IncomingMessage, ServerResponse } from 'node:http'
import type { App } from './app.js'
import { ApiError } from './errors.js'
import type { ApiRequest, ApiResponse } from './http/types.js'

export function readNodeBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false

    req.on('data', (chunk: Buffer) => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        settled = true
        reject(ApiError.payloadTooLarge(`The upload exceeds the maximum size of ${limit} bytes`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    })

    req.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}

export function toApiRequest(req: IncomingMessage, body: Buffer): ApiRequest {
  const url = new URL(req.url ?? '/', 'http://internal.local')
  const query: Record<string, string | undefined> = {}
  url.searchParams.forEach((value, key) => {
    query[key] = value
  })

  return {
    method: (req.method ?? 'GET').toUpperCase(),
    path: url.pathname,
    query,
    headers: req.headers as Record<string, string | string[] | undefined>,
    body,
    remoteAddress: req.socket?.remoteAddress,
  }
}

export function sendApiResponse(res: ServerResponse, response: ApiResponse): void {
  res.statusCode = response.status
  for (const [name, value] of Object.entries(response.headers)) {
    res.setHeader(name, value)
  }
  res.end(response.body)
}

/**
 * Bridges a Node `http` request (local dev server or a serverless Node
 * function) to the platform-agnostic application.
 */
export async function handleNodeRequest(
  app: App,
  req: IncomingMessage,
  res: ServerResponse,
  maxBodySize: number,
): Promise<void> {
  try {
    const body = await readNodeBody(req, maxBodySize)
    const apiRequest = toApiRequest(req, body)
    const response = await app.handle(apiRequest)
    sendApiResponse(res, response)
  } catch (error) {
    const response = handleNodeError(error)
    sendApiResponse(res, response)
  }
}

function handleNodeError(error: unknown): ApiResponse {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
      body: JSON.stringify({
        success: false,
        reason: error.code,
        message: error.message,
      }),
    }
  }
  return {
    status: 500,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    body: JSON.stringify({
      success: false,
      reason: 'INTERNAL',
      message: 'An unexpected error occurred while reading the request.',
    }),
  }
}
