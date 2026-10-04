import { createSign } from 'node:crypto'
import type { GitHubConfig } from '../../config.js'
import { GitHubError } from '../../errors.js'
import type { Logger } from '../../logger.js'
import { isRecord } from '../../utils/text.js'
import type {
  CreatePullRequestParams,
  GitHubRepositoryClient,
  IssueComment,
  PullRequestDetails,
  PullRequestInfo,
  RepositoryFile,
  UpdateFileParams,
} from './types.js'

type FetchLike = typeof fetch

export interface GitHubAppClientOptions {
  readonly config: GitHubConfig
  readonly logger: Logger
  readonly fetchFn?: FetchLike
  readonly now?: () => number
}

interface RequestOptions {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH'
  readonly path: string
  readonly body?: unknown
  readonly auth: string
  readonly allowNotFound?: boolean
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function decodeContent(content: string): string {
  return Buffer.from(content.replace(/\n/g, ''), 'base64').toString('utf8')
}

function encodeContent(content: string): string {
  return Buffer.from(content, 'utf8').toString('base64')
}

/**
 * GitHub App client.
 *
 * Uses an App JWT to mint short-lived installation tokens; the private key and
 * tokens exist only inside this process. The client exposes exactly the
 * operations the workflow requires - no generic GitHub API passthrough.
 */
export class GitHubAppClient implements GitHubRepositoryClient {
  private readonly config: GitHubConfig
  private readonly logger: Logger
  private readonly fetchFn: FetchLike
  private readonly now: () => number
  private readonly owner: string
  private readonly repository: string
  private installationToken: { token: string; expiresAt: number } | null = null
  private installationId: number | null = null

  constructor(options: GitHubAppClientOptions) {
    if (!options.config.owner || !options.config.repository) {
      throw new Error('GitHub owner and repository must be configured')
    }
    if (!options.config.appId || !options.config.privateKey) {
      throw new Error('GitHub App id and private key must be configured')
    }
    this.config = options.config
    this.owner = options.config.owner
    this.repository = options.config.repository
    this.logger = options.logger
    this.fetchFn = options.fetchFn ?? fetch
    this.now = options.now ?? (() => Date.now())
  }

  private createAppJwt(): string {
    const issuedAt = Math.floor(this.now() / 1000)
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const payload = base64url(
      JSON.stringify({
        iat: issuedAt - 60,
        exp: issuedAt + 540,
        iss: String(this.config.appId),
      }),
    )
    const signer = createSign('RSA-SHA256')
    signer.update(`${header}.${payload}`)
    const signature = signer.sign(this.config.privateKey as string)
    return `${header}.${payload}.${base64url(signature)}`
  }

  private async getInstallationToken(): Promise<string> {
    const current = this.installationToken
    if (current && current.expiresAt - 60_000 > this.now()) return current.token

    const jwt = this.createAppJwt()
    if (this.installationId === null) {
      const installation = await this.request({
        method: 'GET',
        path: `/repos/${this.owner}/${this.repository}/installation`,
        auth: `Bearer ${jwt}`,
      })
      if (!isRecord(installation) || typeof installation.id !== 'number') {
        throw new GitHubError('API_ERROR', 502, 'GitHub App installation not found for repository')
      }
      this.installationId = installation.id
    }

    const tokenResponse = await this.request({
      method: 'POST',
      path: `/app/installations/${this.installationId}/access_tokens`,
      auth: `Bearer ${jwt}`,
    })
    if (
      !isRecord(tokenResponse) ||
      typeof tokenResponse.token !== 'string' ||
      typeof tokenResponse.expires_at !== 'string'
    ) {
      throw new GitHubError('API_ERROR', 502, 'GitHub App token response was malformed')
    }

    this.logger.debug('refreshed GitHub App installation token', {
      installationId: this.installationId,
    })
    this.installationToken = {
      token: tokenResponse.token,
      expiresAt: Date.parse(tokenResponse.expires_at),
    }
    return tokenResponse.token
  }

