<script setup lang="ts">
import { computed } from 'vue'
import { repositoryUrl } from '@/services/database'

const repo = computed(() => (repositoryUrl.length > 0 ? repositoryUrl : null))
const year = new Date().getFullYear()
</script>

<template>
  <footer class="site-footer">
    <div class="site-footer__inner">
      <p>
        Every accepted classification becomes a public, reviewable Pull Request. Audio files are
        never uploaded to the repository.
      </p>
      <p class="site-footer__meta">
        <span>&copy; {{ year }} AI Music Style Database</span>
        <a v-if="repo" :href="repo" rel="noopener noreferrer" target="_blank">Source repository</a>
      </p>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}

.site-footer__inner {
  max-width: 1100px;
  margin: 0 auto;
  padding: 1.5rem 1.25rem;
  color: var(--color-text-muted);
  font-size: 0.85rem;
  display: grid;
  gap: 0.5rem;
}

.site-footer__meta {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.site-footer a {
  color: var(--color-accent);
  text-decoration: none;
}

.site-footer a:hover {
  text-decoration: underline;
}
</style>
