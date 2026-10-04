import { loadConfig, isGitHubWriterConfigured, type AppConfig } from './config.js'
import { createLogger, type Logger } from './logger.js'
import { SlidingWindowRateLimiter } from './rateLimit.js'
import { Semaphore } from './concurrency.js'
import { createApp, type App } from './app.js'
import { GitHubAppClient } from './services/github/githubApp.js'
import { DryRunGitHubClient } from './services/github/dryRun.js'
import type { GitHubRepositoryClient } from './services/github/types.js'
import { createMusicAnalysisAgent } from './services/opencode/agent.js'
import { OpenCodeModelCatalog, StaticModelCatalog } from './services/opencode/modelCatalog.js'
import { createSongIdentificationService } from './services/song/service.js'
import { createDatabaseSource } from './services/database/source.js'
import { MusicSubmissionWorkflow } from './services/workflow/submitMusic.js'
import { FeedbackWorkflow } from './services/workflow/submitFeedback.js'

export interface Runtime {
  readonly config: AppConfig
  readonly logger: Logger
  readonly app: App
}

export interface CreateRuntimeOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly rootDir?: string
}

export function createRuntime(options: CreateRuntimeOptions = {}): Runtime {
  const env = options.env ?? process.env
  const rootDir = options.rootDir ?? process.cwd()

  const config = loadConfig(env)
  const logger = createLogger(config.logLevel)

  let github: GitHubRepositoryClient | null = null
  if (config.github.mode === 'dry-run') {
    github = new DryRunGitHubClient({
      rootDir,
      paths: { styles: config.styleDatabasePath, music: config.musicDatabasePath },
      baseBranch: config.github.baseBranch,
      ...(config.github.owner && config.github.repository
        ? { repositoryLabel: `${config.github.owner}/${config.github.repository}` }
        : {}),
      logger,
    })
  } else if (isGitHubWriterConfigured(config)) {
    github = new GitHubAppClient({ config: config.github, logger })
  }

  const agent = createMusicAnalysisAgent(config)
  const modelCatalog =
    config.opencode.mode === 'api'
      ? new OpenCodeModelCatalog(config.opencode)
      : new StaticModelCatalog(config.opencode.model)
  const songIdentification = createSongIdentificationService(config, logger)
  const databaseSource = createDatabaseSource(config, github, rootDir)

  const workflow = new MusicSubmissionWorkflow({
    config,
    agent,
    songIdentification,
    databaseSource,
    github,
    logger,
  })

  const feedbackWorkflow = new FeedbackWorkflow({ config, github, logger })

  const rateLimiter = new SlidingWindowRateLimiter({
    windowMs: config.rateLimitWindowMs,
    maxRequests: config.rateLimitMaxRequests,
  })
  const semaphore = new Semaphore(config.maxConcurrentAnalyses)

  const app = createApp({
    config,
    workflow,
    feedbackWorkflow,
    modelCatalog,
    rateLimiter,
    semaphore,
    logger,
  })

  return { config, logger, app }
}
