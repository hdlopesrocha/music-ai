import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRuntime, type Runtime } from '../server/container.js'
import { handleNodeRequest } from '../server/nodeAdapter.js'

let runtime: Runtime | null = null

export function getRuntime(): Runtime {
  runtime ??= createRuntime({ env: process.env, rootDir: process.cwd() })
  return runtime
}

/**
 * Shared entry point for serverless Node functions (Vercel-style).
 * The platform passes an IncomingMessage/ServerResponse to each function.
 */
export function serverlessHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const current = getRuntime()
      await handleNodeRequest(current.app, req, res, current.config.maxUploadSize)
    } catch {
      res.statusCode = 503
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(
        JSON.stringify({
          success: false,
          reason: 'SERVER_MISCONFIGURED',
          message: 'The submission service is not configured correctly.',
        }),
      )
    }
  }
}
