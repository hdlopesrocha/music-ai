import { z } from 'zod'

const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error'])

/**
 * Environment-safe boolean parser. `z.coerce.boolean()` would treat the string
 * "false" as truthy because it relies on JavaScript truthiness.
 */
const BooleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'undefined') return undefined
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false
  }
  return value
}, z.boolean())

const RawConfigSchema = z.object({
  nodeEnv: z.string().default('development'),
  host: z.string().default('0.0.0.0'),
  port: z.coerce.number().int().positive().default(8787),
  logLevel: LogLevelSchema.default('info'),
  allowedOrigins: z.array(z.string()).default([]),
  rateLimitSalt: z.string().min(1).default('insecure-development-salt'),
  feedbackTokenSecret: z.string().min(1).optional(),
  rateLimitWindowMs: z.coerce.number().int().positive().default(60_000),
  rateLimitMaxRequests: z.coerce.number().int().positive().default(6),
  maxConcurrentAnalyses: z.coerce.number().int().positive().default(2),
  maxUploadSize: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),
  maxFilenameLength: z.coerce.number().int().positive().default(200),
  minStyleConfidence: z.coerce.number().min(0).max(1).default(0.7),
  maxContextExamples: z.coerce.number().int().positive().default(24),
  maxContextExamplesPerStyle: z.coerce.number().int().positive().default(3),
  musicDatabasePath: z.string().min(1).default('data/music.json'),
  styleDatabasePath: z.string().min(1).default('data/styles.json'),
  serveStatic: BooleanFromEnv.default(false),
  staticDir: z.string().min(1).default('dist'),
  opencodeMode: z.enum(['cli', 'http', 'mock']).default('cli'),
  opencodeBin: z.string().min(1).default('opencode'),
  opencodeModel: z.string().min(1).default('anthropic/claude-sonnet-4-5'),
  opencodeAgent: z.string().min(1).default('music-classifier'),
  opencodeEndpoint: z.string().optional(),
  opencodeGatewayToken: z.string().optional(),
  opencodeTimeoutMs: z.coerce.number().int().positive().default(120_000),
  opencodeEnvPassthrough: z.array(z.string()).default([]),
  songLookupEnabled: BooleanFromEnv.default(true),
  songLookupProvider: z.enum(['musicbrainz', 'none']).default('musicbrainz'),
  songLookupTimeoutMs: z.coerce.number().int().positive().default(8_000),
  songMatchMinScore: z.coerce.number().min(0).max(100).default(75),
  musicBrainzBaseUrl: z.string().default('https://musicbrainz.org'),
  musicBrainzUserAgent: z
    .string()
    .default('AI-Music-Style-Database/1.0 (+https://github.com/OWNER/REPOSITORY)'),
  githubMode: z.enum(['app', 'dry-run']).default('app'),
  githubOwner: z.string().optional(),
  githubRepository: z.string().optional(),
  githubBaseBranch: z.string().min(1).default('main'),
  githubAppId: z.coerce.number().int().positive().optional(),
  githubAppPrivateKey: z.string().optional(),
  githubApiUrl: z.string().default('https://api.github.com'),
})

export interface OpenCodeConfig {
  readonly mode: 'cli' | 'http' | 'mock'
  readonly bin: string
  readonly model: string
  readonly agent: string
  readonly endpoint?: string
  readonly gatewayToken?: string
  readonly timeoutMs: number
  readonly envPassthrough: readonly string[]
}

export interface GitHubConfig {
  readonly mode: 'app' | 'dry-run'
  readonly owner?: string
  readonly repository?: string
  readonly baseBranch: string
  readonly appId?: number
  readonly privateKey?: string
  readonly apiUrl: string
}

export interface SongLookupConfig {
  readonly enabled: boolean
  readonly provider: 'musicbrainz' | 'none'
  readonly timeoutMs: number
  readonly minScore: number
  readonly baseUrl: string
  readonly userAgent: string
}

export interface AppConfig {
  readonly nodeEnv: string
  readonly host: string
  readonly port: number
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error'
  readonly allowedOrigins: readonly string[]
  readonly rateLimitSalt: string
  readonly feedbackTokenSecret: string
  readonly rateLimitWindowMs: number
  readonly rateLimitMaxRequests: number
  readonly maxConcurrentAnalyses: number
  readonly maxUploadSize: number
  readonly maxFilenameLength: number
  readonly minStyleConfidence: number
  readonly maxContextExamples: number
  readonly maxContextExamplesPerStyle: number
  readonly musicDatabasePath: string
  readonly styleDatabasePath: string
  readonly serveStatic: boolean
  readonly staticDir: string
  readonly opencode: OpenCodeConfig
  readonly songLookup: SongLookupConfig
  readonly github: GitHubConfig
}

function splitList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return items
}

function normalizePrivateKey(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (value.includes('-----BEGIN') && !value.includes('\n')) {
    return value.replace(/\\n/g, '\n')
  }
  return value
}

