<script setup lang="ts">
import { computed } from 'vue'
import type { StyleCount } from '@/models/music'

const props = defineProps<{
  entries: readonly StyleCount[]
  clickable?: boolean
}>()

const emit = defineEmits<{ (event: 'select', style: string): void }>()

const maxCount = computed(() => Math.max(1, ...props.entries.map((entry) => entry.count)))

function width(count: number): string {
  return `${Math.max(4, Math.round((count / maxCount.value) * 100))}%`
}

function hue(style: string): number {
  let hash = 0
  for (let index = 0; index < style.length; index += 1) {
    hash = (hash * 31 + style.charCodeAt(index)) % 360
  }
  return hash
}
</script>

<template>
  <ul class="distribution">
    <li
      v-for="entry in entries"
      :key="entry.style"
      class="distribution__row"
      :class="{ 'distribution__row--clickable': clickable }"
      :tabindex="clickable ? 0 : undefined"
      @click="clickable && emit('select', entry.style)"
      @keydown.enter="clickable && emit('select', entry.style)"
    >
      <span class="distribution__label">{{ entry.style }}</span>
      <span class="distribution__track">
        <span
          class="distribution__bar"
          :style="{ width: width(entry.count), background: `hsl(${hue(entry.style)} 70% 58%)` }"
        ></span>
      </span>
      <span class="distribution__count">{{ entry.count }}</span>
    </li>
  </ul>
</template>

<style scoped>
.distribution {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.55rem;
}

.distribution__row {
  display: grid;
  grid-template-columns: minmax(6rem, 9rem) 1fr 2.5rem;
  align-items: center;
  gap: 0.75rem;
  border-radius: 0.4rem;
  padding: 0.15rem 0.25rem;
}

.distribution__row--clickable {
  cursor: pointer;
}

.distribution__row--clickable:hover,
.distribution__row--clickable:focus-visible {
  background: var(--color-surface-hover);
  outline: none;
}

.distribution__label {
  font-size: 0.85rem;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.distribution__track {
  height: 0.6rem;
  border-radius: 999px;
  background: var(--color-surface-hover);
  overflow: hidden;
}

.distribution__bar {
  display: block;
  height: 100%;
  border-radius: 999px;
  transition: width 0.3s ease;
}

.distribution__count {
  font-size: 0.82rem;
  color: var(--color-text-muted);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 560px) {
  .distribution__row {
    grid-template-columns: minmax(4.5rem, 6.5rem) 1fr 2rem;
  }
}
</style>
