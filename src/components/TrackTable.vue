<script setup lang="ts">
import { ref } from 'vue'
import type { Track } from '@/models/music'
import StyleBadge from '@/components/StyleBadge.vue'
import { formatDate, formatDuration, formatPercent } from '@/utils/format'
import { downloadSrt } from '@/utils/srt'

defineProps<{
  tracks: readonly Track[]
}>()

const expandedId = ref<string | null>(null)

function toggle(track: Track): void {
  expandedId.value = expandedId.value === track.id ? null : track.id
}

function downloadTrackSrt(track: Track): void {
  downloadSrt(track.title ?? track.fileName, track.subtitles ?? [])
}

function subtitlePreview(track: Track): string {
  return (track.subtitles ?? [])
    .map((segment) => segment.text)
    .join('\n')
    .slice(0, 600)
}
</script>

<template>
  <div class="track-table__wrap">
    <table class="track-table">
      <thead>
        <tr>
          <th scope="col">Track</th>
          <th scope="col">Artist</th>
          <th scope="col">Style</th>
          <th scope="col" class="track-table__num">Confidence</th>
          <th scope="col" class="track-table__num">Duration</th>
          <th scope="col" class="track-table__num">Added</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="track in tracks" :key="track.id">
          <tr :class="{ 'track-table__row--open': expandedId === track.id }">
            <td>
              <button
                type="button"
                class="track-table__toggle"
                :aria-expanded="expandedId === track.id"
                @click="toggle(track)"
              >
                <span class="track-table__chevron" aria-hidden="true">
                  {{ expandedId === track.id ? '\u25be' : '\u25b8' }}
                </span>
                <span>
                  <span class="track-table__title">{{ track.title ?? track.fileName }}</span>
                  <span v-if="track.title" class="track-table__file">{{ track.fileName }}</span>
                  <span v-if="track.song" class="track-table__song">
                    Identified: {{ track.song.title }} - {{ track.song.artist }}
                  </span>
                </span>
              </button>
            </td>
            <td>{{ track.artist ?? '--' }}</td>
            <td>
              <StyleBadge :style="track.style" size="sm" />
            </td>
            <td class="track-table__num">{{ formatPercent(track.confidence) }}</td>
            <td class="track-table__num">{{ formatDuration(track.duration) }}</td>
            <td class="track-table__num">{{ formatDate(track.detectedAt) }}</td>
          </tr>

          <tr v-if="expandedId === track.id" class="track-table__details">
            <td colspan="6">
              <div class="track-table__details-grid">
                <dl class="details">
                  <dt>Track ID</dt>
                  <dd class="mono">{{ track.id }}</dd>
                  <dt>File</dt>
                  <dd>{{ track.fileName }}</dd>
                  <template v-if="track.album">
                    <dt>Album</dt>
                    <dd>{{ track.album }}</dd>
                  </template>
                  <template v-if="track.year !== undefined">
                    <dt>Year</dt>
                    <dd>{{ track.year }}</dd>
                  </template>
                  <dt>Duration</dt>
                  <dd>{{ formatDuration(track.duration) }}</dd>
                  <dt>Confidence</dt>
                  <dd>{{ formatPercent(track.confidence, 1) }}</dd>
                  <dt>Detected</dt>
                  <dd>{{ track.detectedAt }}</dd>
                  <dt>Source</dt>
                  <dd>{{ track.source }}</dd>
                  <dt>Vocals</dt>
                  <dd>
                    {{
                      track.hasLyrics
                        ? `lyrics detected${track.lyricsLanguage ? ` (${track.lyricsLanguage})` : ''}`
                        : 'instrumental or no lyrics'
                    }}
                  </dd>
                </dl>

                <div class="track-table__details-side">
                  <template v-if="track.song">
                    <h4 class="track-table__section">Song identification</h4>
                    <dl class="details">
                      <dt>Title</dt>
                      <dd>{{ track.song.title }}</dd>
                      <dt>Artist</dt>
                      <dd>{{ track.song.artist }}</dd>
                      <template v-if="track.song.album">
                        <dt>Album</dt>
                        <dd>{{ track.song.album }}</dd>
                      </template>
                      <template v-if="track.song.year !== undefined">
                        <dt>Year</dt>
                        <dd>{{ track.song.year }}</dd>
                      </template>
                      <dt>Provider</dt>
                      <dd>{{ track.song.provider }}</dd>
                      <template v-if="track.song.score !== undefined">
                        <dt>Match score</dt>
                        <dd>{{ Math.round(track.song.score) }}</dd>
                      </template>
                    </dl>
                  </template>

                  <template v-if="track.diagnostics">
                    <h4 class="track-table__section">Diagnostics</h4>
                    <dl class="details">
                      <template v-if="track.diagnostics.bpm !== undefined">
                        <dt>BPM</dt>
                        <dd>{{ track.diagnostics.bpm }}</dd>
                      </template>
                      <template v-if="track.diagnostics.key">
                        <dt>Key</dt>
                        <dd>{{ track.diagnostics.key }}</dd>
                      </template>
                      <template v-if="track.diagnostics.energy !== undefined">
                        <dt>Energy</dt>
                        <dd>{{ track.diagnostics.energy }}</dd>
                      </template>
                      <template v-if="track.diagnostics.instrumentation?.length">
                        <dt>Instrumentation</dt>
                        <dd>{{ track.diagnostics.instrumentation.join(', ') }}</dd>
                      </template>
                    </dl>
                  </template>
                </div>
              </div>

              <div v-if="track.substyles?.length || track.tags?.length" class="track-table__badges">
                <ul v-if="track.substyles?.length" class="tag-list">
                  <li v-for="substyle in track.substyles" :key="substyle" class="tag">
                    {{ substyle }}
                  </li>
                </ul>
                <ul v-if="track.tags?.length" class="tag-list">
                  <li v-for="tag in track.tags" :key="tag" class="tag">{{ tag }}</li>
                </ul>
              </div>

              <div v-if="track.subtitles?.length" class="track-table__subtitles">
                <div class="track-table__subtitles-header">
                  <h4 class="track-table__section">
                    Subtitles ({{ track.subtitles.length }} lines)
                  </h4>
                  <button type="button" class="button" @click="downloadTrackSrt(track)">
                    Download .srt subtitles
                  </button>
                </div>
                <pre class="track-table__subtitles-text">{{ subtitlePreview(track) }}</pre>
              </div>
              <p v-else-if="track.hasLyrics" class="faint">
                Lyrics were detected but subtitles are not stored for this track.
              </p>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.track-table__wrap {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.track-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
  min-width: 640px;
}

