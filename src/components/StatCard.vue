<script setup lang="ts">
defineProps<{
  label: string
  value: string | number
  hint?: string
}>()
</script>

<template>
  <div class="stat-card">
    <span class="stat-card__label">{{ label }}</span>
    <span class="stat-card__value">{{ value }}</span>
    <span v-if="hint" class="stat-card__hint">{{ hint }}</span>
  </div>
</template>

<style scoped>
.stat-card {
  display: grid;
  gap: 0.3rem;
  padding: 1.1rem 1.2rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
}

.stat-card__label {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-faint);
}

.stat-card__value {
  font-size: 1.7rem;
  font-weight: 650;
  line-height: 1.1;
}

.stat-card__hint {
  font-size: 0.82rem;
  color: var(--color-text-muted);
}
</style>
