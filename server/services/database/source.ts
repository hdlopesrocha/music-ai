import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppConfig } from '../../config.js'
import { ApiError } from '../../errors.js'
import type { GitHubRepositoryClient } from '../github/types.js'
import {
  parseMusicDatabase,
  parseStyleDatabase,
  type MusicDatabase,
  type StyleDatabase,
} from '../music/database.js'

export interface DatabaseFile<T> {
  readonly content: string
  readonly sha: string
  readonly value: T
}

export interface DatabaseSource {
  readonly kind: 'github' | 'local'
  readonly writable: boolean
  readStyles(): Promise<DatabaseFile<StyleDatabase>>
  readMusic(): Promise<DatabaseFile<MusicDatabase>>
}

export class GitHubDatabaseSource implements DatabaseSource {
  readonly kind = 'github' as const
  readonly writable = true

  constructor(
    private readonly client: GitHubRepositoryClient,
    private readonly paths: { readonly styles: string; readonly music: string },
    private readonly baseBranch: string,
  ) {}

  async readStyles(): Promise<DatabaseFile<StyleDatabase>> {
    const file = await this.client.getFile(this.paths.styles, this.baseBranch)
    return { content: file.content, sha: file.sha, value: parseStyleDatabase(file.content) }
  }

  async readMusic(): Promise<DatabaseFile<MusicDatabase>> {
    const file = await this.client.getFile(this.paths.music, this.baseBranch)
    return { content: file.content, sha: file.sha, value: parseMusicDatabase(file.content) }
  }
}

/**
 * Read-only source used for local development and analyze-only flows where no
 * GitHub App is configured. It can never write; submission requires GitHub.
 */
export class LocalDatabaseSource implements DatabaseSource {
  readonly kind = 'local' as const
  readonly writable = false

  constructor(
    private readonly rootDir: string,
    private readonly paths: { readonly styles: string; readonly music: string },
  ) {}

  private async read(relativePath: string): Promise<{ content: string }> {
    try {
      const content = await readFile(join(this.rootDir, relativePath), 'utf8')
      return { content }
    } catch (error) {
      throw ApiError.misconfigured(
        `Unable to read local database file "${relativePath}": ${(error as Error).message}`,
      )
    }
  }

  async readStyles(): Promise<DatabaseFile<StyleDatabase>> {
    const { content } = await this.read(this.paths.styles)
    return {
      content,
      sha: '',
      value: parseStyleDatabase(content),
    }
  }

  async readMusic(): Promise<DatabaseFile<MusicDatabase>> {
    const { content } = await this.read(this.paths.music)
    return { content, sha: '', value: parseMusicDatabase(content) }
  }
}

export function createDatabaseSource(
  config: AppConfig,
  github: GitHubRepositoryClient | null,
  rootDir: string,
): DatabaseSource {
  const paths = { styles: config.styleDatabasePath, music: config.musicDatabasePath }
  if (github) return new GitHubDatabaseSource(github, paths, config.github.baseBranch)
  return new LocalDatabaseSource(rootDir, paths)
}
