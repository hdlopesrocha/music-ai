<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PullRequestRef, Track } from '@/models/music'
import { ApiRequestError, sendFeedback } from '@/services/api'

const props = defineProps<{
  track: Track
  pullRequest: PullRequestRef
  feedbackToken: string
}>()

type FeedbackState = 'idle' | 'sending' | 'done' | 'error'

const state = ref<FeedbackState>('idle')
const errorMessage = ref<string | null>(null)
const commentUrl = ref<string | null>(null)
const answered = ref<boolean | null>(null)

const song = computed(() => props.track.song ?? null)

async function submit(confirmed: boolean): Promise<void> {
  if (state.value === 'sending' || !song.value) return
  state.value = 'sending'
  errorMessage.value = null
  try {
    const response = await sendFeedback({
      pullRequestNumber: props.pullRequest.number,
      trackId: props.track.id,
      confirmed,
      token: props.feedbackToken,
      song: { title: song.value.title, artist: song.value.artist },
    })
    answered.value = confirmed
    commentUrl.value = response.commentUrl ?? null
    state.value = 'done'
  } catch (error) {
    state.value = 'error'
    errorMessage.value =
      error instanceof ApiRequestError
        ? error.message
        : 'Could not send your feedback. Please try again.'
  }
}
</script>

<template>
  <section v-if="song" class="feedback card">
    <h3 class="feedback__title">Did we identify the right song?</h3>
    <p class="feedback__song">
      <strong>{{ song.title }}</strong> by <strong>{{ song.artist }}</strong>
      <span v-if="song.score !== undefined" class="feedback__score">
        (match score {{ Math.round(song.score) }})
      </span>
    </p>

    <div v-if="state === 'idle' || state === 'error'" class="feedback__actions">
      <button type="button" class="button button--primary" @click="submit(true)">
        Yes, that is correct
      </button>
      <button type="button" class="button" @click="submit(false)">No, that is wrong</button>
    </div>

    <p v-else-if="state === 'sending'" class="feedback__status">Sending your feedback...</p>

    <p v-else class="feedback__status feedback__status--done">
      Thank you! Your feedback was added to the public Pull Request.
      <a v-if="commentUrl" :href="commentUrl" target="_blank" rel="noopener noreferrer">
        View the comment
      </a>
      <span v-else-if="answered !== null">The maintainers can see it on the PR.</span>
    </p>

    <p v-if="state === 'error' && errorMessage" class="feedback__error">{{ errorMessage }}</p>
  </section>
</template>

<style scoped>
.feedback {
  display: grid;
  gap: 0.6rem;
}

.feedback__title {
  margin: 0;
  font-size: 1.05rem;
}

.feedback__song {
  margin: 0;
  color: var(--color-text-muted);
}

.feedback__score {
  color: var(--color-text-faint);
  font-size: 0.82rem;
}

.feedback__actions {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.feedback__status {
  margin: 0;
  color: var(--color-text-muted);
}

.feedback__status--done {
  color: var(--color-success);
}

.feedback__status a {
  color: var(--color-accent);
}

.feedback__error {
  margin: 0;
  color: var(--color-danger);
  font-size: 0.85rem;
}
</style>
