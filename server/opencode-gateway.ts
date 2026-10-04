import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { z } from 'zod'
import { loadConfig } from './config.js'
import { createLogger } from './logger.js'
import { readNodeBody, sendApiResponse } from './nodeAdapter.js'
import { CliOpenCodeTransport } from './services/opencode/cliTransport.js'
import type { AudioAnalysisInput } from './services/opencode/types.js'

try {
  process.loadEnvFile()
} catch {
  // .env is optional
}

const MAX_BODY_BYTES = 70 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.flac',
  '.ogg',
  '.m4a',
  '.aac',
  '.opus',
  '.bin',
])

const GatewayRequestSchema = z
  .object({
    // `model` and `agent` are accepted for observability only; the gateway
    // always uses its own configured model and agent. This prevents callers
    // from selecting arbitrary models/agents or injecting instructions into a
    // more privileged agent.
    model: z.string().max(200).optional(),
    agent: z.string().max(100).optional(),
    systemPrompt: z.string().max(100_000).optional(),
    prompt: z.string().min(1).max(200_000),
    audio: z
      .object({
        fileName: z.string().min(1).max(300),
        mimeType: z.string().max(200).optional(),
        base64: z.string().min(1),
      })
      .strict(),
  })
  .strict()

const config = loadConfig()
const logger = createLogger(config.logLevel)
const transport = new CliOpenCodeTransport(config.opencode)

const gatewayPort = Number.parseInt(process.env.GATEWAY_PORT ?? '8788', 10)

const server = createServer((req, res) => {
  void handle(req, res)
})

async function handle(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<void> {
  if (req.method === 'GET' && req.url === '/health') {
    sendApiResponse(res, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        status: 'ok',
        mode: 'opencode-gateway',
        model: config.opencode.model,
        agent: config.opencode.agent,
      }),
    })
    return
  }

  if (!req.url?.startsWith('/analyze')) {
    sendApiResponse(res, {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ success: false, reason: 'NOT_FOUND' }),
    })
    return
  }

  if (req.method !== 'POST') {
    sendApiResponse(res, {
      status: 405,
      headers: { 'content-type': 'application/json; charset=utf-8', allow: 'POST' },
      body: JSON.stringify({ success: false, reason: 'METHOD_NOT_ALLOWED' }),
    })
    return
  }

  if (config.opencode.gatewayToken) {
    const expected = `Bearer ${config.opencode.gatewayToken}`
    if (req.headers.authorization !== expected) {
      sendApiResponse(res, {
        status: 401,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ success: false, reason: 'UNAUTHORIZED' }),
      })
      return
    }
  }

  let workspaceDir: string | null = null
  try {
    const body = await readNodeBody(req, MAX_BODY_BYTES)
    const parsed = GatewayRequestSchema.safeParse(JSON.parse(body.toString('utf8')))
    if (!parsed.success) {
      sendApiResponse(res, {
        status: 400,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ success: false, reason: 'BAD_REQUEST' }),
      })
      return
    }

    const audioBuffer = Buffer.from(parsed.data.audio.base64, 'base64')
    if (audioBuffer.length === 0 || audioBuffer.length > MAX_BODY_BYTES) {
      sendApiResponse(res, {
        status: 400,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ success: false, reason: 'BAD_REQUEST' }),
      })
      return
    }

    workspaceDir = await mkdtemp(join(tmpdir(), 'opencode-gateway-'))
    const extension = extname(parsed.data.audio.fileName).toLowerCase()
    const safeExtension = ALLOWED_EXTENSIONS.has(extension) ? extension : '.bin'
    const filePath = join(workspaceDir, `audio${safeExtension}`)
    await writeFile(filePath, audioBuffer, { mode: 0o600 })

    const input: AudioAnalysisInput = {
      filePath,
      fileName: parsed.data.audio.fileName,
      mimeType: parsed.data.audio.mimeType ?? 'application/octet-stream',
      size: audioBuffer.length,
      sha256: createHash('sha256').update(audioBuffer).digest('hex'),
      metadata: {
        fileName: parsed.data.audio.fileName,
        mimeType: parsed.data.audio.mimeType ?? 'application/octet-stream',
        size: audioBuffer.length,
        sha256: createHash('sha256').update(audioBuffer).digest('hex'),
      },
    }

    const text = await transport.run({
      input,
      systemPrompt: parsed.data.systemPrompt ?? '',
      prompt: parsed.data.prompt,
    })

    sendApiResponse(res, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      body: JSON.stringify({ text }),
    })
  } catch (error) {
    logger.error('gateway analysis failed', { message: (error as Error).message })
    sendApiResponse(res, {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ success: false, reason: 'OPENCODE_FAILED' }),
    })
  } finally {
    if (workspaceDir)
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

server.listen(gatewayPort, config.host, () => {
  logger.info('OpenCode gateway listening', { host: config.host, port: gatewayPort })
})
