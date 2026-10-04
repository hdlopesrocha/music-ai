<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useMusicDatabase } from '@/composables/useMusicDatabase'
import StatCard from '@/components/StatCard.vue'
import StyleDistribution from '@/components/StyleDistribution.vue'
import TrackTable from '@/components/TrackTable.vue'
import { formatDate } from '@/utils/format'
import { recentTracks } from '@/utils/stats'

const { tracks, styles, stats, loading, error } = useMusicDatabase()
const router = useRouter()

const recent = computed(() => recentTracks(tracks.value, 6))
const topStyles = computed(() => stats.value.styleCounts.slice(0, 10))
const recentlyAdded = computed(() => formatDate(stats.value.recentlyAddedAt))

function openStyle(style: string): void {
  void router.push({ name: 'database', query: { style } })
}
</script>

<template>
  <div class="page">
    <section class="hero">
      <p class="hero__eyebrow">Open, public, community-reviewed</p>
      <h1 class="hero__title">AI Music Style Database</h1>
      <p class="hero__subtitle">
        Analyze a music file using AI and contribute its classification to the public database.
        Every accepted track becomes a transparent, reviewable GitHub Pull Request.
      </p>
      <div class="hero__actions">
        <RouterLink to="/analyze" class="button button--primary button--large"
          >Choose Music</RouterLink
        >
        <RouterLink to="/database" class="button button--large">Browse database</RouterLink>
      </div>
      <p class="hero__note">
        No GitHub account required. The audio file is analyzed temporarily and never uploaded to the
        repository.
      </p>
    </section>

    <p v-if="error" class="banner banner--danger">
      <strong class="banner__title">Database unavailable</strong>
      <span class="muted">{{ error }}</span>
    </p>

    <section v-else-if="loading" class="empty-state">Loading the public database...</section>

    <template v-else>
      <section class="grid grid--stats">
        <StatCard label="Total tracks" :value="stats.totalTracks" />
        <StatCard label="Known styles" :value="styles.length" />
        <StatCard
          label="Most popular style"
          :value="stats.mostPopularStyle?.style ?? '--'"
          :hint="stats.mostPopularStyle ? `${stats.mostPopularStyle.count} track(s)` : undefined"
        />
        <StatCard label="Recently added" :value="recentlyAdded" />
      </section>

      <section class="grid grid--split">
        <div class="section card">
          <div class="section__header">
            <h2 class="section__title">Style distribution</h2>
            <RouterLink to="/styles" class="faint">All styles</RouterLink>
          </div>
          <StyleDistribution
            v-if="topStyles.length > 0"
            :entries="topStyles"
            clickable
            @select="openStyle"
          />
          <p v-else class="muted">No tracks yet. Be the first to submit a classification.</p>
        </div>

        <div class="section card">
          <div class="section__header">
            <h2 class="section__title">Recently classified</h2>
            <RouterLink to="/database" class="faint">Full database</RouterLink>
          </div>
          <ul v-if="recent.length > 0" class="recent">
            <li v-for="track in recent" :key="track.id" class="recent__item">
              <span class="recent__title">{{ track.title ?? track.fileName }}</span>
              <span class="recent__meta">
                {{ track.artist ?? 'Unknown artist' }} &middot; {{ track.style }}
              </span>
            </li>
          </ul>
          <p v-else class="muted">Nothing here yet.</p>
        </div>
      </section>

      <section v-if="recent.length > 0" class="section">
        <div class="section__header">
          <h2 class="section__title">Latest additions</h2>
        </div>
        <TrackTable :tracks="recent" />
      </section>
    </template>

    <section class="section how">
      <h2 class="section__title">How it works</h2>
      <ol class="how__steps">
        <li><strong>Select a file.</strong> Your browser extracts metadata and a content hash.</li>
        <li>
          <strong>OpenCode analyzes it.</strong> The AI proposes a style using only the known styles
          in <code>styles.json</code>, and transcribes vocals to identify the song.
        </li>
        <li>
          <strong>The application validates everything.</strong> Unknown styles and low-confidence
          results are rejected. MusicBrainz verifies any song match.
        </li>
        <li>
          <strong>A public Pull Request is opened.</strong> Maintainers review it and merge it into
          the database - the AI never writes to the repository itself.
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.hero {
  padding: 1.5rem 0 0.5rem;
  display: grid;
  gap: 0.9rem;
  justify-items: start;
}

.hero__eyebrow {
  margin: 0;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--color-accent);
  font-weight: 600;
}

.hero__title {
  margin: 0;
  font-size: clamp(2rem, 5vw, 3rem);
}

.hero__subtitle {
  margin: 0;
  max-width: 60ch;
  color: var(--color-text-muted);
  font-size: 1.05rem;
}

.hero__actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-top: 0.4rem;
}

.hero__note {
  margin: 0;
  color: var(--color-text-faint);
  font-size: 0.85rem;
}

.recent {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.65rem;
}

.recent__item {
  display: grid;
  gap: 0.1rem;
  padding-bottom: 0.65rem;
  border-bottom: 1px solid var(--color-border);
}

.recent__item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.recent__title {
  font-weight: 600;
}

.recent__meta {
  font-size: 0.82rem;
  color: var(--color-text-faint);
}

.how__steps {
  margin: 0;
  padding-left: 1.25rem;
  display: grid;
  gap: 0.6rem;
  color: var(--color-text-muted);
}

.how__steps strong {
  color: var(--color-text);
}

.how__steps code {
  background: var(--color-bg-soft);
  border: 1px solid var(--color-border);
  border-radius: 0.3rem;
  padding: 0.05rem 0.35rem;
  font-size: 0.82rem;
}
</style>
