import type { AppConfig } from '../../config.js'
import { ApiError, GitHubError } from '../../errors.js'
import type { Logger } from '../../logger.js'
import type { DatabaseSource } from '../database/source.js'
import type { GitHubRepositoryClient, PullRequestInfo } from '../github/types.js'
import {
  buildBranchName,
  buildCommitMessage,
  buildPullRequestBody,
  buildPullRequestTitle,
} from '../github/paths.js'
import type {
  AudioAnalysisInput,
  MusicAnalysisAgent,
  MusicAnalysisResult,
} from '../opencode/types.js'
import { validateClassification } from '../music/classification.js'
import { selectContextExamples } from '../music/context.js'
import {
  buildTrackRecord,
  findTrackById,
  insertTrack,
  parseMusicDatabase,
  serializeMusicDatabase,
  type MusicDatabase,
  type Track,
} from '../music/database.js'
import { createStyleCatalog, type StyleCatalog } from '../music/styles.js'
import type { SongIdentificationService, VerifiedSongMatch } from '../song/types.js'

const MAX_WRITE_ATTEMPTS = 3
const RETRY_DELAYS_MS = [300, 900]

export interface WorkflowDependencies {
  readonly config: AppConfig
  readonly agent: MusicAnalysisAgent
  readonly songIdentification: SongIdentificationService
  readonly databaseSource: DatabaseSource
  readonly github: GitHubRepositoryClient | null
  readonly logger: Logger
  readonly now?: () => Date
  readonly sleep?: (ms: number) => Promise<void>
}

export interface AnalyzeInput {
  readonly input: AudioAnalysisInput
  readonly requestId: string
}

export type AnalyzeOutcome =
  | { readonly status: 'existing'; readonly track: Track }
  | {
      readonly status: 'unknown_style'
      readonly detectedStyle: string
      readonly confidence: number
      readonly classification: MusicAnalysisResult
    }
  | {
      readonly status: 'low_confidence'
      readonly detectedStyle: string
      readonly confidence: number
      readonly threshold: number
      readonly classification: MusicAnalysisResult
    }
  | {
      readonly status: 'classified'
      readonly track: Track
      readonly classification: MusicAnalysisResult
      readonly song: VerifiedSongMatch | null
    }

export type SubmitOutcome =
  | {
      readonly status: 'existing'
      readonly track: Track
      readonly pullRequest: PullRequestInfo | null
    }
  | Extract<AnalyzeOutcome, { status: 'unknown_style' | 'low_confidence' }>
  | {
      readonly status: 'classified'
      readonly track: Track
      readonly classification: MusicAnalysisResult
      readonly song: VerifiedSongMatch | null
      readonly pullRequest: PullRequestInfo
    }

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Orchestrates the full workflow:
 *   audio -> OpenCode (proposal) -> validation -> styles.json check
 *   -> music.json duplicate check -> branch -> commit -> public Pull Request
 *
 * OpenCode's responsibility ends at the structured proposal. Only this
 * workflow may modify repository state, and only after independent validation.
 */
export class MusicSubmissionWorkflow {
  private readonly config: AppConfig
  private readonly agent: MusicAnalysisAgent
  private readonly songIdentification: SongIdentificationService
  private readonly databaseSource: DatabaseSource
  private readonly github: GitHubRepositoryClient | null
  private readonly logger: Logger
  private readonly now: () => Date
  private readonly sleep: (ms: number) => Promise<void>

  constructor(dependencies: WorkflowDependencies) {
    this.config = dependencies.config
    this.agent = dependencies.agent
    this.songIdentification = dependencies.songIdentification
    this.databaseSource = dependencies.databaseSource
    this.github = dependencies.github
    this.logger = dependencies.logger
    this.now = dependencies.now ?? (() => new Date())
    this.sleep = dependencies.sleep ?? defaultSleep
  }

