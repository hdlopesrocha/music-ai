<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import AnalysisProgress from '@/components/AnalysisProgress.vue'
import FilePicker from '@/components/FilePicker.vue'
import { useAnalysis } from '@/composables/useAnalysis'
import { formatBytes, formatDuration, truncate } from '@/utils/format'
import { SUPPORTED_EXTENSIONS } from '@/services/music/metadata'
import { isGitHubPagesHost, resolveApiBaseUrl } from '@/services/runtimeConfig'

const {
  state,
  stages,
  selectFile,
  startAnalysis,
  resetAnalysis,
  loadAnalysisOptions,
  setSelectedModel,
  setContextExamples,
} = useAnalysis()
const router = useRouter()

const apiConfigured = ref(true)

const contextChoices = computed(() => {
  const limits = state.analysisOptions?.contextExamples
  if (!limits) return []
  const values = new Set<number>([0, 4, 8, limits.default, limits.max])
  return [...values].filter((value) => value > 0 && value <= limits.max).sort((a, b) => a - b)
})

function onModelChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  setSelectedModel(value.length > 0 ? value : null)
}

function onContextChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  setContextExamples(value.length > 0 ? Number.parseInt(value, 10) : null)
}

onMounted(async () => {
  if (isGitHubPagesHost()) {
    apiConfigured.value = (await resolveApiBaseUrl()).length > 0
  }
  await loadAnalysisOptions()
})

const shortHash = computed(() =>
  state.sha256 ? `${state.sha256.slice(0, 20)}...` : 'computing...',
)

const showPicker = computed(
  () => state.status === 'idle' || (state.status === 'error' && state.file === null),
)

watch(
  () => state.status,
  (status) => {
    if (status === 'success' || status === 'rejected') {
      void router.push({ name: 'result' })
    }
  },
)

async function onFileSelected(file: File): Promise<void> {
  await selectFile(file)
}

function changeFile(): void {
  resetAnalysis()
}

function analyzeAgain(): void {
  resetAnalysis()
}
</script>

