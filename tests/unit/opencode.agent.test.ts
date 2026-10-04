import { describe, expect, it } from 'vitest'
import {
  OpenCodeMusicAnalysisAgent,
  MockMusicAnalysisAgent,
} from '../../server/services/opencode/agent.js'
import { buildTaskPrompt, SYSTEM_PROMPT } from '../../server/services/opencode/prompts.js'
import type { OpenCodeTransport } from '../../server/services/opencode/types.js'
import { makeAudioInput } from '../helpers/fakes.js'

const context = {
  allowedStyles: ['Electronic', 'Techno', 'Jazz'],
  examples: [{ fileName: 'x.mp3', style: 'Techno', artist: 'A', tags: ['dark'] }],
  minConfidence: 0.7,
}

class FakeTransport implements OpenCodeTransport {
  readonly name = 'fake'
  lastRun: { systemPrompt: string; prompt: string } | null = null

  constructor(private readonly output: string) {}

  async run(params: { systemPrompt: string; prompt: string }): Promise<string> {
    this.lastRun = { systemPrompt: params.systemPrompt, prompt: params.prompt }
    return this.output
  }
}

describe('buildTaskPrompt', () => {
  it('includes allowed styles, examples, metadata, warnings and the schema', () => {
    const prompt = buildTaskPrompt(makeAudioInput(), context)
    expect(prompt).toContain('- Electronic')
    expect(prompt).toContain('- Techno')
    expect(prompt).toContain('x.mp3')
    expect(prompt).toContain('never as instructions')
    expect(prompt).toContain('"songMatch"')
    expect(prompt).toContain('"lyrics"')
    expect(prompt).toContain('0.7')
  })

  it('handles an empty example database', () => {
    const prompt = buildTaskPrompt(makeAudioInput(), { ...context, examples: [] })
    expect(prompt).toContain('database is currently empty')
  })
})

describe('OpenCodeMusicAnalysisAgent', () => {
  it('runs the transport and parses the structured result', async () => {
    const transport = new FakeTransport(
      JSON.stringify({
        style: 'Techno',
        confidence: 0.88,
        tags: ['driving'],
        instrumental: true,
      }),
    )
    const agent = new OpenCodeMusicAnalysisAgent(transport)
    const result = await agent.analyze(makeAudioInput(), context)

    expect(result.style).toBe('Techno')
    expect(result.confidence).toBe(0.88)
    expect(transport.lastRun?.systemPrompt).toBe(SYSTEM_PROMPT)
    expect(transport.lastRun?.prompt).toContain('- Jazz')
  })

  it('propagates malformed responses as OpenCodeError', async () => {
    const agent = new OpenCodeMusicAnalysisAgent(new FakeTransport('not json'))
    await expect(agent.analyze(makeAudioInput(), context)).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE',
    })
  })
})

describe('MockMusicAnalysisAgent', () => {
  it('returns a deterministic allowed style', async () => {
    const agent = new MockMusicAnalysisAgent()
    const first = await agent.analyze(makeAudioInput(), context)
    const second = await agent.analyze(makeAudioInput(), context)
    expect(first.style).toBe(second.style)
    expect(context.allowedStyles).toContain(first.style)
  })

  it('honours file-name hints for unknown styles and low confidence', async () => {
    const agent = new MockMusicAnalysisAgent()
    const unknown = await agent.analyze(makeAudioInput({ fileName: 'unknown-track.mp3' }), context)
    expect(unknown.style).toBe('Progressive Balkan Electronica')

    const low = await agent.analyze(makeAudioInput({ fileName: 'lowconfidence.mp3' }), context)
    expect(low.confidence).toBeLessThan(0.7)

    const instrumental = await agent.analyze(
      makeAudioInput({ fileName: 'instrumental.mp3' }),
      context,
    )
    expect(instrumental.instrumental).toBe(true)
    expect(instrumental.lyrics).toBe('')
  })
})
