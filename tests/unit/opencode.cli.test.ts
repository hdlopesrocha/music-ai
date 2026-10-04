import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OpenCodeError } from '../../server/errors.js'
import {
  CliOpenCodeTransport,
  buildCliInvocation,
  type CliProcessResult,
  type CliProcessRunner,
} from '../../server/services/opencode/cliTransport.js'
import { makeAudioInput, testConfig } from '../helpers/fakes.js'

const config = testConfig().opencode

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

const streamWith = (text: string): string =>
  [
    JSON.stringify({ type: 'step_start', id: 's1' }),
    JSON.stringify({ type: 'text', id: 'p1', text }),
  ].join('\n')

function runnerReturning(result: Partial<CliProcessResult>): CliProcessRunner {
  return async () => ({
    code: 0,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    ...result,
  })
}

describe('buildCliInvocation', () => {
  it('builds a fixed, shell-free invocation with user data as argv entries', () => {
    const input = makeAudioInput({ filePath: '/tmp/work/a.mp3' })
    const invocation = buildCliInvocation(config, input, 'PROMPT')

    expect(invocation.command).toBe(config.bin)
    expect(invocation.args).toContain('run')
    expect(invocation.args).toContain('--model')
    expect(invocation.args).toContain(config.model)
    expect(invocation.args).toContain('--agent')
    expect(invocation.args).toContain(config.agent)
    expect(invocation.args).toContain('--format')
    expect(invocation.args).toContain('json')
    expect(invocation.args).toContain('--file')
    expect(invocation.args).toContain('/tmp/work/a.mp3')
    expect(invocation.args[invocation.args.length - 1]).toBe('PROMPT')
    expect(invocation.cwd).toBe('/tmp/work')
  })

  it('only passes allowlisted environment variables to the child', () => {
    const invocation = buildCliInvocation(config, makeAudioInput(), 'PROMPT')
    const allowed = new Set(config.envPassthrough)
    for (const key of Object.keys(invocation.env)) {
      expect(allowed.has(key)).toBe(true)
    }
  })
})

describe('CliOpenCodeTransport', () => {
  it('returns the assistant text from a JSON event stream', async () => {
    const transport = new CliOpenCodeTransport(
      config,
      runnerReturning({ stdout: streamWith('{"style":"Electronic","confidence":0.9}') }),
    )
    const text = await transport.run({
      input: makeAudioInput(),
      systemPrompt: 'system',
      prompt: 'prompt',
    })
    expect(text).toContain('"style":"Electronic"')
  })

  it('fails with EXECUTION_FAILED on a non-zero exit code', async () => {
    const transport = new CliOpenCodeTransport(
      config,
      runnerReturning({ code: 1, stderr: 'provider authentication failed' }),
    )
    await expect(
      transport.run({ input: makeAudioInput(), systemPrompt: 's', prompt: 'p' }),
    ).rejects.toMatchObject({ code: 'EXECUTION_FAILED' })
  })

  it('fails with TIMEOUT when the process is killed', async () => {
    const transport = new CliOpenCodeTransport(config, runnerReturning({ timedOut: true }))
    await expect(
      transport.run({ input: makeAudioInput(), systemPrompt: 's', prompt: 'p' }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('fails with EMPTY_RESPONSE when there is no output', async () => {
    const transport = new CliOpenCodeTransport(config, runnerReturning({ stdout: '   ' }))
    await expect(
      transport.run({ input: makeAudioInput(), systemPrompt: 's', prompt: 'p' }),
    ).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' })
  })

  it('fails with EXECUTION_FAILED when the process cannot start', async () => {
    const runner: CliProcessRunner = async () => {
      throw new Error('spawn ENOENT')
    }
    const transport = new CliOpenCodeTransport(config, runner)
    await expect(
      transport.run({ input: makeAudioInput(), systemPrompt: 's', prompt: 'p' }),
    ).rejects.toBeInstanceOf(OpenCodeError)
  })

  it('materialises the project agent definition into the isolated workspace', async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), 'music-ai-agent-src-'))
    const workspace = await mkdtemp(join(tmpdir(), 'music-ai-agent-ws-'))
    cleanups.push(() => rm(sourceDir, { recursive: true, force: true }))
    cleanups.push(() => rm(workspace, { recursive: true, force: true }))

    const source = join(sourceDir, 'music-classifier.md')
    await writeFile(source, '---\ndescription: test agent\n---\nclassify the audio')
    const audioPath = join(workspace, 'audio.mp3')
    await writeFile(audioPath, 'audio-bytes')

    const transport = new CliOpenCodeTransport(
      config,
      runnerReturning({ stdout: streamWith('{"style":"Rock","confidence":0.9}') }),
      { agentSourcePath: source },
    )
    await transport.run({
      input: makeAudioInput({ filePath: audioPath }),
      systemPrompt: 's',
      prompt: 'p',
    })

    const copied = await readFile(
      join(workspace, '.opencode', 'agents', 'music-classifier.md'),
      'utf8',
    )
    expect(copied).toContain('classify the audio')
  })
})
