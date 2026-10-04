import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { GitHubError } from '../../errors.js'
import type { Logger } from '../../logger.js'
import type {
  CreatePullRequestParams,
  GitHubRepositoryClient,
  IssueComment,
  PullRequestDetails,
  PullRequestInfo,
  RepositoryFile,
  UpdateFileParams,
  UpdateFilesParams,
} from './types.js'

const execFileAsync = promisify(execFile)
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

export interface LocalGitOptions {
  readonly remoteUrl: string
  readonly branch: string
  readonly repoDir?: string
  readonly commitName: string
  readonly commitEmail: string
  readonly logger: Logger
  readonly gitBin?: string
}

/**
 * Commits and pushes using the local git installation and its configured
 * credentials (SSH key or credential helper). Intended for a self-hosted
 * single-maintainer deployment; direct commits only, no Pull Requests.
 *
 * A dedicated clone is kept in a cache directory so the server never touches
 * the user's working tree. Each operation fetches the latest base branch and
 * uses git blob SHAs for optimistic concurrency, so the existing retry logic
 * in the workflow works unchanged.
 */
export class LocalGitHubClient implements GitHubRepositoryClient {
  private readonly repoDir: string
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: LocalGitOptions) {
    this.repoDir = options.repoDir ?? join(homedir(), '.cache', 'music-ai', 'repo')
  }

  private async git(args: string[], cwd: string = this.repoDir): Promise<string> {
    try {
      const { stdout } = await execFileAsync(this.options.gitBin ?? 'git', args, {
        cwd,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      })
      return stdout
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? ''
      const detail = String(stderr).replace(/\s+/g, ' ').trim().slice(0, 300)
      throw new GitHubError(
        'NETWORK',
        0,
        `git ${args[0] ?? ''} failed: ${detail || (error as Error).message}`,
      )
    }
  }

  private async ensureRepo(): Promise<void> {
    try {
      await this.git(['rev-parse', '--is-inside-work-tree'])
      return
    } catch {
      // not cloned yet
    }
    await mkdir(dirname(this.repoDir), { recursive: true })
    this.options.logger.info('cloning repository for local-git writes', {
      branch: this.options.branch,
    })
    await this.git(
      ['clone', '--branch', this.options.branch, this.options.remoteUrl, this.repoDir],
      dirname(this.repoDir),
    )
  }

  private async sync(): Promise<void> {
    await this.ensureRepo()
    await this.git(['fetch', 'origin', this.options.branch])
    await this.git(['reset', '--hard', `origin/${this.options.branch}`])
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task)
    this.queue = run.catch(() => undefined)
    return run
  }

  async getFile(path: string): Promise<RepositoryFile> {
    await this.sync()
    try {
      const content = await readFile(join(this.repoDir, path), 'utf8')
      const sha = (await this.git(['hash-object', path])).trim()
      return { path, content, sha }
    } catch (error) {
      if (error instanceof GitHubError) throw error
      throw new GitHubError('NOT_FOUND', 404, `File not found: ${path}`)
    }
  }

  async getBranchHeadSha(branch: string): Promise<string | null> {
    await this.sync()
    try {
      return (await this.git(['rev-parse', branch])).trim()
    } catch {
      return null
    }
  }

  private async blobSha(path: string): Promise<string> {
    try {
      return (await this.git(['hash-object', path])).trim()
    } catch {
      return ''
    }
  }

  private async commitAndPush(
    paths: readonly string[],
    params: UpdateFilesParams | UpdateFileParams,
  ): Promise<{ commitSha: string }> {
    for (const path of paths) {
      await this.git(['add', path])
    }
    await this.git([
      '-c',
      `user.name=${this.options.commitName}`,
      '-c',
      `user.email=${this.options.commitEmail}`,
      'commit',
      '-m',
      params.message,
    ])
    const commitSha = (await this.git(['rev-parse', 'HEAD'])).trim()

    try {
      await this.git(['push', 'origin', `HEAD:${this.options.branch}`])
    } catch (error) {
      throw new GitHubError(
        'CONFLICT',
        409,
        `Push rejected (remote moved): ${(error as Error).message}`,
      )
    }

    this.options.logger.info('local-git commit pushed', {
      branch: this.options.branch,
      commitSha: commitSha.slice(0, 12),
      files: paths.length,
    })
    return { commitSha }
  }

  async updateFile(params: UpdateFileParams): Promise<{ commitSha: string }> {
    return this.updateFiles({
      files: [{ path: params.path, content: params.content }],
      message: params.message,
      branch: params.branch,
      baseSha: params.sha,
    })
  }

  async updateFiles(params: UpdateFilesParams): Promise<{ commitSha: string }> {
    return this.serialize(async () => {
      await this.sync()

      const guarded = params.files[0]
      if (!guarded)
        throw new GitHubError('API_ERROR', 400, 'updateFiles requires at least one file')

      const currentSha = await this.blobSha(guarded.path)
      if (currentSha !== params.baseSha) {
        throw new GitHubError('CONFLICT', 409, 'The file changed since it was read')
      }

      for (const file of params.files) {
        const absolute = join(this.repoDir, file.path)
        await mkdir(dirname(absolute), { recursive: true })
        await writeFile(absolute, file.content, 'utf8')
      }

      return this.commitAndPush(
        params.files.map((file) => file.path),
        params,
      )
    })
  }

  private unsupported(operation: string): never {
    throw new GitHubError(
      'API_ERROR',
      501,
      `${operation} is not supported in local-git mode; use GITHUB_WRITE_MODE=direct`,
    )
  }

  async createBranch(branch: string, fromSha: string): Promise<void> {
    void branch
    void fromSha
    this.unsupported('createBranch')
  }

  async createPullRequest(params: CreatePullRequestParams): Promise<PullRequestInfo> {
    void params
    this.unsupported('createPullRequest')
  }

  async findOpenPullRequest(headPrefix: string): Promise<PullRequestInfo | null> {
    void headPrefix
    this.unsupported('findOpenPullRequest')
  }

  async getPullRequest(number: number): Promise<PullRequestDetails> {
    void number
    this.unsupported('getPullRequest')
  }

  async listIssueComments(issueNumber: number): Promise<IssueComment[]> {
    void issueNumber
    this.unsupported('listIssueComments')
  }

  async createIssueComment(issueNumber: number, body: string): Promise<IssueComment> {
    void issueNumber
    void body
    this.unsupported('createIssueComment')
  }

  async updateIssueComment(commentId: number, body: string): Promise<IssueComment> {
    void commentId
    void body
    this.unsupported('updateIssueComment')
  }
}