.track-table th {
  text-align: left;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-text-faint);
  padding: 0.8rem 0.9rem;
  border-bottom: 1px solid var(--color-border);
  font-weight: 600;
}

.track-table td {
  padding: 0.75rem 0.9rem;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}

.track-table tbody tr:last-child td {
  border-bottom: none;
}

.track-table tbody tr:hover:not(.track-table__details) {
  background: var(--color-surface-hover);
}

.track-table__row--open {
  background: var(--color-surface-hover);
}

.track-table__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.track-table__toggle {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0;
  text-align: left;
  font: inherit;
}

.track-table__chevron {
  color: var(--color-accent);
  line-height: 1.4;
}

.track-table__title {
  display: block;
  font-weight: 600;
}

.track-table__file {
  display: block;
  font-size: 0.78rem;
  color: var(--color-text-faint);
  margin-top: 0.1rem;
}

.track-table__song {
  display: block;
  font-size: 0.78rem;
  color: var(--color-accent);
  margin-top: 0.2rem;
}

.track-table__details td {
  background: var(--color-bg-soft);
  padding: 1.1rem 1.2rem;
}

.track-table__details-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 1.25rem;
}

.track-table__details-side {
  display: grid;
  gap: 0.75rem;
  align-content: start;
}

.track-table__section {
  margin: 0 0 0.45rem;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-text-faint);
}

.track-table__badges {
  display: grid;
  gap: 0.45rem;
  margin-top: 1rem;
}

.track-table__subtitles {
  margin-top: 1rem;
}

.track-table__subtitles-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.track-table__subtitles-text {
  margin: 0.5rem 0 0;
  max-height: 12rem;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 0.82rem;
  color: var(--color-text-muted);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 0.75rem 0.9rem;
}

@media (max-width: 720px) {
  .track-table__details-grid {
    grid-template-columns: 1fr;
  }
}
</style>