  private async request(options: RequestOptions): Promise<unknown> {
    const url = `${this.config.apiUrl.replace(/\/+$/, '')}${options.path}`
    let response: Response
    try {
      response = await this.fetchFn(url, {
        method: options.method,
        headers: {
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'user-agent': 'ai-music-style-database',
          'x-github-api-version': '2022-11-28',
          authorization: options.auth,
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      })
    } catch (error) {
      throw new GitHubError('NETWORK', 0, `GitHub request failed: ${(error as Error).message}`)
    }

    if (response.status === 204) return null

    let payload: unknown = null
    const text = await response.text()
    if (text.length > 0) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = null
      }
    }

    if (!response.ok) {
      const message =
        isRecord(payload) && typeof payload.message === 'string'
          ? payload.message
          : `GitHub responded with HTTP ${response.status}`

      if (response.status === 404 && options.allowNotFound) return null
      if (response.status === 404) throw new GitHubError('NOT_FOUND', 404, message)
      if (response.status === 401) throw new GitHubError('UNAUTHORIZED', 401, message)
      if (response.status === 403) throw new GitHubError('FORBIDDEN', 403, message)
      if (response.status === 409) throw new GitHubError('CONFLICT', 409, message)
      // 422 with a SHA/stale message means someone else updated the branch first.
      if (response.status === 422 && /sha|conflict|already exists|reference/i.test(message)) {
        throw new GitHubError('CONFLICT', 422, message)
      }
      throw new GitHubError('API_ERROR', response.status, message)
    }

    return payload
  }

  private async authorizedRequest(options: Omit<RequestOptions, 'auth'>): Promise<unknown> {
    const token = await this.getInstallationToken()
    return this.request({ ...options, auth: `Bearer ${token}` })
  }

  async getFile(path: string, ref?: string): Promise<RepositoryFile> {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : ''
    const payload = await this.authorizedRequest({
      method: 'GET',
      path: `/repos/${this.owner}/${this.repository}/contents/${path}${query}`,
    })

    if (
      !isRecord(payload) ||
      typeof payload.content !== 'string' ||
      typeof payload.sha !== 'string'
    ) {
      throw new GitHubError('API_ERROR', 502, `Unexpected content response for ${path}`)
    }

    return { path, content: decodeContent(payload.content), sha: payload.sha }
  }

  async getBranchHeadSha(branch: string): Promise<string | null> {
    const payload = await this.authorizedRequest({
      method: 'GET',
      path: `/repos/${this.owner}/${this.repository}/git/ref/heads/${encodeURIComponent(branch)}`,
      allowNotFound: true,
    })
    if (payload === null) return null
    if (!isRecord(payload) || !isRecord(payload.object) || typeof payload.object.sha !== 'string') {
      throw new GitHubError('API_ERROR', 502, `Unexpected branch response for ${branch}`)
    }
    return payload.object.sha
  }

  async createBranch(branch: string, fromSha: string): Promise<void> {
    await this.authorizedRequest({
      method: 'POST',
      path: `/repos/${this.owner}/${this.repository}/git/refs`,
      body: { ref: `refs/heads/${branch}`, sha: fromSha },
    })
  }

  async updateFile(params: UpdateFileParams): Promise<{ commitSha: string }> {
    const payload = await this.authorizedRequest({
      method: 'PUT',
      path: `/repos/${this.owner}/${this.repository}/contents/${params.path}`,
      body: {
        message: params.message,
        content: encodeContent(params.content),
        branch: params.branch,
        sha: params.sha,
      },
    })
    if (!isRecord(payload) || !isRecord(payload.commit) || typeof payload.commit.sha !== 'string') {
      throw new GitHubError('API_ERROR', 502, 'Unexpected commit response')
    }
    return { commitSha: payload.commit.sha }
  }