  async analyze({ input, requestId }: AnalyzeInput): Promise<AnalyzeOutcome> {
    const stylesFile = await this.databaseSource.readStyles()
    const catalog = createStyleCatalog(stylesFile.value.styles)
    const musicFile = await this.databaseSource.readMusic()
    return this.analyzeAgainst(input, catalog, musicFile.value, requestId)
  }

  async submit(input: AnalyzeInput): Promise<SubmitOutcome> {
    const analysis = await this.analyze(input)

    if (analysis.status === 'existing') {
      return { status: 'existing', track: analysis.track, pullRequest: null }
    }
    if (analysis.status !== 'classified') return analysis

    if (!this.github || !this.databaseSource.writable) {
      throw ApiError.misconfigured(
        'The GitHub App is not configured, so Pull Requests cannot be created in this environment',
      )
    }

    const result = await this.createPullRequest(
      analysis.track,
      analysis.classification,
      input.requestId,
    )

    if (result.kind === 'existing') {
      return { status: 'existing', track: result.track, pullRequest: result.pullRequest }
    }

    return {
      status: 'classified',
      track: analysis.track,
      classification: analysis.classification,
      song: analysis.song,
      pullRequest: result.pullRequest,
    }
  }

  private async analyzeAgainst(
    input: AudioAnalysisInput,
    catalog: StyleCatalog,
    database: MusicDatabase,
    requestId: string,
  ): Promise<AnalyzeOutcome> {
    const existing = findTrackById(database, input.sha256)
    if (existing) {
      this.logger.info('duplicate track detected', {
        requestId,
        trackId: input.sha256.slice(0, 12),
      })
      return { status: 'existing', track: existing }
    }

    const examples = selectContextExamples(database.tracks, {
      maxTotal: this.config.maxContextExamples,
      perStyle: this.config.maxContextExamplesPerStyle,
    })

    const startedAt = this.now().getTime()
    const result = await this.agent.analyze(input, {
      allowedStyles: catalog.styles,
      examples,
      minConfidence: this.config.minStyleConfidence,
    })
    this.logger.info('analysis completed', {
      requestId,
      engine: this.agent.name,
      durationMs: this.now().getTime() - startedAt,
      style: result.style,
      confidence: result.confidence,
      hasLyrics: Boolean(result.lyrics && result.lyrics.trim().length > 0),
      songProposed: Boolean(result.songMatch),
    })

    const validation = validateClassification(result, catalog, this.config.minStyleConfidence)

    if (validation.status === 'unknown_style') {
      this.logger.info('classification rejected: unknown style', {
        requestId,
        style: validation.detectedStyle,
      })
      return {
        status: 'unknown_style',
        detectedStyle: validation.detectedStyle,
        confidence: validation.confidence,
        classification: result,
      }
    }

    if (validation.status === 'low_confidence') {
      this.logger.info('classification rejected: low confidence', {
        requestId,
        style: validation.detectedStyle,
        confidence: validation.confidence,
      })
      return {
        status: 'low_confidence',
        detectedStyle: validation.detectedStyle,
        confidence: validation.confidence,
        threshold: validation.threshold,
        classification: result,
      }
    }

    const song = await this.songIdentification.identify({
      proposal: result.songMatch ?? null,
      metadata: input.metadata,
      ...(result.lyrics ? { lyrics: result.lyrics } : {}),
    })

    if (song) {
      this.logger.info('song identified', {
        requestId,
        provider: song.provider,
        score: song.score,
      })
    }

    const track = buildTrackRecord({
      metadata: input.metadata,
      classification: result,
      style: validation.resolvedStyle,
      song,
      now: this.now(),
    })

    return { status: 'classified', track, classification: result, song }
  }

