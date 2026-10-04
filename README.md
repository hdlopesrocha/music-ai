# AI Music Style Database

A public music classification website. Any anonymous visitor can select a local music file,
an **OpenCode**-powered analysis agent determines its style (and optionally identifies the
song from transcribed lyrics), and the application opens a **public GitHub Pull Request**
containing the new database entry. No GitHub account, login or email is required.

The repository **is** the database:

- `data/styles.json` - the only styles the AI may choose from
- `data/music.json` - every accepted classification
- Pull Requests - the public, reviewable write mechanism
- GitHub Pages - the public interface, rebuilt after every merge

OpenCode is the intelligence layer. The application is the validation layer. GitHub is the
database and version-control layer. The AI never writes to the repository.

---

## Table of contents

1. [Architecture](#architecture)
2. [How a submission works](#how-a-submission-works)
3. [Repository structure](#repository-structure)
4. [Quick start](#quick-start)
5. [Development commands](#development-commands)
6. [Database format](#database-format)
7. [Submission API](#submission-api)
8. [OpenCode integration](#opencode-integration)
9. [Song identification and feedback](#song-identification-and-feedback)
10. [GitHub App setup](#github-app-setup)
11. [Environment variables](#environment-variables)
12. [GitHub Pages deployment](#github-pages-deployment)
13. [Security model](#security-model)
14. [Abuse protection](#abuse-protection)
15. [Concurrency and duplicate protection](#concurrency-and-duplicate-protection)
16. [Testing](#testing)
17. [Future training dataset](#future-training-dataset)

---

## Architecture

```text
                         ┌─────────────────────┐
                         │       User          │
                         │  No GitHub account  │
                         └──────────┬──────────┘
                                    │ music file
                                    ▼
                         ┌─────────────────────┐
                         │    Vue.js SPA       │
                         │    GitHub Pages     │
                         └──────────┬──────────┘
                                    │ HTTPS (raw audio body)
                                    ▼
                         ┌─────────────────────┐
                         │ Submission API      │
                         │                     │
                         │ Validation          │
                         │ Rate limiting       │
                         │ Temp file cleanup   │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │      OpenCode       │
                         │ read-only sandbox   │
                         │ style + lyrics +    │
                         │ song proposal       │
                         └──────────┬──────────┘
                                    │ structured JSON
                                    ▼
                         ┌─────────────────────┐
                         │ Classification      │
                         │ Validation          │
                         │ + MusicBrainz check │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │     GitHub App      │
                         │ branch / commit / PR│
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ GitHub Repository   │
                         │ data/music.json     │
                         │ data/styles.json    │
                         └──────────┬──────────┘
                                    │ maintainer merges
                                    ▼
                         ┌─────────────────────┐
                         │   GitHub Actions    │
                         │ test / build / Pages│
                         └──────────┬──────────┘
                                    ▼
                         ┌─────────────────────┐
                         │    GitHub Pages     │
                         └─────────────────────┘
```

Layer responsibilities:

| Layer | Responsibility | Must never |
| --- | --- | --- |
| Vue SPA | File selection, metadata preview, progress UI | Hold secrets, call GitHub |
| Submission API | Auth-free intake, validation, rate limiting, orchestration | Trust the AI, concatenate shell commands |
| OpenCode | Proposal: style, confidence, lyrics, song match | Write files, run commands, touch git |
| Validator | Normalize style, compare with `styles.json`, threshold, schema | Accept unknown styles or malformed data |
| GitHub App | Branch, commit, Pull Request, PR comments | Be exposed to the browser |
| Git repository | Source of truth | Store audio or user data |

---

## How a submission works

1. The user opens the GitHub Pages site and selects a file (`.mp3`, `.wav`, `.flac`, `.ogg`,
   `.m4a`, `.aac`, `.opus`).
2. The browser reads metadata (duration inferred from the container, title/artist heuristics)
   and computes a SHA-256 preview. The authoritative hash is computed server-side.
3. The browser `POST`s the raw bytes to `/api/submit` with an `X-Music-Filename` header.
4. The API validates size, MIME type, extension and magic bytes, then writes the audio to a
   per-request temporary directory with `0600` permissions.
5. The API reads `styles.json` and `music.json` from the base branch and selects a bounded
   number of existing entries as few-shot context.
6. OpenCode runs in a read-only sandbox with fixed model, agent and instructions. It returns
   strict JSON: `style`, `confidence`, `substyles`, `tags`, `instrumental`, `lyrics`,
   `lyricsLanguage`, `songMatch`, `diagnostics`.
7. The validator normalizes the style (Unicode NFKC, whitespace, case) and requires an exact
   match in `styles.json`. Unknown styles are rejected. Confidence must clear
   `MIN_STYLE_CONFIDENCE`.
8. Any proposed song is verified against MusicBrainz. A match below `SONG_MATCH_MIN_SCORE` is
   discarded. If a match is accepted, it is stored in the entry; full lyrics are **not**
   stored (copyright), only a `hasLyrics` flag and language.
9. The API re-reads `music.json`, checks the SHA-256 duplicate, builds the updated JSON,
   validates it against the schema, and commits it to a `submissions/<style>-<id>` branch
   using the file's blob SHA (optimistic concurrency).
10. A public Pull Request is opened with the classification summary. The API returns the PR
    URL plus a stateless HMAC feedback token.
11. The user may confirm or reject the detected song. This is posted as a public comment on
    the PR.
12. A maintainer reviews and merges. GitHub Actions runs tests, validates the JSON, builds the
    Vue app and redeploys GitHub Pages.

The uploaded audio is deleted immediately after processing and never leaves the server.

### One-container deployment

`Dockerfile` builds a single image containing the Submission API, OpenCode, the JSON
databases and the compiled Vue UI. It serves everything on port `8787`
(`SERVE_STATIC=true`), so it can be deployed as one service on Render, a VPS, a NAS or
locally:

```bash
docker build -t music-ai .
docker run --rm -p 8787:8787 --env-file .env music-ai
```

`.github/workflows/docker.yml` publishes the image to `ghcr.io/<owner>/music-ai-api` and
`render.yaml` is a ready-to-use Render Blueprint.

---

## Repository structure

```text
/
├── .github/
│   ├── workflows/deploy.yml      # test -> validate -> build -> GitHub Pages
│   └── agents/music-classifier.md# OpenCode agent (read-only, temperature 0)
├── api/                          # serverless entries (Vercel-style Node functions)
│   ├── analyze/index.ts
│   ├── submit/index.ts
│   ├── feedback/index.ts
│   ├── health/index.ts
│   └── _runtime.ts               # shared lazy runtime
├── data/
│   ├── music.json                # the database (source of truth)
│   └── styles.json               # the only styles the AI may choose from
├── prompts/music-classifier.md   # human-readable mirror of the classification prompt
├── public/                       # favicon + generated data copy
├── scripts/
│   ├── sync-data.mjs             # data/ -> public/data for the static site
│   └── validate-data.mjs         # dependency-free CI data validation
├── server/
│   ├── app.ts                    # platform-agnostic router, CORS, errors
│   ├── container.ts              # dependency wiring from configuration
│   ├── index.ts                  # local/self-hosted Node server
│   ├── opencode-gateway.ts       # optional isolated OpenCode HTTP gateway
│   ├── config.ts                 # typed, validated environment configuration
│   ├── handlers/                 # /api/analyze, /api/submit, /api/feedback
│   └── services/
│       ├── database/             # DatabaseSource (GitHub or local)
│       ├── github/               # GitHub App client, dry-run client, PR content
│       ├── music/                # upload validation, metadata, styles, schema
│       ├── opencode/             # agent abstraction, prompts, transports
│       ├── song/                 # song identification (MusicBrainz)
│       └── workflow/             # submission + feedback orchestration
├── src/
│   ├── components/               # FilePicker, AnalysisProgress, TrackTable, ...
│   ├── composables/              # useAnalysis, useMusicDatabase
│   ├── models/                   # shared TypeScript models
│   ├── router/                   # hash-based Vue Router
│   ├── services/                 # API client, metadata, SHA-256, static data
│   ├── utils/                    # formatting, statistics
│   └── views/                    # Home, Analyze, Database, Styles, Result
├── tests/
│   ├── helpers/                  # in-memory GitHub client, fake agent, WAV builder
│   └── unit/                     # 160+ unit and integration tests
├── .env.example
├── package.json
├── tsconfig*.json
├── vite.config.ts
└── vitest.config.ts
```

---

## Quick start

Requirements: Node.js >= 20.11 and npm.

```bash
npm install
cp .env.example .env
```

For a fully local experience (no provider keys, no GitHub App), edit `.env`:

```dotenv
OPENCODE_MODE=mock      # deterministic offline classifier
GITHUB_MODE=dry-run     # Pull Requests are logged, never sent to GitHub
ALLOWED_ORIGINS=http://localhost:5173
```

Then:

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Submission API: http://localhost:8787 (Vite proxies `/api`)

The mock classifier accepts file-name hints:

| File name contains | Effect |
| --- | --- |
| `unknown` | returns a style that is not in `styles.json` |
| `lowconfidence` | returns a below-threshold confidence |
| `instrumental` | reports an instrumental track |
| `song-` | reports a song match (exercises MusicBrainz) |

`npm run dev` runs `data/*.json` validation through the Vite build; use
`npm run validate:data` to check the databases at any time.

### Using real OpenCode locally

Install the OpenCode CLI, authenticate a provider, then:

```dotenv
OPENCODE_MODE=cli
OPENCODE_MODEL=anthropic/claude-sonnet-4-5
OPENCODE_AGENT=music-classifier
```

The CLI transport runs, with `shell: false`:

```text
opencode run --model <OPENCODE_MODEL> --agent music-classifier --format json \
  --dir <temp-dir> --file <audio> <prompt>
```

The agent definition in `.opencode/agents/music-classifier.md` denies `edit`, `bash`,
`webfetch`, `websearch`, `task` and `external_directory`, so the model can only read the
attached audio and the generated prompt.

---

## Development commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Run the API and Vite dev server together |
| `npm run dev:web` | Vite only |
| `npm run dev:api` | Submission API only (watch mode) |
| `npm run build` | Typecheck and build the static site to `dist/` |
| `npm run preview` | Preview the production build |
| `npm start` | Run the self-hosted submission API (`server/index.ts`) |
| `npm run start:gateway` | Run the optional OpenCode analysis gateway |
| `npm run test` | Run the Vitest suite |
| `npm run test:watch` | Watch mode |
| `npm run coverage` | Coverage report |
| `npm run lint` | ESLint |
| `npm run typecheck` | `vue-tsc` + `tsc` for the app, server and configs |
| `npm run validate:data` | Validate `data/*.json` without any dependencies |
| `npm run format` | Prettier |

Server-side development uses `tsx` (no build step). `npm run dev` runs both processes.

---

## Database format

### `data/styles.json`

```json
{
  "version": 1,
  "styles": ["Rock", "Pop", "Electronic", "House", "Techno", "Trance"]
}
```

Maintainers edit this file by Pull Request. A style must exist here before the AI may use it.
Normalization only covers formatting differences (Unicode NFKC, case, whitespace, dashes).
There is no fuzzy matching, so `Rock` and `Rock and Roll` stay distinct.

### `data/music.json`

```json
{
  "version": 1,
  "tracks": [
    {
      "id": "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
      "fileName": "example.mp3",
      "title": "Example",
      "artist": "Example Artist",
      "album": "Example Album",
      "year": 1997,
      "duration": 241,
      "style": "Electronic",
      "substyles": ["Synthwave"],
      "tags": ["analog synthesizers", "retro"],
      "confidence": 0.94,
      "hasLyrics": true,
      "lyricsLanguage": "English",
      "song": {
        "title": "Around the World",
        "artist": "Daft Punk",
        "album": "Homework",
        "year": 1997,
        "provider": "musicbrainz",
        "recordingId": "1e2c...",
        "score": 98
      },
      "detectedAt": "2026-10-04T12:00:00.000Z",
      "source": "opencode",
      "diagnostics": { "bpm": 121, "key": "A Minor", "energy": 0.82 }
    }
  ]
}
```

- `id` is `SHA-256(audio bytes)`, so renaming a file does not create a duplicate.
- Full lyrics and the audio itself are never stored.
- No user information is stored: submissions are anonymous.
- Both files are schema-validated (`zod`, strict objects) before and after modification.
  CI runs `npm run validate:data` on every push and Pull Request.

---

## Submission API

The API is stateless. CORS is restricted to `ALLOWED_ORIGINS`; rate limits are keyed by a
salted hash of the client address (raw IPs are never stored).

### `GET /api/health`

```json
{ "status": "ok", "opencodeMode": "cli", "songLookup": "musicbrainz", "githubMode": "app" }
```

### `POST /api/analyze`

Analyze only. Never creates a Pull Request. Same request shape as `/api/submit`.

### `POST /api/submit`

```http
POST /api/submit HTTP/1.1
Content-Type: audio/mpeg
X-Music-Filename: My%20Song.mp3

<raw audio bytes>
```

Success:

```json
{
  "success": true,
  "existing": false,
  "classification": {
    "style": "Electronic",
    "confidence": 0.94,
    "substyles": ["Synthwave"],
    "tags": ["analog synthesizers", "retro"],
    "instrumental": false,
    "lyrics": "verbatim transcription (transient, not stored)",
    "lyricsLanguage": "English",
    "songMatch": { "title": "Around the World", "artist": "Daft Punk", "confidence": 0.82 }
  },
  "song": {
    "title": "Around the World",
    "artist": "Daft Punk",
    "provider": "musicbrainz",
    "score": 98
  },
  "track": { "...": "the exact entry committed to music.json" },
  "pullRequest": { "number": 152, "url": "https://github.com/OWNER/REPO/pull/152", "branch": "submissions/electronic-2c26b46b68ff" },
  "feedbackToken": "..."
}
```

Unknown style:

```json
{
  "success": false,
  "reason": "UNKNOWN_STYLE",
  "style": "Progressive Balkan Electronica",
  "confidence": 0.91,
  "requiredAction": "The detected style is not part of styles.json. No Pull Request was created."
}
```

Low confidence:

```json
{
  "success": false,
  "reason": "LOW_CONFIDENCE",
  "style": "Techno",
  "confidence": 0.42,
  "threshold": 0.7
}
```

Duplicate:

```json
{ "success": true, "existing": true, "track": { "style": "Electronic" }, "pullRequest": null }
```

Errors use `{ "success": false, "reason": "PAYLOAD_TOO_LARGE", "message": "...", "requestId": "..." }`
with reasons such as `BAD_REQUEST`, `UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`,
`RATE_LIMITED`, `OPENCODE_FAILED`, `OPENCODE_TIMEOUT`, `GITHUB_FAILED`, `DATABASE_INVALID`,
`SERVER_MISCONFIGURED`, `BUSY`, `CONFLICT` or `INTERNAL`.

### `GET /api/similar-artists?artist=Daft%20Punk`

Read-only artist discovery used by the **Find neighbors** button in the Database view. The
server fetches music-map.com politely (descriptive user-agent, 8 s timeout, one upstream
request per second, six-hour in-memory cache) and returns the parsed neighbour names:

```json
{
  "success": true,
  "artist": "Daft Punk",
  "neighbors": ["Justice", "Gorillaz", "Deadmau5"],
  "source": "music-map"
}
```

Discovery is metadata only: it does not download audio. Adding a track still goes through the
file picker or the API, so only audio you have the rights to is ever analysed.

### `POST /api/feedback`

```json
{
  "pullRequestNumber": 152,
  "trackId": "2c26b46b...",
  "confirmed": true,
  "token": "hmac-from-submit-response"
}
```

The token is a stateless HMAC over repository + PR number + track id, so it can only be used
for the exact PR it was issued for. Feedback is added (or updated in place) as a public PR
comment. Requires the GitHub App `Issues: write` permission.

The serverless entries live in `api/analyze`, `api/submit`, `api/feedback` and `api/health`.
For a persistent host run `npm start`; for the OpenCode gateway run `npm run start:gateway`.

---

## OpenCode integration

The application only depends on this abstraction (`server/services/opencode/types.ts`):

```typescript
interface MusicAnalysisAgent {
  analyze(input: AudioAnalysisInput, context: MusicAnalysisContext): Promise<MusicAnalysisResult>
}
```

`OpenCodeMusicAnalysisAgent` is the single implementation that knows about OpenCode. The rest
of the system (workflow, GitHub logic, Vue app) never imports OpenCode-specific code, so the
agent can be replaced without touching the frontend or database logic. There is also
`MockMusicAnalysisAgent` for offline development and tests.

Four transports:

| `OPENCODE_MODE` | Description |
| --- | --- |
| `api` | Calls the OpenCode Go/Zen API (`OPENCODE_API_URL`) with `OPENCODE_API_KEY`, sending the audio inline as `input_audio`. **This is the only mode where the model actually listens to the audio.** |
| `cli` (default) | Spawns `opencode run` locally with a fixed agent, model, dir and timeout. CLI models cannot read binary audio, so classification relies on metadata only. |
| `http` | `POST`s to a remote OpenCode analysis gateway (`OPENCODE_ENDPOINT`) with bearer auth |
| `mock` | Deterministic offline classifier; never used in production |

### Model and context selection

In `api` mode the server discovers which models can analyse audio: it lists the
`GET {OPENCODE_API_URL}/models` catalogue, joins it with the public models.dev metadata,
and keeps only models that accept **audio** input and speak the OpenAI-compatible
chat-completions protocol. `OPENCODE_MEDIA_MODELS` can pin an explicit allowlist instead.

- `GET /api/opencode/models` returns the selectable models, the default, and the context
  bounds. Anonymous submissions may pass `X-Analysis-Model` and `X-Context-Examples`.
- The model header is rejected with `400` unless it is in the media-capable catalog.
- The context header is clamped to `MAX_CONTEXT_EXAMPLES`, so callers can never inflate
  prompts beyond the configured maximum.
- The Analyze page renders these as "Model" and "Context size" selectors and remembers the
  choice locally.

Direct API mode accepts **WAV and MP3** inline (the OpenAI audio formats) up to
`OPENCODE_MAX_AUDIO_BYTES`. Free OpenCode models cannot be used through the API
("free tier can only be used from within OpenCode"), so choose a model included in your
Go/Zen plan.

For serverless deployments (where OpenCode cannot run inside the function), run the gateway
on a dedicated host and set `OPENCODE_MODE=http`. The gateway (`server/opencode-gateway.ts`)
accepts base64 audio, writes it to an isolated temp directory, invokes OpenCode with the same
locked-down agent, and returns the raw model text. It always uses its own configured model
and agent; callers cannot select them.

The model is never hard-coded: set `OPENCODE_MODEL=provider/model` (see `opencode models`).
The CLI is invoked with `shell: false` and an argv array, only allowlisted environment
variables from `OPENCODE_ENV_PASSTHROUGH` are forwarded, and a timeout kills the process.

OpenCode returns strict JSON, parsed by a tolerant extractor (handles markdown fences,
streaming event streams and surrounding prose) and then a strict schema validator. A result
that fails either step yields `OPENCODE_FAILED`.

---

## Song identification and feedback

1. OpenCode transcribes vocals (when present) and, if the lyrics clearly identify a known
   song, proposes `{ title, artist, confidence }`.
2. The server verifies the proposal against **MusicBrainz** (free, no API key). Results below
   `SONG_MATCH_MIN_SCORE` are discarded. Provider failures never block a classification.
   The provider is abstracted (`SongIdentificationService`) so AudD/Genius can be added later
   by implementing one interface.
3. Only canonical metadata is stored in `music.json`. The full lyrics are used transiently
   for identification, returned to the browser for display, and then discarded.
4. The result page asks the user whether the detected song is correct. The answer is posted
   as a public comment on the Pull Request.

---

## GitHub App setup

Never use a Personal Access Token. Create a GitHub App:

1. **Settings -> Developer settings -> GitHub Apps -> New GitHub App.**
2. Homepage URL: your GitHub Pages URL. Webhook: disable.
3. Repository permissions (minimum):
   - **Contents: Read and write** - read `data/*.json`, create branches and commits
   - **Pull requests: Read and write** - create PRs, read PR state/branch
   - **Issues: Write** - create and update the feedback comment on PRs
   - **Metadata: Read-only** - mandatory
4. Install the App on the target repository only.
5. Generate a private key (PKCS#8/PEM). Keep it server-side.
6. Configure the environment:

```dotenv
GITHUB_MODE=app
GITHUB_OWNER=your-user-or-org
GITHUB_REPOSITORY=your-repo
GITHUB_BASE_BRANCH=main
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

The private key is only read by `GitHubAppClient`, which mints short-lived installation
tokens (cached until shortly before expiry). The API exposes exactly the operations the
workflow needs - it is not a generic GitHub proxy. The repository must be public for the PRs
to be publicly visible.

---

## Environment variables

Frontend variables (bundled by Vite, safe to expose):

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_BASE_PATH` | `/` | Base path for GitHub Pages project sites |
| `VITE_API_BASE_URL` | `` | Build-time Submission API origin (overrides `config.json`) |
| `VITE_REPOSITORY_URL` | `` | Public repo URL used for links |

Server variables (never exposed to the browser):

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | API bind address |
| `SERVE_STATIC` / `STATIC_DIR` | `false` / `dist` | Serve the built UI from the same origin |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `ALLOWED_ORIGINS` | `` | Comma-separated CORS origins |
| `RATE_LIMIT_SALT` | dev salt | Salt for hashed rate-limit keys |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS` | `60000` / `6` | Sliding window |
| `MAX_CONCURRENT_ANALYSES` | `2` | Concurrent OpenCode runs per instance |
| `MAX_UPLOAD_SIZE` | `26214400` | Max upload bytes (25 MB) |
| `MAX_FILENAME_LENGTH` | `200` | Max file-name length |
| `MIN_STYLE_CONFIDENCE` | `0.7` | Rejection threshold |
| `MAX_CONTEXT_EXAMPLES` / `..._PER_STYLE` | `24` / `3` | Few-shot context bounds |
| `MUSIC_DATABASE_PATH` / `STYLE_DATABASE_PATH` | `data/music.json` / `data/styles.json` | Repo paths |
| `OPENCODE_MODE` | `cli` | `api` \| `cli` \| `http` \| `mock` |
| `OPENCODE_BIN` | `opencode` | CLI binary |
| `OPENCODE_MODEL` | mode default | Model id (`api`: `mimo-v2.6-flash`, otherwise `provider/model`) |
| `OPENCODE_AGENT` | `music-classifier` | Agent name (CLI mode) |
| `OPENCODE_API_URL` / `OPENCODE_API_KEY` | Go endpoint / - | Direct OpenCode API (`api` mode) |
| `OPENCODE_MEDIA_MODELS` | auto | Explicit allowlist of selectable media models |
| `OPENCODE_MAX_AUDIO_BYTES` / `..._SECONDS` / `..._OUTPUT_TOKENS` | `12 MB` / `120 s` / `3000` | Inline audio caps; only the first N seconds are analysed (0 disables) |
| `OPENCODE_MODEL_CATALOG_URL` / `..._TTL_MS` | models.dev / 6 h | Capability catalogue |
| `OPENCODE_ENDPOINT` / `OPENCODE_GATEWAY_TOKEN` | - | Remote gateway for `http` mode (always set a token) |
| `GATEWAY_PORT` | `8788` | Port for `npm run start:gateway` |
| `OPENCODE_TIMEOUT_MS` | `120000` | Hard timeout |
| `OPENCODE_ENV_PASSTHROUGH` | sane defaults | Allowlist forwarded to the child |
| `MUSIC_MAP_ENABLED` | `true` | Enable the music-map.com neighbor lookup |
| `MUSIC_MAP_BASE_URL` / `..._TIMEOUT_MS` | music-map.com / `8 s` | Discovery upstream |
| `MUSIC_MAP_CACHE_TTL_MS` / `..._MAX_NEIGHBORS` | `6 h` / `24` | Discovery cache and result cap |
| `SONG_LOOKUP_ENABLED` | `true` | Enable MusicBrainz verification |
| `SONG_LOOKUP_PROVIDER` | `musicbrainz` | `musicbrainz` \| `none` |
| `SONG_MATCH_MIN_SCORE` | `75` | MusicBrainz score threshold |
| `MUSICBRAINZ_USER_AGENT` | project UA | Required by MusicBrainz |
| `FEEDBACK_TOKEN_SECRET` | `RATE_LIMIT_SALT` | HMAC secret for feedback tokens |
| `GITHUB_MODE` | `app` | `app` \| `dry-run` |
| `GITHUB_WRITE_MODE` | `pr` | `pr` opens a Pull Request; `direct` commits to the base branch |
| `GITHUB_OWNER` / `GITHUB_REPOSITORY` / `GITHUB_BASE_BRANCH` | - | Target repository |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` | - | GitHub App credentials |
| `GITHUB_API_URL` | `https://api.github.com` | For GitHub Enterprise |

`.env.example` documents every variable. Server configuration is parsed and validated once at
startup; invalid values fail fast with a descriptive error.

---

## GitHub Pages deployment

1. Enable **Settings -> Pages -> Source: Deploy from a branch -> `gh-pages` / (root)**.
2. Point the frontend at your Submission API, either:
   - **Runtime (recommended):** edit `apiBaseUrl` in `public/config.json` before building, or
     directly in the `config.json` of the `gh-pages` branch for an instant change without a
     rebuild, or
   - **Build-time:** set the repository variable `VITE_API_BASE_URL` to the deployed API origin
     (it takes precedence over `config.json`).
3. Push to `main`. The workflow `.github/workflows/deploy.yml`:
   - installs dependencies,
   - runs `npm run validate:data`, lint, typecheck and tests,
   - builds with `VITE_BASE_PATH=/<repository>/`,
   - publishes `dist/` to the `gh-pages` branch, which GitHub Pages serves.

The app uses `createWebHashHistory()`, so every route (`#/`, `#/analyze`, `#/database`,
`#/styles`, `#/result`) works on refresh without server rewrites.

If no API is configured, the Analyze page explains that submissions are disabled on that
deployment instead of sending a request that GitHub Pages would reject with `405`. Browsing
the database and styles keeps working.

After a maintainer merges a classification PR, the workflow reruns and the new track appears
in the public database automatically.

### Deploying the API (Docker, published from GitHub)

GitHub itself cannot run the server: GitHub Pages serves static files only, and Actions
runners cannot receive inbound HTTP traffic. GitHub **can** build and publish a container
image, and any small host can run it. The image is self-contained - it serves the Submission
API, the built Vue UI and `data/*.json` on a single origin.

1. **Publish the image.** `.github/workflows/docker.yml` builds and pushes
   `ghcr.io/<owner>/music-ai-api:latest` on every push to `main`.
2. **Make the package public.** Repository -> Packages -> `music-ai-api` -> Package settings
   -> Change visibility -> Public (or configure registry credentials on your host).
3. **Run it** on any host:
   - **Render Blueprint:** New -> Blueprint -> select this repository. `render.yaml` is
     detected; fill the secret variables (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
     `ANTHROPIC_API_KEY`). The free plan sleeps after inactivity; `starter` stays warm.
   - **Any Docker host / VPS / NAS:**
     ```bash
     docker run -d --name music-ai -p 8787:8787 \
       -e GITHUB_MODE=app \
       -e GITHUB_OWNER=hdlopesrocha -e GITHUB_REPOSITORY=music-ai -e GITHUB_BASE_BRANCH=main \
       -e GITHUB_APP_ID=123456 -e GITHUB_APP_PRIVATE_KEY="$PRIVATE_KEY" \
       -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
       -e OPENCODE_MODE=cli -e SERVE_STATIC=true \
       -e ALLOWED_ORIGINS=https://hdlopesrocha.github.io \
       -e RATE_LIMIT_SALT="$(openssl rand -hex 16)" \
       -e FEEDBACK_TOKEN_SECRET="$(openssl rand -hex 32)" \
       ghcr.io/hdlopesrocha/music-ai-api:latest
     ```
   - **Locally:** `docker compose up --build` with a filled `.env`.

   The container's provider credentials are forwarded to OpenCode through
   `OPENCODE_ENV_PASSTHROUGH` (which already includes `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
   `OPENROUTER_API_KEY` and `GEMINI_API_KEY`).
4. **Point the static site at it.** Set `apiBaseUrl` in `config.json` (gh-pages branch) or the
   repository variable `VITE_API_BASE_URL`, and include the Pages origin in `ALLOWED_ORIGINS`.
   If you instead browse the container's own UI (`http://host:8787`), no configuration is
   needed because the API is same-origin.

The serverless `api/*` entries remain available for Vercel/Netlify deployments, but OpenCode
cannot run inside a function there: set `OPENCODE_MODE=http` and point `OPENCODE_ENDPOINT` at
the gateway (`npm run start:gateway`) running on a Node host.

### Write modes: Pull Request or direct commit

`GITHUB_WRITE_MODE` controls how accepted classifications reach the repository:

| Mode | Behaviour |
| --- | --- |
| `pr` (default) | Commits to a `submissions/<style>-<id>` branch and opens a public Pull Request. Reviewable, and the feedback comment flow works. |
| `direct` | Commits straight to `GITHUB_BASE_BRANCH` (e.g. `main`/`master`) with the same optimistic-concurrency retries and schema validation. No branch, no review, no feedback comments. |

Both modes use the GitHub App and the same duplicate/style/schema validation; the only
difference is where the commit lands. Direct mode is intended for single-maintainer setups
or fully trusted deployments. If the target branch is protected, the GitHub App must be
allowed to bypass the protection or the commit will be rejected with `GITHUB_FAILED`.

In direct mode the API responds with `publication.type: "commit"` and a `commit` object
(`{ sha, url, branch }`) instead of `pullRequest`; the UI shows a "Committed directly" card
and the feedback question is skipped.

---

## Security model

- **No secrets in the frontend.** The Vue app talks only to the restricted Submission API.
- **No generic GitHub API.** `GitHubRepositoryClient` exposes only read-file, branch, commit,
  PR and feedback-comment operations.
- **AI never writes.** OpenCode's tools are denied (`edit`, `bash`, `webfetch`, `websearch`,
  `task`, `external_directory`), its working directory is a per-request temp directory, and
  it only sees the audio plus the prompt.
- **No shell injection.** OpenCode is spawned with `shell: false`, an argv array, a fixed
  working directory, a fixed agent/model and a timeout. User input is never concatenated into
  a command.
- **Validate everything.** Upload size, MIME, extension, magic bytes, filename sanitization,
  rate limits, schema validation before and after modification, style allowlist, confidence
  threshold, duplicate detection.
- **No PII.** No accounts, no IP storage (rate-limit keys are salted HMACs held in memory),
  no user fields in the database.
- **Stateless tokens.** Feedback tokens are HMACs bound to repository + PR + track id.
- **Graceful failures.** Errors are generic to the client and logged with a redacting logger;
  no provider keys or stack traces are returned.

---

## Abuse protection

- Sliding-window rate limiting per client and route (`429` + `Retry-After`).
- Maximum upload size enforced while streaming the body and again on the buffer.
- Extension + MIME allowlist plus magic-byte container detection (a FLAC renamed `.mp3` is
  rejected).
- Filenames: URL-decoding, path stripping (POSIX and Windows), control/zero-width removal,
  reserved-name neutralisation, length cap.
- Concurrency semaphore bounds simultaneous analyses (`503 BUSY` instead of unbounded queue).
- OpenCode timeout and output capture caps.
- Temporary directories with `0600` files, always removed in `finally`.
- CI re-validates `data/*.json` so a malformed merge cannot reach the site.

---

## Concurrency and duplicate protection

`music.json` is never blindly overwritten:

1. Duplicate check by `track.id` before analysis (saves AI cost) and again against the fresh
   base file immediately before committing.
2. The commit uses the file's blob SHA. If the base branch moved, GitHub returns a conflict.
3. The workflow then re-reads the latest file, re-checks the duplicate, rebuilds the JSON and
   retries (up to 3 attempts with backoff).
4. Branch creation conflicts are tolerated, and the branch file is inspected: if the track is
   already committed, the Pull Request is created (or reused) idempotently.
5. Open Pull Requests are matched by branch prefix, so concurrent identical submissions
   return the existing PR instead of creating duplicates.

---

## Testing

```bash
npm test
```

160+ tests cover:

- **Music processing** - supported/unsupported types, magic bytes, metadata extraction from a
  real WAV, SHA-256 vectors, filename sanitization and path traversal.
- **OpenCode** - JSON extraction (fences, prose, streaming), schema validation, malformed and
  empty responses, unknown styles, low confidence, timeouts, exit codes, HTTP transport,
  environment allowlisting and invocation arguments.
- **Song identification** - MusicBrainz matching, score filtering, provider failures.
- **Database** - duplicate detection, style normalization, strict schema validation,
  deterministic IDs, record building (lyrics are never persisted).
- **GitHub** - App JWT signing, installation tokens, file decoding, conflict mapping, branch
  and PR creation, comment create/update, and a full in-memory client.
- **Workflow** - PR creation, duplicate short-circuit, concurrent write retries, branch races,
  retry exhaustion, feedback comment updates.
- **API** - anonymous submissions, rate limiting, invalid/oversized requests, malicious
  filenames, malformed JSON, CORS, upstream error mapping.
- **Runtime** - a full end-to-end run through the real container with mock OpenCode and the
  dry-run GitHub client.

Automated tests never create real Pull Requests and never call real AI providers.

---

## Future training dataset

The database is deliberately shaped to become a training dataset later:

```text
audio file (held by the submitter)
        ↓
SHA-256 id  ← known to the database
        ↓
known style (+ substyles, tags, diagnostics)
        ↓
(future) model training / fine-tuning pipeline
```

Because every entry links a deterministic content hash to a maintainer-reviewed label,
submitters can later map their original audio back to labels. **Model training is not part of
this application** - the initial system focuses on OpenCode classification, known-style
validation and public Pull Requests. Once enough high-quality classifications accumulate, a
separate pipeline can consume `music.json` without changing this codebase.
