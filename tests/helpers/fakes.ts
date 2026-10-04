import { createHash } from 'node:crypto'
import type { AppConfig } from '../../server/config.js'
import { loadConfig } from '../../server/config.js'
import { GitHubError } from '../../server/errors.js'
import type { Logger } from '../../server/logger.js'
import { sha256Hex } from '../../server/utils/hash.js'
import type {
  AudioAnalysisInput,
  MusicAnalysisAgent,
  MusicAnalysisResult,
} from '../../server/services/opencode/types.js'
import type {
  MediaModelInfo,
  ModelCatalog,
  ModelCatalogInfo,
} from '../../server/services/opencode/modelCatalog.js'
import type {
  SimilarArtistService,
  SimilarArtistsResult,
} from '../../server/services/discovery/musicMap.js'
import type {
  CreatePullRequestParams,
  GitHubRepositoryClient,
  IssueComment,
  PullRequestDetails,
  PullRequestInfo,
  RepositoryFile,
  UpdateFileParams,
} from '../../server/services/github/types.js'
import type { Track } from '../../server/services/music/database.js'

export function silentLogger(): Logger {
  const noop = (): void => undefined
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => silentLogger(),
  }
}

export function testConfig(env: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    GITHUB_OWNER: 'test-owner',
    GITHUB_REPOSITORY: 'test-repo',
    GITHUB_BASE_BRANCH: 'main',
    GITHUB_APP_ID: '12345',
    GITHUB_APP_PRIVATE_KEY: 'unused-in-tests',
    RATE_LIMIT_SALT: 'test-salt',
    FEEDBACK_TOKEN_SECRET: 'test-feedback-secret',
    OPENCODE_MODE: 'mock',
    MIN_STYLE_CONFIDENCE: '0.7',
    MAX_UPLOAD_SIZE: '1048576',
    RATE_LIMIT_MAX_REQUESTS: '100',
    SONG_LOOKUP_ENABLED: 'false',
    ...env,
  })
}

export class FakeMusicAnalysisAgent implements MusicAnalysisAgent {
  readonly name = 'fake'
  calls = 0
  lastContext: import('../../server/services/opencode/types.js').MusicAnalysisContext | null = null

  constructor(private readonly result: Partial<MusicAnalysisResult> = {}) {}

  async analyze(
    _input: AudioAnalysisInput,
    context: import('../../server/services/opencode/types.js').MusicAnalysisContext,
  ): Promise<MusicAnalysisResult> {
    this.calls += 1
    this.lastContext = context
    return {
      style: 'Electronic',
      confidence: 0.94,
      substyles: ['Synthwave'],
      tags: ['analog synthesizers', 'retro'],
      instrumental: true,
      ...this.result,
    }
  }
}

export class FakeModelCatalog implements ModelCatalog {
  constructor(
    private readonly mediaModels: MediaModelInfo[] = [],
    private readonly defaultModel = 'fake-model',
  ) {}

  async info(): Promise<ModelCatalogInfo> {
    return {
      models: this.mediaModels,
      defaultModel: this.defaultModel,
      allowOverride: this.mediaModels.length > 0,
      source: this.mediaModels.length > 0 ? 'allowlist' : 'none',
    }
  }

  async isAllowed(model: string): Promise<boolean> {
    return this.mediaModels.some((entry) => entry.id === model)
  }
}

function contentSha(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 40)
}

/**
 * In-memory GitHub repository used by tests. Never touches the network and
 * never creates a real Pull Request.
 */
export class FakeGitHubClient implements GitHubRepositoryClient {
  readonly baseFiles = new Map<string, string>()
  readonly branchFiles = new Map<string, Map<string, string>>()
  readonly branches = new Map<string, string>()
  readonly pullRequests: PullRequestDetails[] = []
  readonly comments = new Map<number, IssueComment[]>()
  baseSha = 'base-sha'
  updateFileFailures = 0
  updateFileCalls = 0
  getFileCalls = 0
  createBranchConflict = false
  beforeUpdateFile: (() => void) | null = null

  private nextPrNumber = 100
  private nextCommentId = 1

  seedBaseFile(path: string, content: string): void {
    this.baseFiles.set(path, content)
  }

  seedBranchFile(branch: string, path: string, content: string): void {
    const files = this.branchFiles.get(branch) ?? new Map<string, string>()
    files.set(path, content)
    this.branchFiles.set(branch, files)
    this.branches.set(branch, contentSha(content))
  }

  seedPullRequest(pr: Partial<PullRequestDetails> & { branch: string }): PullRequestDetails {
    const number = pr.number ?? this.nextPrNumber++
    const pullRequest: PullRequestDetails = {
      number,
      url: pr.url ?? `https://github.com/test-owner/test-repo/pull/${number}`,
      branch: pr.branch,
      title: pr.title ?? 'seeded',
      state: pr.state ?? 'open',
      body: pr.body ?? '',
    }
    this.pullRequests.push(pullRequest)
    return pullRequest
  }