  private async createPullRequest(
    track: Track,
    classification: MusicAnalysisResult,
    requestId: string,
  ): Promise<
    | { kind: 'created'; pullRequest: PullRequestInfo }
    | { kind: 'existing'; track: Track; pullRequest: PullRequestInfo | null }
  > {
    const github = this.github
    if (!github) throw ApiError.misconfigured('GitHub App is not configured')

    const branch = buildBranchName(track.style, track.id)
    const baseBranch = this.config.github.baseBranch
    const musicPath = this.config.musicDatabasePath

    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
      try {
        const openPullRequest = await github.findOpenPullRequest(branch)
        if (openPullRequest) {
          const committed = await this.findTrackOnBranch(github, branch, musicPath, track.id)
          return { kind: 'existing', track: committed ?? track, pullRequest: openPullRequest }
        }

        const baseFile = await github.getFile(musicPath, baseBranch)
        const baseDatabase = parseMusicDatabase(baseFile.content)
        const duplicate = findTrackById(baseDatabase, track.id)
        if (duplicate) {
          return { kind: 'existing', track: duplicate, pullRequest: null }
        }

        const updated = insertTrack(baseDatabase, track)
        const content = serializeMusicDatabase(updated)
        // Never commit anything that would not parse back through the schema.
        parseMusicDatabase(content)

        const baseSha = await github.getBranchHeadSha(baseBranch)
        if (!baseSha) {
          throw ApiError.misconfigured(`The configured base branch "${baseBranch}" does not exist`)
        }

        try {
          await github.createBranch(branch, baseSha)
        } catch (error) {
          if (!(error instanceof GitHubError && error.isConflict)) throw error
          // Another request already created the branch; continue idempotently.
        }

        const branchSha = await github.getBranchHeadSha(branch)
        let fileSha = baseFile.sha
        let needsUpdate = true

        if (branchSha) {
          const branchFile = await github.getFile(musicPath, branch)
          const branchDatabase = parseMusicDatabase(branchFile.content)
          if (findTrackById(branchDatabase, track.id)) {
            needsUpdate = false
          } else {
            fileSha = branchFile.sha
          }
        }

        if (needsUpdate) {
          await github.updateFile({
            path: musicPath,
            content,
            message: buildCommitMessage(track),
            branch,
            sha: fileSha,
          })
        }

        let pullRequest: PullRequestInfo
        try {
          pullRequest = await github.createPullRequest({
            title: buildPullRequestTitle(track),
            body: buildPullRequestBody({
              track,
              confidence: classification.confidence,
              branch,
            }),
            head: branch,
            base: baseBranch,
          })
        } catch (error) {
          if (error instanceof GitHubError && error.isConflict) {
            const existing = await github.findOpenPullRequest(branch)
            if (existing) return { kind: 'existing', track, pullRequest: existing }
          }
          throw error
        }

        this.logger.info('pull request created', {
          requestId,
          branch,
          pullRequest: pullRequest.number,
          trackId: track.id.slice(0, 12),
          style: track.style,
        })
        return { kind: 'created', pullRequest }
      } catch (error) {
        const retryable =
          error instanceof GitHubError &&
          (error.isConflict || error.code === 'NETWORK' || error.code === 'API_ERROR')

        if (retryable && attempt < MAX_WRITE_ATTEMPTS) {
          const delay = RETRY_DELAYS_MS[attempt - 1] ?? 900
          this.logger.warn('concurrent or transient GitHub error, retrying', {
            requestId,
            branch,
            attempt,
            delay,
            error: (error as Error).message,
          })
          await this.sleep(delay)
          continue
        }
        throw error
      }
    }

    throw ApiError.conflict(
      'The database was updated concurrently by other submissions; please retry',
    )
  }

  private async findTrackOnBranch(
    github: GitHubRepositoryClient,
    branch: string,
    musicPath: string,
    trackId: string,
  ): Promise<Track | undefined> {
    try {
      const branchFile = await github.getFile(musicPath, branch)
      return findTrackById(parseMusicDatabase(branchFile.content), trackId)
    } catch {
      return undefined
    }
  }
}
