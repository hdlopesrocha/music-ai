<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useMusicDatabase } from '@/composables/useMusicDatabase'
import StyleDistribution from '@/components/StyleDistribution.vue'
import StyleBadge from '@/components/StyleBadge.vue'

const { styles, stats, loading, error } = useMusicDatabase()

const countByStyle = computed(
  () => new Map(stats.value.styleCounts.map((entry) => [entry.style, entry.count])),
)

const entries = computed(() =>
  styles.value.map((style) => ({ style, count: countByStyle.value.get(style) ?? 0 })),
)

const usedStyles = computed(() => entries.value.filter((entry) => entry.count > 0))
const maxCount = computed(() => Math.max(1, ...entries.value.map((entry) => entry.count)))

function width(count: number): string {
  return `${Math.max(2, Math.round((count / maxCount.value) * 100))}%`
}
</script>

<template>
  <div class="page">
    <header class="section">
      <h1 class="page-title">Known styles</h1>
      <p class="page-subtitle">
        OpenCode may only choose from this list. Unknown styles are rejected - the AI
        <strong>cannot</strong> add new styles by itself. Maintainers extend
        <code>data/styles.json</code> through normal Pull Requests.
      </p>
    </header>

    <p v-if="error" class="banner banner--danger">{{ error }}</p>
    <p v-else-if="loading" class="empty-state">Loading styles...</p>

    <template v-else>
      <section v-if="usedStyles.length > 0" class="section card">
        <h2 class="section__title">Distribution of classified tracks</h2>
        <StyleDistribution :entries="usedStyles" />
      </section>

      <section class="grid style-grid">
        <article v-for="entry in entries" :key="entry.style" class="style-card card">
          <div class="style-card__header">
            <StyleBadge :style="entry.style" />
            <span class="style-card__count">{{ entry.count }}</span>
          </div>
          <div class="style-card__track">
            <span class="style-card__bar" :style="{ width: width(entry.count) }"></span>
          </div>
          <RouterLink
            v-if="entry.count > 0"
            :to="{ name: 'database', query: { style: entry.style } }"
            class="faint"
          >
            Browse {{ entry.count }} track(s)
          </RouterLink>
          <span v-else class="faint">No tracks yet</span>
        </article>
      </section>
    </template>
  </div>
</template>

<style scoped>
.style-grid {
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}

.style-card {
  display: grid;
  gap: 0.6rem;
  padding: 1rem 1.1rem;
}

.style-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.style-card__count {
  font-size: 1.1rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.style-card__track {
  height: 0.45rem;
  border-radius: 999px;
  background: var(--color-surface-hover);
  overflow: hidden;
}

.style-card__bar {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--color-accent), var(--color-accent-strong));
}

.page code {
  background: var(--color-bg-soft);
  border: 1px solid var(--color-border);
  border-radius: 0.3rem;
  padding: 0.05rem 0.35rem;
  font-size: 0.82rem;
}
</style>
