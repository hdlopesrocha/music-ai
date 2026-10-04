<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import LyricsPanel from '@/components/LyricsPanel.vue'
import SongMatchFeedback from '@/components/SongMatchFeedback.vue'
import StyleBadge from '@/components/StyleBadge.vue'
import { useAnalysis } from '@/composables/useAnalysis'
import { repositoryFileUrl } from '@/services/database'
import { formatDuration, formatPercent } from '@/utils/format'

const { state, loadPersistedSession, resetAnalysis } = useAnalysis()

onMounted(() => {
  loadPersistedSession()
})

const response = computed(() => state.response)
const track = computed(() => response.value?.track ?? null)
const classification = computed(() => response.value?.classification ?? null)
const pullRequest = computed(() => response.value?.pullRequest ?? null)
const commit = computed(() => response.value?.commit ?? null)
const feedbackToken = computed(() => response.value?.feedbackToken ?? null)

const created = computed(() =>
  Boolean(
    response.value?.success && !response.value.existing && (pullRequest.value || commit.value),
  ),
)
const existing = computed(() => Boolean(response.value?.success && response.value.existing))
const unknownStyle = computed(() =>
  Boolean(response.value && !response.value.success && response.value.reason === 'UNKNOWN_STYLE'),
)
const lowConfidence = computed(() =>
  Boolean(response.value && !response.value.success && response.value.reason === 'LOW_CONFIDENCE'),
)

const confidence = computed(
  () => classification.value?.confidence ?? track.value?.confidence ?? null,
)

const detectedStyle = computed(
  () => classification.value?.style ?? track.value?.style ?? response.value?.style ?? null,
)

const musicJsonUrl = computed(() => repositoryFileUrl('data/music.json'))
</script>

