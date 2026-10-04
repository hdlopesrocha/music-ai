import { generateKeyPairSync, createVerify } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { GitHubError } from '../../server/errors.js'
import { GitHubAppClient } from '../../server/services/github/githubApp.js'
import { silentLogger } from '../helpers/fakes.js'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

interface RecordedRequest {
  method: string
  url: URL
  headers: Record<string, string>
  body: unknown
}

function createClient(handler: (request: RecordedRequest) => Response) {
  const requests: RecordedRequest[] = []
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const request: RecordedRequest = {
      method: init?.method ?? 'GET',
      url: new URL(String(url)),
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    requests.push(request)
    return handler(request)
  })

  const client = new GitHubAppClient({
    config: {
      mode: 'app',
      owner: 'test-owner',
      repository: 'test-repo',
      baseBranch: 'main',
      appId: 42,
      privateKey,
      apiUrl: 'https://api.github.test',
    },
    logger: silentLogger(),
    fetchFn,
  })

  return { client, requests, fetchFn }
}

function installationHandshake(request: RecordedRequest): Response | null {
  if (request.url.pathname === '/repos/test-owner/test-repo/installation') {
    return new Response(JSON.stringify({ id: 7 }), { status: 200 })
  }
  if (request.url.pathname === '/app/installations/7/access_tokens') {
    return new Response(
      JSON.stringify({ token: 'installation-token', expires_at: '2099-01-01T00:00:00Z' }),
      { status: 200 },
    )
  }
  return null
}

describe('GitHubAppClient authentication', () => {
  it('mints a valid RS256 App JWT and exchanges it for an installation token', async () => {
    const { client, requests } = createClient((request) => {
      const handshake = installationHandshake(request)
      if (handshake) return handshake
      return new Response(JSON.stringify({ content: 'e30=', sha: 'abc' }), { status: 200 })
    })

    await client.getFile('data/music.json')

    const installationRequest = requests[0]
    expect(installationRequest).toBeDefined()
    const jwt = installationRequest?.headers.authorization?.replace('Bearer ', '') ?? ''
    const [header, payload, signature] = jwt.split('.')
    expect(header).toBeDefined()
    expect(payload).toBeDefined()
    expect(signature).toBeDefined()

    expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    })
    expect(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()).iss).toBe('42')

    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${header}.${payload}`)
    expect(verifier.verify(publicKey, Buffer.from(signature ?? '', 'base64url'))).toBe(true)

    const musicRequest = requests.find(
      (request) => request.url.pathname === '/repos/test-owner/test-repo/contents/data/music.json',
    )
    expect(musicRequest?.headers.authorization).toBe('Bearer installation-token')
  })
})

describe('GitHubAppClient file operations', () => {
  it('decodes file content and returns the blob sha', async () => {
    const content = '{"version":1,"tracks":[]}'
    const { client } = createClient((request) => {
      const handshake = installationHandshake(request)
      if (handshake) return handshake
      return new Response(
        JSON.stringify({ content: Buffer.from(content).toString('base64'), sha: 'blob-sha' }),
        { status: 200 },
      )
    })

    const file = await client.getFile('data/music.json', 'main')
    expect(file.content).toBe(content)
    expect(file.sha).toBe('blob-sha')
  })

  it('maps update conflicts to a CONFLICT error', async () => {
    const { client } = createClient((request) => {
      const handshake = installationHandshake(request)
      if (handshake) return handshake
      return new Response(JSON.stringify({ message: 'sha does not match' }), { status: 409 })
    })

    await expect(
      client.updateFile({
        path: 'data/music.json',
        content: '{}',
        message: 'msg',
        branch: 'submissions/x',
        sha: 'old-sha',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', isConflict: true })
  })

  it('encodes the content when updating a file', async () => {
    const content = '{"version":1,"tracks":[]}'
    const { client, requests } = createClient((request) => {
      const handshake = installationHandshake(request)
      if (handshake) return handshake
      return new Response(JSON.stringify({ commit: { sha: 'commit-sha' } }), { status: 200 })
    })

    await client.updateFile({
      path: 'data/music.json',
      content,
      message: 'data: add track',
      branch: 'submissions/x',
      sha: 'base-sha',
    })

    const put = requests.find((request) => request.method === 'PUT')
    expect(put?.body).toMatchObject({
      message: 'data: add track',
      branch: 'submissions/x',
      sha: 'base-sha',
      content: Buffer.from(content).toString('base64'),
    })
  })
})

describe('GitHubAppClient branches and pull requests', () => {
  it('returns null for a missing branch', async () => {
    const { client } = createClient((request) => {
      const handshake = installationHandshake(request)
      if (handshake) return handshake
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
    })
    expect(await client.getBranchHeadSha('missing')).toBeNull()
  })

  it('creates branches and maps already-exists to CONFLICT', async () => {
    const { client, requests } = createClient((request) => {
      const handshake = installationHandshake(request)
      if (handshake) return handshake
      return new Response(JSON.stringify({ message: 'Reference already exists' }), { status: 422 })
    })

    await expect(client.createBranch('submissions/x', 'sha')).rejects.toBeInstanceOf(GitHubError)
    const post = requests.find((request) => request.url.pathname.endsWith('/git/refs'))
    expect(post?.body).toEqual({ ref: 'refs/heads/submissions/x', sha: 'sha' })
  })

  it('creates a pull request', async () => {
    const { client } = createClient((request) => {
      const handshake = installationHandshake(request)
      if (handshake) return handshake
      return new Response(
        JSON.stringify({
          number: 152,
          html_url: 'https://github.com/test-owner/test-repo/pull/152',
          head: { ref: 'submissions/electronic-abc' },
        }),
        { status: 201 },
      )
    })

    const pullRequest = await client.createPullRequest({
      title: 'title',
      body: 'body',
      head: 'submissions/electronic-abc',
      base: 'main',
    })
    expect(pullRequest).toEqual({
      number: 152,
      url: 'https://github.com/test-owner/test-repo/pull/152',
      branch: 'submissions/electronic-abc',
    })
  })

  it('finds an open pull request by head prefix', async () => {
    const { client } = createClient((request) => {
      const handshake = installationHandshake(request)
      if (handshake) return handshake
      return new Response(
        JSON.stringify([
          { number: 1, html_url: 'u1', head: { ref: 'other/branch' } },
          { number: 2, html_url: 'u2', head: { ref: 'submissions/electronic-abc' } },
        ]),
        { status: 200 },
      )
    })

    const found = await client.findOpenPullRequest('submissions/electronic-')
    expect(found).toEqual({ number: 2, url: 'u2', branch: 'submissions/electronic-abc' })
  })

  it('creates and updates issue comments', async () => {
    const { client, requests } = createClient((request) => {
      const handshake = installationHandshake(request)
      if (handshake) return handshake
      if (request.method === 'PATCH') {
        return new Response(JSON.stringify({ id: 9, html_url: 'https://github.com/comment/9' }), {
          status: 200,
        })
      }
      return new Response(JSON.stringify({ id: 9, html_url: 'https://github.com/comment/9' }), {
        status: 201,
      })
    })

    const created = await client.createIssueComment(152, 'hello')
    expect(created.id).toBe(9)
    const commentPost = requests.find(
      (request) =>
        request.method === 'POST' && request.url.pathname.endsWith('/issues/152/comments'),
    )
    expect(commentPost?.body).toEqual({ body: 'hello' })

    const updated = await client.updateIssueComment(9, 'updated')
    expect(updated.body).toBe('updated')
  })
})
