import { describe, expect, it } from 'vitest'
import { describeConfig, isGitHubWriterConfigured, loadConfig } from '../../server/config.js'
import { testConfig } from '../helpers/fakes.js'

describe('loadConfig', () => {
  it('parses boolean environment variables correctly', () => {
    expect(testConfig({ SONG_LOOKUP_ENABLED: 'false' }).songLookup.enabled).toBe(false)
    expect(testConfig({ SONG_LOOKUP_ENABLED: '0' }).songLookup.enabled).toBe(false)
    expect(testConfig({ SONG_LOOKUP_ENABLED: 'true' }).songLookup.enabled).toBe(true)
    expect(testConfig({ SONG_LOOKUP_ENABLED: 'on' }).songLookup.enabled).toBe(true)
  })

  it('applies safe defaults', () => {
    const config = loadConfig({})
    expect(config.opencode.mode).toBe('cli')
    expect(config.minStyleConfidence).toBe(0.7)
    expect(config.maxUploadSize).toBe(25 * 1024 * 1024)
    expect(config.musicDatabasePath).toBe('data/music.json')
    expect(config.allowedOrigins).toEqual([])
  })

  it('keeps subtitle storage off by default and parses the flag', () => {
    expect(testConfig().storeSubtitles).toBe(false)
    expect(testConfig({ STORE_SUBTITLES: 'true' }).storeSubtitles).toBe(true)
  })

  it('parses numeric limits', () => {
    const config = testConfig({ MIN_STYLE_CONFIDENCE: '0.85', MAX_UPLOAD_SIZE: '1024' })
    expect(config.minStyleConfidence).toBe(0.85)
    expect(config.maxUploadSize).toBe(1024)
  })

  it('restores escaped newlines in the GitHub App private key', () => {
    const config = loadConfig({
      GITHUB_APP_PRIVATE_KEY:
        '-----BEGIN RSA PRIVATE KEY-----\\nABC\\n-----END RSA PRIVATE KEY-----',
    })
    expect(config.github.privateKey).toContain('\nABC\n')
  })

  it('rejects invalid values', () => {
    expect(() => loadConfig({ MIN_STYLE_CONFIDENCE: '1.5' })).toThrowError(
      /Invalid server configuration/,
    )
    expect(() => loadConfig({ OPENCODE_MODE: 'magic' })).toThrowError(
      /Invalid server configuration/,
    )
    expect(() => loadConfig({ SONG_LOOKUP_ENABLED: 'maybe' })).toThrowError(
      /Invalid server configuration/,
    )
  })

  it('falls back to the rate-limit salt for feedback tokens when unset', () => {
    const config = loadConfig({ RATE_LIMIT_SALT: 'salt-value' })
    expect(config.feedbackTokenSecret).toBe('salt-value')
  })

  it('defaults to Pull Request write mode and accepts direct commits', () => {
    expect(testConfig().github.writeMode).toBe('pr')
    expect(testConfig({ GITHUB_WRITE_MODE: 'direct' }).github.writeMode).toBe('direct')
    expect(() => loadConfig({ GITHUB_WRITE_MODE: 'force-push' })).toThrowError(
      /Invalid server configuration/,
    )
  })
})

describe('isGitHubWriterConfigured', () => {
  it('requires app credentials in app mode', () => {
    const withoutCredentials = loadConfig({ GITHUB_OWNER: 'o', GITHUB_REPOSITORY: 'r' })
    expect(isGitHubWriterConfigured(withoutCredentials)).toBe(false)
    expect(isGitHubWriterConfigured(testConfig())).toBe(true)
  })

  it('is true in dry-run and local-git modes', () => {
    expect(isGitHubWriterConfigured(testConfig({ GITHUB_MODE: 'dry-run' }))).toBe(true)
    expect(isGitHubWriterConfigured(testConfig({ GITHUB_MODE: 'local-git' }))).toBe(true)
  })
})

describe('describeConfig', () => {
  it('never exposes secrets', () => {
    const summary = JSON.stringify(
      describeConfig(
        testConfig({
          GITHUB_APP_PRIVATE_KEY: 'super-secret-key',
          FEEDBACK_TOKEN_SECRET: 'super-secret-token',
          OPENCODE_GATEWAY_TOKEN: 'gateway-secret',
        }),
      ),
    )
    expect(summary).not.toContain('super-secret')
    expect(summary).not.toContain('gateway-secret')
  })
})