  async createPullRequest(params: CreatePullRequestParams): Promise<PullRequestInfo> {
    const payload = await this.authorizedRequest({
      method: 'POST',
      path: `/repos/${this.owner}/${this.repository}/pulls`,
      body: {
        title: params.title,
        body: params.body,
        head: params.head,
        base: params.base,
      },
    })
    if (
      !isRecord(payload) ||
      typeof payload.number !== 'number' ||
      typeof payload.html_url !== 'string' ||
      !isRecord(payload.head) ||
      typeof payload.head.ref !== 'string'
    ) {
      throw new GitHubError('API_ERROR', 502, 'Unexpected pull request response')
    }
    return { number: payload.number, url: payload.html_url, branch: payload.head.ref }
  }

  async findOpenPullRequest(headPrefix: string): Promise<PullRequestInfo | null> {
    const payload = await this.authorizedRequest({
      method: 'GET',
      path: `/repos/${this.owner}/${this.repository}/pulls?state=open&per_page=100`,
    })
    if (!Array.isArray(payload)) return null
    for (const item of payload) {
      if (
        isRecord(item) &&
        typeof item.number === 'number' &&
        typeof item.html_url === 'string' &&
        isRecord(item.head) &&
        typeof item.head.ref === 'string' &&
        item.head.ref.startsWith(headPrefix)
      ) {
        return { number: item.number, url: item.html_url, branch: item.head.ref }
      }
    }
    return null
  }

  async getPullRequest(number: number): Promise<PullRequestDetails> {
    const payload = await this.authorizedRequest({
      method: 'GET',
      path: `/repos/${this.owner}/${this.repository}/pulls/${number}`,
    })
    if (
      !isRecord(payload) ||
      typeof payload.number !== 'number' ||
      typeof payload.html_url !== 'string' ||
      typeof payload.title !== 'string' ||
      typeof payload.state !== 'string' ||
      !isRecord(payload.head) ||
      typeof payload.head.ref !== 'string'
    ) {
      throw new GitHubError('API_ERROR', 502, 'Unexpected pull request response')
    }
    return {
      number: payload.number,
      url: payload.html_url,
      branch: payload.head.ref,
      title: payload.title,
      state: payload.state,
      body: typeof payload.body === 'string' ? payload.body : '',
    }
  }

  async listIssueComments(issueNumber: number): Promise<IssueComment[]> {
    const payload = await this.authorizedRequest({
      method: 'GET',
      path: `/repos/${this.owner}/${this.repository}/issues/${issueNumber}/comments?per_page=100`,
    })
    if (!Array.isArray(payload)) return []
    const comments: IssueComment[] = []
    for (const item of payload) {
      if (
        isRecord(item) &&
        typeof item.id === 'number' &&
        typeof item.body === 'string' &&
        typeof item.html_url === 'string'
      ) {
        comments.push({ id: item.id, body: item.body, url: item.html_url })
      }
    }
    return comments
  }

  async createIssueComment(issueNumber: number, body: string): Promise<IssueComment> {
    const payload = await this.authorizedRequest({
      method: 'POST',
      path: `/repos/${this.owner}/${this.repository}/issues/${issueNumber}/comments`,
      body: { body },
    })
    if (
      !isRecord(payload) ||
      typeof payload.id !== 'number' ||
      typeof payload.html_url !== 'string'
    ) {
      throw new GitHubError('API_ERROR', 502, 'Unexpected comment response')
    }
    return { id: payload.id, body, url: payload.html_url }
  }

  async updateIssueComment(commentId: number, body: string): Promise<IssueComment> {
    const payload = await this.authorizedRequest({
      method: 'PATCH',
      path: `/repos/${this.owner}/${this.repository}/issues/comments/${commentId}`,
      body: { body },
    })
    if (
      !isRecord(payload) ||
      typeof payload.id !== 'number' ||
      typeof payload.html_url !== 'string'
    ) {
      throw new GitHubError('API_ERROR', 502, 'Unexpected comment response')
    }
    return { id: payload.id, body, url: payload.html_url }
  }
}
