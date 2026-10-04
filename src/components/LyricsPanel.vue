<script setup lang="ts">
import type { LyricSegment } from '@/models/music'
import { downloadSrt } from '@/utils/srt'

const props = defineProps<{
  lyrics: string
  language?: string | null
  instrumental?: boolean | null
  segments?: readonly LyricSegment[]
  fileName?: string
}>()

function download(): void {
  downloadSrt(props.fileName ?? 'lyrics', props.segments ?? [])
}
</script>

<template>
  <details v-if="lyrics.length > 0" class="lyrics card">
    <summary class="lyrics__summary">
      Transcribed lyrics
      <span v-if="language" class="lyrics__language">{{ language }}</span>
    </summary>
    <pre class="lyrics__text">{{ lyrics }}</pre>
    <div class="lyrics__actions">
      <button
        v-if="segments && segments.length > 0"
        type="button"
        class="button"
        @click.prevent="download"
      >
        Download .srt subtitles
      </button>
      <p class="lyrics__note">
        Transcription is produced transiently for song identification and is never stored in the
        public database.
      </p>
    </div>
  </details>
  <p v-else-if="instrumental" class="lyrics__empty">No vocals detected - instrumental track.</p>
</template>

<style scoped>
.lyrics {
  padding: 0.9rem 1.1rem;
}

.lyrics__summary {
  cursor: pointer;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.lyrics__language {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-accent);
  border: 1px solid color-mix(in srgb, var(--color-accent) 40%, transparent);
  border-radius: 999px;
  padding: 0.05rem 0.5rem;
}

.lyrics__text {
  margin: 0.9rem 0 0.5rem;
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 0.9rem;
  color: var(--color-text-muted);
  line-height: 1.6;
}

.lyrics__actions {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  flex-wrap: wrap;
  margin-top: 0.6rem;
}

.lyrics__note,
.lyrics__empty {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-faint);
}

.lyrics__empty {
  padding: 0.5rem 0;
}
</style>
