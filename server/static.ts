import { readFile, stat } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

export interface StaticFileResponse {
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: Buffer
}

export interface StaticHandler {
  handle(pathname: string): Promise<StaticFileResponse | null>
}

async function loadFile(root: string, filePath: string): Promise<StaticFileResponse | null> {
  try {
    const body = await readFile(filePath)
    const extension = extname(filePath).toLowerCase()
    const relative = filePath.slice(root.length + 1)
    return {
      status: 200,
      headers: {
        'content-type': MIME_TYPES[extension] ?? 'application/octet-stream',
        'cache-control': relative.startsWith(`assets${sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
        'x-content-type-options': 'nosniff',
      },
      body,
    }
  } catch {
    return null
  }
}

/**
 * Serves the built Vue application from `rootDir` so a single container can
 * provide the UI, the JSON databases and the Submission API on one origin.
 * API paths are never handled here. Path traversal is rejected explicitly.
 */
export function createStaticHandler(rootDir: string): StaticHandler {
  const root = resolve(rootDir)

  return {
    async handle(pathname: string): Promise<StaticFileResponse | null> {
      if (pathname.startsWith('/api/') || pathname === '/api') return null

      let decoded = pathname
      try {
        decoded = decodeURIComponent(pathname)
      } catch {
        return null
      }
      if (decoded.includes('\u0000')) return null

      const candidate = resolve(join(root, decoded.replace(/^\/+/, '')))
      if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return null

      try {
        const info = await stat(candidate)
        if (info.isDirectory()) return await loadFile(root, join(candidate, 'index.html'))
        return await loadFile(root, candidate)
      } catch {
        // Hash-based routing needs no server rewrites; fall back to index.html
        // for extension-less paths so deep links still resolve.
        if (extname(decoded).length === 0) {
          return await loadFile(root, join(root, 'index.html'))
        }
        return null
      }
    },
  }
}

export function sendStaticResponse(res: ServerResponse, response: StaticFileResponse): void {
  res.statusCode = response.status
  for (const [name, value] of Object.entries(response.headers)) {
    res.setHeader(name, value)
  }
  res.end(response.body)
}
