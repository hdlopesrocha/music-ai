export interface RepositoryFile {
  readonly path: string
  readonly content: string
  readonly sha: string
}

export interface PullRequestInfo {
  readonly number: number
  readonly url: string
  readonly branch: string
}

export interface PullRequestDetails extends PullRequestInfo {
  readonly title: string
  readonly state: string
  readonly body: string
}

export interface IssueComment {
  readonly id: number
  readonly body: string
  readonly url: string
}

export interface CreatePullRequestParams {
  readonly title: string
  readonly body: string
  readonly head: string
  readonly base: string
}

export interface UpdateFileParams {
  readonly path: string
  readonly content: string
  readonly message: string
  readonly branch: string
  readonly sha: string
}

export interface UpdateFilesParams {
  readonly files: readonly { readonly path: string; readonly content: string }[]
  readonly message: string
  readonly branch: string
  /** Blob sha of `files[0]` when it was read, for optimistic concurrency. */
  readonly baseSha: string
}

/**
 * The exact surface of repository access the application needs. Deliberately
 * narrow: it is not a generic GitHub API. OpenCode never receives this client;
 * only the validation workflow uses it after all checks pass.
 */
export interface GitHubRepositoryClient {
  getFile(path: string, ref?: string): Promise<RepositoryFile>
  getBranchHeadSha(branch: string): Promise<string | null>
  createBranch(branch: string, fromSha: string): Promise<void>
  updateFile(params: UpdateFileParams): Promise<{ commitSha: string }>
  /**
   * Optional atomic multi-file commit used for track assets (lyrics/SRT).
   * Clients that cannot commit several files at once omit it.
   */
  updateFiles?(params: UpdateFilesParams): Promise<{ commitSha: string }>
  createPullRequest(params: CreatePullRequestParams): Promise<PullRequestInfo>
  findOpenPullRequest(headPrefix: string): Promise<PullRequestInfo | null>
  getPullRequest(number: number): Promise<PullRequestDetails>
  listIssueComments(issueNumber: number): Promise<IssueComment[]>
  createIssueComment(issueNumber: number, body: string): Promise<IssueComment>
  updateIssueComment(commentId: number, body: string): Promise<IssueComment>
}