  async getFile(path: string, ref?: string): Promise<RepositoryFile> {
    this.getFileCalls += 1
    const fromBranch = ref ? this.branchFiles.get(ref)?.get(path) : undefined
    const content = fromBranch ?? this.baseFiles.get(path)
    if (content === undefined) {
      throw new GitHubError('NOT_FOUND', 404, `File not found: ${path}@${ref ?? 'default'}`)
    }
    return { path, content, sha: contentSha(content) }
  }

  async getBranchHeadSha(branch: string): Promise<string | null> {
    if (branch === 'main') return this.baseSha
    return this.branches.get(branch) ?? null
  }

  async createBranch(branch: string, fromSha: string): Promise<void> {
    if (this.createBranchConflict || this.branches.has(branch)) {
      throw new GitHubError('CONFLICT', 422, 'Reference already exists')
    }
    this.branches.set(branch, fromSha)
  }

  async updateFile(params: UpdateFileParams): Promise<{ commitSha: string }> {
    this.updateFileCalls += 1
    this.beforeUpdateFile?.()
    if (this.updateFileFailures > 0) {
      this.updateFileFailures -= 1
      throw new GitHubError('CONFLICT', 409, 'sha does not match')
    }
    const files = this.branchFiles.get(params.branch) ?? new Map<string, string>()
    files.set(params.path, params.content)
    this.branchFiles.set(params.branch, files)
    // Direct commits to the base branch must be visible to later reads.
    if (params.branch === 'main') {
      this.baseFiles.set(params.path, params.content)
    }
    const commitSha = contentSha(params.content)
    this.branches.set(params.branch, commitSha)
    return { commitSha }
  }

  async createPullRequest(params: CreatePullRequestParams): Promise<PullRequestInfo> {
    const existing = this.pullRequests.find(
      (pullRequest) => pullRequest.branch === params.head && pullRequest.state === 'open',
    )
    if (existing) {
      throw new GitHubError('CONFLICT', 422, 'A pull request already exists for this branch')
    }
    const number = this.nextPrNumber++
    const pullRequest: PullRequestDetails = {
      number,
      url: `https://github.com/test-owner/test-repo/pull/${number}`,
      branch: params.head,
      title: params.title,
      state: 'open',
      body: params.body,
    }
    this.pullRequests.push(pullRequest)
    return { number, url: pullRequest.url, branch: pullRequest.branch }
  }

  async findOpenPullRequest(headPrefix: string): Promise<PullRequestInfo | null> {
    const found = this.pullRequests.find(
      (pullRequest) => pullRequest.state === 'open' && pullRequest.branch.startsWith(headPrefix),
    )
    return found ? { number: found.number, url: found.url, branch: found.branch } : null
  }

  async getPullRequest(number: number): Promise<PullRequestDetails> {
    const found = this.pullRequests.find((pullRequest) => pullRequest.number === number)
    if (!found) throw new GitHubError('NOT_FOUND', 404, 'Pull request not found')
    return { ...found }
  }

  async listIssueComments(issueNumber: number): Promise<IssueComment[]> {
    return [...(this.comments.get(issueNumber) ?? [])]
  }

  async createIssueComment(issueNumber: number, body: string): Promise<IssueComment> {
    const comment: IssueComment = {
      id: this.nextCommentId++,
      body,
      url: `https://github.com/test-owner/test-repo/pull/${issueNumber}#issuecomment-${this.nextCommentId}`,
    }
    const list = this.comments.get(issueNumber) ?? []
    list.push(comment)
    this.comments.set(issueNumber, list)
    return comment
  }

  async updateIssueComment(commentId: number, body: string): Promise<IssueComment> {
    for (const [issueNumber, list] of this.comments) {
      const index = list.findIndex((comment) => comment.id === commentId)
      const current = list[index]
      if (index >= 0 && current) {
        const updated: IssueComment = { ...current, body }
        list[index] = updated
        this.comments.set(issueNumber, list)
        return updated
      }
    }
    throw new GitHubError('NOT_FOUND', 404, 'Comment not found')
  }
}

export class FakeSimilarArtistService implements SimilarArtistService {
  calls = 0

  constructor(
    private readonly neighbors: string[] = ['Justice', 'Gorillaz'],
    private readonly fail = false,
  ) {}

  async findNeighbors(artist: string): Promise<SimilarArtistsResult> {
    this.calls += 1
    if (this.fail) throw new Error('music-map upstream down')
    return { artist, neighbors: this.neighbors, source: 'music-map' }
  }
}

export function makeAudioInput(overrides: Partial<AudioAnalysisInput> = {}): AudioAnalysisInput {
  const sha = overrides.sha256 ?? sha256Hex('test-audio-bytes')
  return {
    filePath: '/tmp/music-ai-test/example.mp3',
    fileName: 'example.mp3',
    mimeType: 'audio/mpeg',
    size: 16,
    sha256: sha,
    metadata: {
      fileName: 'example.mp3',
      mimeType: 'audio/mpeg',
      size: 16,
      sha256: sha,
    },
    ...overrides,
  }
}

export function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: sha256Hex('track-one'),
    fileName: 'track-one.mp3',
    title: 'Track One',
    artist: 'Test Artist',
    style: 'Electronic',
    confidence: 0.9,
    detectedAt: '2026-10-04T12:00:00.000Z',
    source: 'opencode',
    ...overrides,
  }
}
