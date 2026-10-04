<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMusicDatabase } from '@/composables/useMusicDatabase'
import PaginationControls from '@/components/PaginationControls.vue'
import TrackTable from '@/components/TrackTable.vue'

type SortKey = 'date-desc' | 'date-asc' | 'artist' | 'title'

const PAGE_SIZE = 12

const route = useRoute()
const router = useRouter()
const { tracks, styles, stats, loading, error } = useMusicDatabase()

const search = ref('')
const styleFilter = ref(typeof route.query.style === 'string' ? route.query.style : '')
const sortKey = ref<SortKey>('date-desc')
const page = ref(1)

watch(
  () => route.query.style,
  (value) => {
    if (typeof value === 'string') {
      styleFilter.value = value
      page.value = 1
    }
  },
)

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()
  const list = tracks.value.filter((track) => {
    if (styleFilter.value && track.style !== styleFilter.value) return false
    if (term.length === 0) return true
    return [track.title, track.artist, track.fileName, track.album]
      .filter((value): value is string => typeof value === 'string')
      .some((value) => value.toLowerCase().includes(term))
  })

  const sorted = [...list]
  switch (sortKey.value) {
    case 'date-asc':
      sorted.sort((a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt))
      break
    case 'artist':
      sorted.sort(
        (a, b) =>
          (a.artist ?? '').localeCompare(b.artist ?? '') ||
          (a.title ?? a.fileName).localeCompare(b.title ?? b.fileName),
      )
      break
    case 'title':
      sorted.sort((a, b) => (a.title ?? a.fileName).localeCompare(b.title ?? b.fileName))
      break
    case 'date-desc':
    default:
      sorted.sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt))
  }
  return sorted
})

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))

watch(pageCount, (count) => {
  if (page.value > count) page.value = count
})

const paged = computed(() =>
  filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
)

function clearFilters(): void {
  search.value = ''
  styleFilter.value = ''
  page.value = 1
  if (route.query.style) void router.replace({ name: 'database' })
}

const hasFilters = computed(() => search.value.trim().length > 0 || styleFilter.value.length > 0)
</script>

<template>
  <div class="page">
    <header class="section">
      <h1 class="page-title">Public database</h1>
      <p class="page-subtitle">
        {{ stats.totalTracks }} classified track(s) across {{ stats.knownStyles }} known styles.
        Data lives in <code>data/music.json</code> and updates when Pull Requests are merged.
      </p>
    </header>

    <p v-if="error" class="banner banner--danger">{{ error }}</p>
    <p v-else-if="loading" class="empty-state">Loading tracks...</p>

    <template v-else>
      <div class="toolbar">
        <label class="field">
          <span class="field__label">Search</span>
          <input
            v-model="search"
            class="input"
            type="search"
            placeholder="Title, artist, album or file name"
            @input="page = 1"
          />
        </label>
        <label class="field">
          <span class="field__label">Style</span>
          <select v-model="styleFilter" class="select" @change="page = 1">
            <option value="">All styles</option>
            <option v-for="style in styles" :key="style" :value="style">{{ style }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">Sort</span>
          <select v-model="sortKey" class="select" @change="page = 1">
            <option value="date-desc">Newest first</option>
            <option value="date-asc">Oldest first</option>
            <option value="artist">Artist</option>
            <option value="title">Title</option>
          </select>
        </label>
      </div>

      <div class="results-meta">
        <span class="faint">{{ filtered.length }} result(s)</span>
        <button v-if="hasFilters" type="button" class="link-button" @click="clearFilters">
          Clear filters
        </button>
      </div>

      <TrackTable v-if="paged.length > 0" :tracks="paged" />
      <div v-else class="empty-state">
        <p>No tracks match your filters.</p>
        <p v-if="stats.totalTracks === 0" class="muted">
          The database is empty. Analyze a file to create the first classification.
        </p>
      </div>

      <PaginationControls :page="page" :page-count="pageCount" @update:page="page = $event" />
    </template>
  </div>
</template>

<style scoped>
.results-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.link-button {
  background: none;
  border: none;
  color: var(--color-accent);
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0;
}

.link-button:hover {
  text-decoration: underline;
}

.page code {
  background: var(--color-bg-soft);
  border: 1px solid var(--color-border);
  border-radius: 0.3rem;
  padding: 0.05rem 0.35rem;
  font-size: 0.82rem;
}
</style>
