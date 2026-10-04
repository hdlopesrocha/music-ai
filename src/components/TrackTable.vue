<script setup lang="ts">
import type { Track } from '@/models/music'
import StyleBadge from '@/components/StyleBadge.vue'
import { formatDate, formatDuration, formatPercent } from '@/utils/format'

defineProps<{
  tracks: readonly Track[]
}>()
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
        <tr v-for="track in tracks" :key="track.id">
          <td>
            <span class="track-table__title">{{ track.title ?? track.fileName }}</span>
            <span v-if="track.title" class="track-table__file">{{ track.fileName }}</span>
            <span v-if="track.song" class="track-table__song">
              Identified: {{ track.song.title }} - {{ track.song.artist }}
            </span>
          </td>
          <td>{{ track.artist ?? '--' }}</td>
          <td>
            <StyleBadge :style="track.style" size="sm" />
          </td>
          <td class="track-table__num">{{ formatPercent(track.confidence) }}</td>
          <td class="track-table__num">{{ formatDuration(track.duration) }}</td>
          <td class="track-table__num">{{ formatDate(track.detectedAt) }}</td>
        </tr>
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

.track-table tbody tr:hover {
  background: var(--color-surface-hover);
}

.track-table__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
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
</style>
