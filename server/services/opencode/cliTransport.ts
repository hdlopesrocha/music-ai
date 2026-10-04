import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import type { OpenCodeConfig } from '../../config.js'
import { OpenCodeError } from '../../errors.js'
import { truncate } from '../../utils/text.js'
import { extractAssistantText } from './parse.js'
import type { AudioAnalysisInput, OpenCodeTransport } from './types.js'

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024

export interface CliProcessParams {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly timeoutMs: number
}

export interface CliProcessResult {
  readonly code: number | null
  readonly signal: string | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export type CliProcessRunner = (params: CliProcessParams) => Promise<CliProcessResult>

export interface CliInvocation {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

/**
 * Builds the OpenCode invocation from fixed configuration values only.
 * User supplied data (file name, metadata, prompt) is passed as argv entries or
 * through controlled input files, never concatenated into a shell string, and
 * the process is spawned with `shell: false`.
 */
export function buildCliInvocation(
  config: OpenCodeConfig,
  input: AudioAnalysisInput,
  prompt: string,
): CliInvocation {
  const args = [
    'run',
    '--model',
    config.model,
    '--agent',
    config.agent,
    '--format',
    'json',
    '--dir',
    dirname(input.filePath),
    '--file',
    input.filePath,
    prompt,
  ]

  const env: NodeJS.ProcessEnv = {}
  for (const key of config.envPassthrough) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }

  return { command: config.bin, args, cwd: dirname(input.filePath), env }
}

export const defaultCliProcessRunner: CliProcessRunner = (params) =>
  new Promise<CliProcessResult>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const child = spawn(params.command, [...params.args], {
      cwd: params.cwd,
      env: params.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, params.timeoutMs)

    const append = (current: string, chunk: Buffer): string => {
      if (current.length >= MAX_CAPTURE_BYTES) return current
      return current + chunk.toString('utf8')
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk)
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })

    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr, timedOut })
    })
  })

export class CliOpenCodeTransport implements OpenCodeTransport {
  readonly name = 'cli'
  private readonly runner: CliProcessRunner

  constructor(
    private readonly config: OpenCodeConfig,
    runner: CliProcessRunner = defaultCliProcessRunner,
  ) {
    this.runner = runner
  }

  async run(params: {
    input: AudioAnalysisInput
    systemPrompt: string
    prompt: string
  }): Promise<string> {
    const invocation = buildCliInvocation(this.config, params.input, params.prompt)

    let result: CliProcessResult
    try {
      result = await this.runner({
        command: invocation.command,
        args: invocation.args,
        cwd: invocation.cwd,
        env: invocation.env,
        timeoutMs: this.config.timeoutMs,
      })
    } catch (error) {
      throw new OpenCodeError(
        'EXECUTION_FAILED',
        `Failed to start OpenCode: ${(error as Error).message}`,
      )
    }

    if (result.timedOut) {
      throw new OpenCodeError(
        'TIMEOUT',
        `OpenCode did not finish within ${this.config.timeoutMs} ms`,
      )
    }

    if (result.code !== 0) {
      throw new OpenCodeError(
        'EXECUTION_FAILED',
        `OpenCode exited with code ${result.code ?? 'null'}: ${truncate(
          result.stderr.replace(/\s+/g, ' ').trim(),
          400,
        )}`,
      )
    }

    const text = extractAssistantText(result.stdout).trim()
    if (text.length === 0) {
      throw new OpenCodeError('EMPTY_RESPONSE', 'OpenCode returned no assistant output')
    }
    return text
  }
}
