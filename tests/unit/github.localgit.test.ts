import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { GitHubError } from '../../server/errors.js'
import { LocalGitHubClient } from '../../server/services/github/localGit.js'
import { silentLogger } from '../helpers/fakes.js'

const exec = promisify(execFile)
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
    { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
  )
  return stdout
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'music-ai-localgit-'))
  roots.push(root)

  const remote = join(root, 'remote.git')
  await git(root, 'init', '--bare', '--initial-branch=main', remote)

  const seed = join(root, 'seed')
  await git(root, 'clone', '--quiet', remote, seed)
  await mkdir(join(seed, 'data'), { recursive: true })
  await writeFile(join(seed, 'data', 'music.json'), '{"version":1,"tracks":[]}\n')
  await writeFile(join(seed, 'data', 'styles.json'), '{"version":1,"styles":["Electronic"]}\n')
  await git(seed, 'add', '-A')
  await git(seed, 'commit', '--quiet', '-m', 'init')
  await git(seed, 'push', '--quiet', '-u', 'origin', 'main')

  const client = new LocalGitHubClient({
    remoteUrl: remote,
    branch: 'main',
    repoDir: join(root, 'clone'),
    commitName: 'Test Bot',
    commitEmail: 'bot@example.com',
    logger: silentLogger(),
  })

  return { root, remote, seed, client }
}

describe('LocalGitHubClient', () => {
  it('reads files with a git blob sha', async () => {
    const { client } = await setup()
    const file = await client.getFile('data/music.json')
    expect(file.content).toBe('{"version":1,"tracks":[]}\n')
    expect(file.sha).toMatch(/^[a-f0-9]{40}$/)
  })

  it('commits and pushes a change to the base branch', async () => {
    const { client, remote } = await setup()
    const file = await client.getFile('data/music.json')
    const updated = '{"version":1,"tracks":[{"id":"x"}]}\n'

    const { commitSha } = await client.updateFile({
      path: 'data/music.json',
      content: updated,
      message: 'data: add track',
      branch: 'main',
      sha: file.sha,
    })
    expect(commitSha).toMatch(/^[a-f0-9]{40}$/)

    const reread = await client.getFile('data/music.json')
    expect(reread.content).toBe(updated)

    const remoteContent = await git(remote, 'show', 'main:data/music.json')
    expect(remoteContent).toBe(updated)
    const log = await git(remote, 'log', '--oneline', 'main')
    expect(log).toContain('data: add track')
  })

  it('rejects a stale blob sha with a CONFLICT', async () => {
    const { client, seed } = await setup()
    const stale = await client.getFile('data/music.json')

    // Someone else pushes a change first.
    await writeFile(join(seed, 'data', 'music.json'), '{"version":1,"tracks":[{"id":"other"}]}\n')
    await git(seed, 'add', '-A')
    await git(seed, 'commit', '--quiet', '-m', 'someone else')
    await git(seed, 'push', '--quiet', 'origin', 'main')

    await expect(
      client.updateFile({
        path: 'data/music.json',
        content: '{"version":1,"tracks":[]}',
        message: 'stale',
        branch: 'main',
        sha: stale.sha,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', isConflict: true })
  })

  it('reports the base branch head sha and missing branches', async () => {
    const { client } = await setup()
    expect(await client.getBranchHeadSha('main')).toMatch(/^[a-f0-9]{40}$/)
    expect(await client.getBranchHeadSha('does-not-exist')).toBeNull()
  })

  it('refuses Pull Request operations', async () => {
    const { client } = await setup()
    await expect(client.findOpenPullRequest('submissions/')).rejects.toBeInstanceOf(GitHubError)
    await expect(
      client.createPullRequest({ title: 't', body: 'b', head: 'h', base: 'main' }),
    ).rejects.toBeInstanceOf(GitHubError)
    await expect(client.getPullRequest(1)).rejects.toMatchObject({ status: 501 })
  })
})