const DEFAULT_ENV_PASSTHROUGH = [
  'PATH',
  'HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'GEMINI_API_KEY',
]

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = RawConfigSchema.safeParse({
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    allowedOrigins: splitList(env.ALLOWED_ORIGINS),
    rateLimitSalt: env.RATE_LIMIT_SALT,
    feedbackTokenSecret: env.FEEDBACK_TOKEN_SECRET,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    rateLimitMaxRequests: env.RATE_LIMIT_MAX_REQUESTS,
    maxConcurrentAnalyses: env.MAX_CONCURRENT_ANALYSES,
    maxUploadSize: env.MAX_UPLOAD_SIZE,
    maxFilenameLength: env.MAX_FILENAME_LENGTH,
    minStyleConfidence: env.MIN_STYLE_CONFIDENCE,
    maxContextExamples: env.MAX_CONTEXT_EXAMPLES,
    maxContextExamplesPerStyle: env.MAX_CONTEXT_EXAMPLES_PER_STYLE,
    musicDatabasePath: env.MUSIC_DATABASE_PATH,
    styleDatabasePath: env.STYLE_DATABASE_PATH,
    serveStatic: env.SERVE_STATIC,
    staticDir: env.STATIC_DIR,
    opencodeMode: env.OPENCODE_MODE,
    opencodeBin: env.OPENCODE_BIN,
    opencodeModel: env.OPENCODE_MODEL,
    opencodeAgent: env.OPENCODE_AGENT,
    opencodeEndpoint: env.OPENCODE_ENDPOINT,
    opencodeGatewayToken: env.OPENCODE_GATEWAY_TOKEN,
    opencodeTimeoutMs: env.OPENCODE_TIMEOUT_MS,
    opencodeEnvPassthrough: splitList(env.OPENCODE_ENV_PASSTHROUGH),
    songLookupEnabled: env.SONG_LOOKUP_ENABLED,
    songLookupProvider: env.SONG_LOOKUP_PROVIDER,
    songLookupTimeoutMs: env.SONG_LOOKUP_TIMEOUT_MS,
    songMatchMinScore: env.SONG_MATCH_MIN_SCORE,
    musicBrainzBaseUrl: env.MUSICBRAINZ_BASE_URL,
    musicBrainzUserAgent: env.MUSICBRAINZ_USER_AGENT,
    githubMode: env.GITHUB_MODE,
    githubOwner: env.GITHUB_OWNER,
    githubRepository: env.GITHUB_REPOSITORY,
    githubBaseBranch: env.GITHUB_BASE_BRANCH,
    githubAppId: env.GITHUB_APP_ID,
    githubAppPrivateKey: env.GITHUB_APP_PRIVATE_KEY,
    githubApiUrl: env.GITHUB_API_URL,
  })

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid server configuration:\n${details}`)
  }

  const raw = parsed.data
  const feedbackSecret = raw.feedbackTokenSecret ?? raw.rateLimitSalt

  return {
    nodeEnv: raw.nodeEnv,
    host: raw.host,
    port: raw.port,
    logLevel: raw.logLevel,
    allowedOrigins: raw.allowedOrigins,
    rateLimitSalt: raw.rateLimitSalt,
    feedbackTokenSecret: feedbackSecret,
    rateLimitWindowMs: raw.rateLimitWindowMs,
    rateLimitMaxRequests: raw.rateLimitMaxRequests,
    maxConcurrentAnalyses: raw.maxConcurrentAnalyses,
    maxUploadSize: raw.maxUploadSize,
    maxFilenameLength: raw.maxFilenameLength,
    minStyleConfidence: raw.minStyleConfidence,
    maxContextExamples: raw.maxContextExamples,
    maxContextExamplesPerStyle: raw.maxContextExamplesPerStyle,
    musicDatabasePath: raw.musicDatabasePath,
    styleDatabasePath: raw.styleDatabasePath,
    serveStatic: raw.serveStatic,
    staticDir: raw.staticDir,
    opencode: {
      mode: raw.opencodeMode,
      bin: raw.opencodeBin,
      model: raw.opencodeModel,
      agent: raw.opencodeAgent,
      endpoint: raw.opencodeEndpoint,
      gatewayToken: raw.opencodeGatewayToken,
      timeoutMs: raw.opencodeTimeoutMs,
      envPassthrough:
        raw.opencodeEnvPassthrough.length > 0
          ? raw.opencodeEnvPassthrough
          : DEFAULT_ENV_PASSTHROUGH,
    },
    songLookup: {
      enabled: raw.songLookupEnabled,
      provider: raw.songLookupProvider,
      timeoutMs: raw.songLookupTimeoutMs,
      minScore: raw.songMatchMinScore,
      baseUrl: raw.musicBrainzBaseUrl,
      userAgent: raw.musicBrainzUserAgent,
    },
    github: {
      mode: raw.githubMode,
      owner: raw.githubOwner,
      repository: raw.githubRepository,
      baseBranch: raw.githubBaseBranch,
      appId: raw.githubAppId,
      privateKey: normalizePrivateKey(raw.githubAppPrivateKey),
      apiUrl: raw.githubApiUrl,
    },
  }
}

export function isGitHubWriterConfigured(config: AppConfig): boolean {
  if (config.github.mode === 'dry-run') return true
  return Boolean(
    config.github.owner &&
    config.github.repository &&
    config.github.appId &&
    config.github.privateKey,
  )
}

export function describeConfig(config: AppConfig): Record<string, unknown> {
  return {
    nodeEnv: config.nodeEnv,
    serveStatic: config.serveStatic,
    opencodeMode: config.opencode.mode,
    opencodeModel: config.opencode.model,
    minStyleConfidence: config.minStyleConfidence,
    songLookupEnabled: config.songLookup.enabled,
    songLookupProvider: config.songLookup.provider,
    github: {
      mode: config.github.mode,
      owner: config.github.owner ?? null,
      repository: config.github.repository ?? null,
      baseBranch: config.github.baseBranch,
      writerConfigured: isGitHubWriterConfigured(config),
    },
    maxUploadSize: config.maxUploadSize,
  }
}