<template>
  <div class="page">
    <header class="section">
      <h1 class="page-title">Analyze a music file</h1>
      <p class="page-subtitle">
        Select a track. OpenCode classifies its style against the known styles, and the result is
        validated before a public Pull Request is opened.
      </p>
    </header>

    <section v-if="!apiConfigured" class="banner banner--warning">
      <strong class="banner__title">Submissions are disabled on this deployment</strong>
      <span class="muted">
        No Submission API is configured yet, and GitHub Pages cannot process uploads by itself. You
        can still browse the public database and styles. A maintainer can enable submissions by
        deploying the API and putting its URL in <code>config.json</code>.
      </span>
    </section>

    <FilePicker v-if="showPicker" @file="onFileSelected" />

    <p v-if="showPicker && state.errorMessage" class="banner banner--danger">
      {{ state.errorMessage }}
    </p>

    <template v-if="state.metadata && !showPicker">
      <section class="card selected">
        <div class="selected__header">
          <div>
            <h2 class="selected__name">{{ state.metadata.fileName }}</h2>
            <p class="faint">Selected file</p>
          </div>
          <button
            v-if="state.status !== 'processing'"
            type="button"
            class="button"
            @click="changeFile"
          >
            Choose another
          </button>
        </div>
        <dl class="details">
          <template v-if="state.metadata.title">
            <dt>Title</dt>
            <dd>{{ state.metadata.title }}</dd>
          </template>
          <template v-if="state.metadata.artist">
            <dt>Artist</dt>
            <dd>{{ state.metadata.artist }}</dd>
          </template>
          <dt>Duration</dt>
          <dd>{{ formatDuration(state.metadata.duration) }}</dd>
          <dt>Size</dt>
          <dd>{{ formatBytes(state.metadata.size) }}</dd>
          <dt>SHA-256</dt>
          <dd class="mono">{{ shortHash }}</dd>
        </dl>

        <div v-if="state.analysisOptions" class="analysis-settings">
          <label class="field">
            <span class="field__label">Model</span>
            <select
              v-if="state.analysisOptions.allowOverride && state.analysisOptions.models.length > 0"
              class="select"
              :value="state.selectedModel ?? ''"
              @change="onModelChange"
            >
              <option value="">Server default ({{ state.analysisOptions.defaultModel }})</option>
              <option
                v-for="model in state.analysisOptions.models"
                :key="model.id"
                :value="model.id"
              >
                {{ model.label }}{{ model.id !== model.label ? ` (${model.id})` : '' }}
              </option>
            </select>
            <span v-else class="faint">{{ state.analysisOptions.defaultModel }}</span>
          </label>
          <label class="field">
            <span class="field__label">Context size</span>
            <select
              class="select"
              :value="state.contextExamples === null ? '' : String(state.contextExamples)"
              @change="onContextChange"
            >
              <option value="">
                Default ({{ state.analysisOptions.contextExamples.default }} examples)
              </option>
              <option value="0">No examples (fastest)</option>
              <option v-for="count in contextChoices" :key="count" :value="String(count)">
                {{ count }} examples
              </option>
            </select>
          </label>
          <p class="faint analysis-settings__note">
            Only models that support audio analysis are listed. Context size controls how many
            existing classifications are sent to the model as examples.
          </p>
        </div>

        <div v-if="state.status === 'ready' || state.status === 'error'" class="selected__actions">
          <button
            type="button"
            class="button button--primary button--large"
            :disabled="state.status === 'error'"
            @click="startAnalysis"
          >
            Analyze Music
          </button>
        </div>
      </section>

      <section v-if="state.status === 'processing'" class="card">
        <h2 class="section__title">Analyzing...</h2>
        <AnalysisProgress :stages="stages" />
      </section>

      <p v-if="state.status === 'error' && state.errorMessage" class="banner banner--danger">
        {{ state.errorMessage }}
      </p>

      <p v-if="state.status === 'success'" class="banner banner--success">
        <strong class="banner__title">Analysis finished</strong>
        <span class="muted">Opening the result...</span>
      </p>
    </template>

    <section v-if="showPicker" class="section card">
      <h2 class="section__title">What happens to my file?</h2>
      <ul class="privacy">
        <li>The audio is used only for analysis and deleted immediately afterwards.</li>
        <li>
          A deterministic SHA-256 identifier of the audio prevents duplicate submissions, even if
          the file is renamed.
        </li>
        <li>
          Only the classification, metadata and a vocal-detected flag are written to the public
          database. Full lyrics are never stored.
        </li>
        <li>Supported formats: {{ SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(', ') }}.</li>
      </ul>
      <p class="faint">
        Prefer the API? Send a raw POST with an <code>X-Music-Filename</code> header to
        <code>/api/submit</code> or <code>/api/analyze</code>.
      </p>
    </section>

    <p v-if="state.status === 'processing'" class="faint">
      Large files and slow models can take a while. Your file:
      {{ truncate(state.metadata?.fileName ?? '', 60) }}
    </p>

    <RouterLink v-if="state.status === 'success'" to="/result" class="button">
      View result
    </RouterLink>
    <button
      v-if="state.status === 'success' || state.status === 'rejected'"
      type="button"
      class="button"
      @click="analyzeAgain"
    >
      Analyze another file
    </button>
  </div>
</template>

<style scoped>
.selected {
  display: grid;
  gap: 1rem;
}

.selected__header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  flex-wrap: wrap;
}

.selected__name {
  margin: 0;
  font-size: 1.2rem;
  overflow-wrap: anywhere;
}

.selected__actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.analysis-settings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.85rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-soft);
}

.analysis-settings__note {
  grid-column: 1 / -1;
  margin: 0;
}

.privacy {
  margin: 0;
  padding-left: 1.2rem;
  display: grid;
  gap: 0.5rem;
  color: var(--color-text-muted);
  font-size: 0.92rem;
}

.privacy code,
.page code {
  background: var(--color-bg-soft);
  border: 1px solid var(--color-border);
  border-radius: 0.3rem;
  padding: 0.05rem 0.35rem;
  font-size: 0.82rem;
}
</style>
