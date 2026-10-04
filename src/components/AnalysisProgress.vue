<script setup lang="ts">
import type { StageState } from '@/composables/useAnalysis'

defineProps<{
  stages: ReadonlyArray<{ key: string; label: string; state: StageState }>
}>()
</script>

<template>
  <ol class="progress">
    <li
      v-for="stage in stages"
      :key="stage.key"
      class="progress__item"
      :class="`progress__item--${stage.state}`"
    >
      <span class="progress__marker" aria-hidden="true">
        <template v-if="stage.state === 'done'">&#10003;</template>
        <template v-else-if="stage.state === 'active'"><span class="spinner"></span></template>
      </span>
      <span class="progress__label">{{ stage.label }}</span>
    </li>
  </ol>
</template>

<style scoped>
.progress {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}

.progress__item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--color-text-faint);
  font-size: 0.95rem;
}

.progress__item--done {
  color: var(--color-text-muted);
}

.progress__item--active {
  color: var(--color-text);
  font-weight: 600;
}

.progress__marker {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border-strong);
  font-size: 0.8rem;
  flex-shrink: 0;
}

.progress__item--done .progress__marker {
  border-color: var(--color-success);
  color: var(--color-success);
}

.progress__item--active .progress__marker {
  border-color: var(--color-accent);
}

.spinner {
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
  border-top-color: var(--color-accent);
  animation: spin 0.8s linear infinite;
  display: inline-block;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
