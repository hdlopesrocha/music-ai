import { computed, reactive } from 'vue'
import {
  ApiRequestError,
  fetchAnalysisOptions,
  submitMusic,
  type AnalysisOptionsResponse,
  type SubmissionResponse,
} from '@/services/api'
import {
  isSupportedAudioFile,
  readClientMetadata,
  type ClientMetadata,
} from '@/services/music/metadata'
import { sha256Hex } from '@/services/music/hash'

export type AnalysisStatus = 'idle' | 'ready' | 'processing' | 'success' | 'rejected' | 'error'
export type StageState = 'done' | 'active' | 'pending'

export interface AnalysisStage {
  key: string
  label: string
}

export const ANALYSIS_STAGES: readonly AnalysisStage[] = [
  { key: 'reading', label: 'Reading audio...' },
  { key: 'metadata', label: 'Extracting metadata...' },
  { key: 'preparing', label: 'Preparing OpenCode analysis...' },
  { key: 'analyzing', label: 'Analyzing music...' },
  { key: 'validating', label: 'Validating detected style...' },
  { key: 'database', label: 'Checking database...' },
  { key: 'publish', label: 'Publishing to the database...' },
]

const STAGE_TICK_MS = 1400
const STORAGE_KEY = 'ai-music-db:last-session'
const MODEL_STORAGE_KEY = 'ai-music-db:model'
const CONTEXT_STORAGE_KEY = 'ai-music-db:context-examples'

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // storage may be unavailable (private mode); selection still works in memory
  }
}

export interface PersistedSession {
  response: SubmissionResponse
  fileName: string
  metadata: ClientMetadata | null
  sha256: string | null
  savedAt: string
}

interface AnalysisState {
  status: AnalysisStatus
  file: File | null
  metadata: ClientMetadata | null
  sha256: string | null
  stageIndex: number
  response: SubmissionResponse | null
  errorMessage: string | null
  analysisOptions: AnalysisOptionsResponse | null
  selectedModel: string | null
  contextExamples: number | null
}

const state = reactive<AnalysisState>({
  status: 'idle',
  file: null,
  metadata: null,
  sha256: null,
  stageIndex: 0,
  response: null,
  errorMessage: null,
  analysisOptions: null,
  selectedModel: readStored(MODEL_STORAGE_KEY),
  contextExamples: null,
})

let ticker: number | null = null

function stopTicker(): void {
  if (ticker !== null) {
    window.clearInterval(ticker)
    ticker = null
  }
}

function startTicker(): void {
  stopTicker()
  ticker = window.setInterval(() => {
    if (state.stageIndex < ANALYSIS_STAGES.length - 1) {
      state.stageIndex += 1
    }
  }, STAGE_TICK_MS)
}

function persistSession(): void {
  if (!state.response) return
  try {
    const session: PersistedSession = {
      response: state.response,
      fileName: state.metadata?.fileName ?? state.file?.name ?? 'unknown',
      metadata: state.metadata,
      sha256: state.sha256,
      savedAt: new Date().toISOString(),
    }
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // storage may be unavailable (private mode); the result still renders live
  }
}

export function loadPersistedSession(): void {
  if (state.response) return
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as PersistedSession
    if (!parsed.response) return
    state.response = parsed.response
    state.metadata = parsed.metadata
    state.sha256 = parsed.sha256
    state.status = parsed.response.success ? 'success' : 'rejected'
    state.stageIndex = parsed.response.success ? (parsed.response.existing ? 6 : 7) : 5
  } catch {
    // ignore corrupt session data
  }
}

export function clearPersistedSession(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export async function selectFile(file: File): Promise<void> {
  stopTicker()
  state.errorMessage = null
  state.response = null
  state.stageIndex = 0

  if (!isSupportedAudioFile(file)) {
    state.status = 'error'
    state.file = null
    state.metadata = null
    state.sha256 = null
    state.errorMessage = `Unsupported file type. Supported formats: mp3, wav, flac, ogg, m4a, aac, opus.`
    return
  }

  state.file = file
  state.status = 'ready'
  state.metadata = {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
  }
  state.sha256 = null

  const [metadata, hash] = await Promise.all([
    readClientMetadata(file),
    sha256Hex(file).catch(() => null),
  ])

  if (state.file !== file) return
  state.metadata = metadata
  state.sha256 = hash
}

export async function startAnalysis(): Promise<void> {
  const file = state.file
  if (!file || state.status === 'processing') return

  state.status = 'processing'
  state.errorMessage = null
  state.response = null
  state.stageIndex = 0
  startTicker()

  try {
    const response = await submitMusic(file, {
      ...(state.selectedModel ? { model: state.selectedModel } : {}),
      ...(state.contextExamples !== null ? { contextExamples: state.contextExamples } : {}),
    })
    stopTicker()
    state.response = response

    if (response.success) {
      state.status = 'success'
      state.stageIndex = response.existing ? 6 : ANALYSIS_STAGES.length
    } else {
      state.status = 'rejected'
      state.stageIndex = 5
    }
  } catch (error) {
    stopTicker()
    state.status = 'error'
    state.stageIndex = Math.min(state.stageIndex, ANALYSIS_STAGES.length - 1)
    state.errorMessage =
      error instanceof ApiRequestError
        ? error.message
        : 'Could not reach the analysis service. Please check your connection and try again.'
  } finally {
    persistSession()
  }
}

export async function loadAnalysisOptions(): Promise<void> {
  const options = await fetchAnalysisOptions()
  if (!options) return
  state.analysisOptions = options

  const storedModel = readStored(MODEL_STORAGE_KEY)
  if (
    storedModel &&
    options.allowOverride &&
    options.models.some((model) => model.id === storedModel)
  ) {
    state.selectedModel = storedModel
  } else if (storedModel && !options.allowOverride) {
    state.selectedModel = null
  }

  const storedContext = Number.parseInt(readStored(CONTEXT_STORAGE_KEY) ?? '', 10)
  if (
    Number.isFinite(storedContext) &&
    storedContext >= 0 &&
    storedContext <= options.contextExamples.max
  ) {
    state.contextExamples = storedContext
  }
}

export function setSelectedModel(model: string | null): void {
  state.selectedModel = model
  writeStored(MODEL_STORAGE_KEY, model)
}

export function setContextExamples(count: number | null): void {
  state.contextExamples = count
  writeStored(CONTEXT_STORAGE_KEY, count === null ? null : String(count))
}

export function resetAnalysis(): void {
  stopTicker()
  state.status = 'idle'
  state.file = null
  state.metadata = null
  state.sha256 = null
  state.stageIndex = 0
  state.response = null
  state.errorMessage = null
  clearPersistedSession()
}

export function useAnalysis() {
  const stages = computed(() =>
    ANALYSIS_STAGES.map((stage, index) => ({
      ...stage,
      state: (index < state.stageIndex
        ? 'done'
        : index === state.stageIndex && state.status === 'processing'
          ? 'active'
          : 'pending') as StageState,
    })),
  )

  const isProcessing = computed(() => state.status === 'processing')

  return {
    state,
    stages,
    isProcessing,
    selectFile,
    startAnalysis,
    resetAnalysis,
    loadPersistedSession,
    clearPersistedSession,
    loadAnalysisOptions,
    setSelectedModel,
    setContextExamples,
  }
}
