import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GitHubError } from '../../errors.js'
import type { Logger } from '../../logger.js'
import { sha256Hex } from '../../utils/hash.js'
import type {
  CreatePullRequestParams,
  GitHubRepositoryClient,
  IssueComment,
  PullRequestDetails,
  PullRequestInfo,
  RepositoryFile,
  UpdateFileParams,
} from './types.js'

export interface DryRunGitHubClientOptions {
  readonly rootDir: string
  readonly paths: { readonly styles: string; readonly music: string }
  readonly baseBranch: string
  readonly repositoryLabel?: string
  readonly logger: Logger
}

/**
 * Development-only GitHub client. It implements the same interface as the real
 * GitHub App client but keeps everything in memory (seeded from the local data
 * files) and never contacts GitHub. Enable with GITHUB_MODE=dry-run.
 */
export class DryRunGitHubClient implements GitHubRepositoryClient {
  private readonly rootDir: string
  private readonly paths: { readonly styles: string; readonly music: string }
  private readonly baseBranch: string
  private readonly repositoryLabel: string
  private readonly logger: Logger
  private readonly baseFiles = new Map<string, string>()
  private readonly branchFiles = new Map<string, Map<string, string>>()
  private readonly branches = new Map<string, string>()
  private readonly pullRequests: PullRequestDetails[] = []
  private readonly comments = new Map<number, IssueComment[]>()
  private loaded = false
  private nextPrNumber = 1
  private nextCommentId = 1

  constructor(options: DryRunGitHubClientOptions) {
    this.rootDir = options.rootDir
    this.paths = options.paths
    this.baseBranch = options.baseBranch
    this.repositoryLabel = options.repositoryLabel ?? 'dry-run/dry-run'
    this.logger = options.logger
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    for (const path of [this.paths.styles, this.paths.music]) {
      try {
        this.baseFiles.set(path, await readFile(join(this.rootDir, path), 'utf8'))
      } catch {
        throw new GitHubError('NOT_FOUND', 404, `Dry-run cannot read local file ${path}`)
      }
    }
    this.branches.set(this.baseBranch, 'dry-run-base-sha')
    this.loaded = true
  }

  private async readFile(path: string): Promise<string> {
    await this.ensureLoaded()
    const content = this.baseFiles.get(path)
    if (content === undefined) {
      throw new GitHubError('NOT_FOUND', 404, `Dry-run file not found: ${path}`)
    }
    return content
  }

  private fileSha(path: string, content: string): string {
    return sha256Hex(`${path}:${content}`).slice(0, 40)
  }

  async getFile(path: string, ref?: string): Promise<RepositoryFile> {
    await this.ensureLoaded()
    const fromBranch =
      ref && ref !== this.baseBranch ? this.branchFiles.get(ref)?.get(path) : undefined
    const content = fromBranch ?? (await this.readFile(path))
    return { path, content, sha: this.fileSha(path, content) }
  }

  async getBranchHeadSha(branch: string): Promise<string | null> {
    await this.ensureLoaded()
    return this.branches.get(branch) ?? null
  }

  async createBranch(branch: string, fromSha: string): Promise<void> {
    await this.ensureLoaded()
    if (this.branches.has(branch)) {
      throw new GitHubError('CONFLICT', 422, 'Reference already exists')
    }
    this.branches.set(branch, fromSha)
  }

  async updateFile(params: UpdateFileParams): Promise<{ commitSha: string }> {
    await this.ensureLoaded()
    const files = this.branchFiles.get(params.branch) ?? new Map<string, string>()
    files.set(params.path, params.content)
    this.branchFiles.set(params.branch, files)
    // Direct commits to the base branch must be visible to later reads.
    if (params.branch === this.baseBranch) {
      this.baseFiles.set(params.path, params.content)
    }
    const commitSha = this.fileSha(params.path, params.content)
    this.branches.set(params.branch, commitSha)
    this.logger.info('[dry-run] committed file', { branch: params.branch, path: params.path })
    return { commitSha }
  }

  async createPullRequest(params: CreatePullRequestParams): Promise<PullRequestInfo> {
    const number = this.nextPrNumber++
    const pullRequest: PullRequestDetails = {
      number,
      url: `https://github.com/${this.repositoryLabel}/pull/${number}`,
      branch: params.head,
      title: params.title,
      state: 'open',
      body: params.body,
    }
    this.pullRequests.push(pullRequest)
    this.logger.info('[dry-run] pull request created', {
      number,
      branch: params.head,
      title: params.title,
    })
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
      url: `https://github.com/${this.repositoryLabel}/pull/${issueNumber}#issuecomment-${this.nextCommentId}`,
    }
    const list = this.comments.get(issueNumber) ?? []
    list.push(comment)
    this.comments.set(issueNumber, list)
    this.logger.info('[dry-run] issue comment created', { issueNumber })
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