<template>
  <div class="page">
    <template v-if="!response">
      <header class="section">
        <h1 class="page-title">No result yet</h1>
        <p class="page-subtitle">Analyze a music file to see its classification here.</p>
      </header>
      <RouterLink to="/analyze" class="button button--primary">Choose Music</RouterLink>
    </template>

    <template v-else>
      <section v-if="created" class="banner banner--success">
        <h1 class="banner__title">Music analyzed successfully.</h1>
        <p v-if="commit" class="muted">
          The classification was committed directly to
          <code>{{ commit.branch }}</code
          >. The public database updates when the deployment finishes.
        </p>
        <p v-else class="muted">
          A public Pull Request was created. A maintainer will review and merge it; the database
          updates automatically afterwards.
        </p>
      </section>

      <section v-else-if="existing" class="banner banner--warning">
        <h1 class="banner__title">This track has already been classified.</h1>
        <p class="muted">
          The SHA-256 identifier already exists in the database, so no new Pull Request was created.
        </p>
      </section>

      <section v-else-if="unknownStyle" class="banner banner--warning">
        <h1 class="banner__title">Music analyzed.</h1>
        <p class="muted">The AI detected:</p>
        <p class="detected">{{ response.style }}</p>
        <p class="muted">
          This style is not currently supported by the database. No Pull Request was created.
        </p>
      </section>

      <section v-else-if="lowConfidence" class="banner banner--warning">
        <h1 class="banner__title">Not confident enough</h1>
        <p class="muted">The AI could not classify this track confidently enough.</p>
        <p class="detected">
          Confidence: {{ formatPercent(response.confidence) }}
          <span class="faint"> (threshold {{ formatPercent(response.threshold) }}) </span>
        </p>
        <p class="muted">No Pull Request was created.</p>
      </section>

      <section v-else class="banner banner--danger">
        <h1 class="banner__title">Submission failed</h1>
        <p class="muted">
          {{ response.message ?? 'An unexpected error occurred. Please try again.' }}
        </p>
      </section>

      <section v-if="detectedStyle || confidence !== null" class="card summary">
        <div class="summary__main">
          <div>
            <span class="faint">Detected style</span>
            <p class="summary__style">
              <StyleBadge v-if="detectedStyle" :style="detectedStyle" size="lg" />
              <span v-else>--</span>
            </p>
          </div>
          <div>
            <span class="faint">Confidence</span>
            <p class="summary__confidence">{{ formatPercent(confidence) }}</p>
          </div>
          <div v-if="track?.title || track?.fileName || classification?.songMatch">
            <span class="faint">Track</span>
            <p class="summary__track">
              {{ track?.title ?? classification?.songMatch?.title ?? track?.fileName }}
            </p>
            <p v-if="track?.artist || classification?.songMatch?.artist" class="faint">
              {{ track?.artist ?? classification?.songMatch?.artist }}
            </p>
          </div>
        </div>

        <ul v-if="classification?.substyles.length" class="tag-list">
          <li v-for="substyle in classification.substyles" :key="substyle" class="tag">
            {{ substyle }}
          </li>
        </ul>
        <ul v-if="classification?.tags.length" class="tag-list">
          <li v-for="tag in classification.tags" :key="tag" class="tag">{{ tag }}</li>
        </ul>

        <dl v-if="classification?.diagnostics" class="details">
          <template v-if="classification.diagnostics.bpm !== undefined">
            <dt>BPM</dt>
            <dd>{{ classification.diagnostics.bpm }}</dd>
          </template>
          <template v-if="classification.diagnostics.key">
            <dt>Key</dt>
            <dd>{{ classification.diagnostics.key }}</dd>
          </template>
          <template v-if="classification.diagnostics.duration !== undefined">
            <dt>Duration</dt>
            <dd>{{ formatDuration(classification.diagnostics.duration) }}</dd>
          </template>
          <template v-if="classification.diagnostics.energy !== undefined">
            <dt>Energy</dt>
            <dd>{{ classification.diagnostics.energy }}</dd>
          </template>
          <template v-if="classification.diagnostics.instrumentation?.length">
            <dt>Instrumentation</dt>
            <dd>{{ classification.diagnostics.instrumentation.join(', ') }}</dd>
          </template>
        </dl>
      </section>

      <LyricsPanel
        v-if="classification"
        :lyrics="classification.lyrics ?? ''"
        :language="classification.lyricsLanguage"
        :instrumental="classification.instrumental"
        :segments="classification.lyricsSegments ?? []"
        :file-name="track?.title ?? track?.fileName ?? 'lyrics'"
      />

      <section v-if="pullRequest" class="card pr">
        <div>
          <span class="faint">Public Pull Request</span>
          <p class="pr__number">#{{ pullRequest.number }}</p>
        </div>
        <a
          class="button button--primary"
          :href="pullRequest.url"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Pull Request
        </a>
      </section>

      <section v-if="commit" class="card pr">
        <div>
          <span class="faint">Committed directly</span>
          <p class="pr__number">{{ commit.sha ? commit.sha.slice(0, 7) : 'commit' }}</p>
          <span class="faint">branch: {{ commit.branch }}</span>
        </div>
        <a
          class="button button--primary"
          :href="commit.url"
          target="_blank"
          rel="noopener noreferrer"
        >
          View commit
        </a>
      </section>

      <SongMatchFeedback
        v-if="created && track && pullRequest && feedbackToken"
        :track="track"
        :pull-request="pullRequest"
        :feedback-token="feedbackToken"
      />

      <section v-if="existing && musicJsonUrl" class="card">
        <p class="muted">The existing entry is part of the public dataset.</p>
        <a class="button" :href="musicJsonUrl" target="_blank" rel="noopener noreferrer">
          View the database file
        </a>
      </section>

      <div class="actions">
        <RouterLink to="/analyze" class="button button--primary">Analyze another file</RouterLink>
        <RouterLink to="/database" class="button">Browse database</RouterLink>
        <button type="button" class="button" @click="resetAnalysis">Start over</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.detected {
  margin: 0.2rem 0;
  font-size: 1.4rem;
  font-weight: 650;
}

.summary {
  display: grid;
  gap: 1rem;
}

.summary__main {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
}

.summary__style {
  margin: 0.35rem 0 0;
}

.summary__confidence {
  margin: 0.35rem 0 0;
  font-size: 1.4rem;
  font-weight: 650;
}

.summary__track {
  margin: 0.35rem 0 0;
  font-weight: 600;
}

.pr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.pr__number {
  margin: 0.15rem 0 0;
  font-size: 1.6rem;
  font-weight: 700;
}

.actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}
</style>
