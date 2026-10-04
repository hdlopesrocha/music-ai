<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <header class="site-header">
    <div class="site-header__inner">
      <RouterLink to="/" class="brand">
        <span class="brand__mark" aria-hidden="true">&#9835;</span>
        <span class="brand__text">AI Music Style Database</span>
      </RouterLink>
      <nav class="site-nav" aria-label="Main navigation">
        <RouterLink to="/analyze">Analyze</RouterLink>
        <RouterLink to="/database">Database</RouterLink>
        <RouterLink to="/styles">Styles</RouterLink>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.site-header {
  position: sticky;
  top: 0;
  z-index: 10;
  backdrop-filter: blur(10px);
  background: color-mix(in srgb, var(--color-bg) 82%, transparent);
  border-bottom: 1px solid var(--color-border);
}

.site-header__inner {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0.85rem 1.25rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  color: var(--color-text);
  text-decoration: none;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.brand__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.6rem;
  background: linear-gradient(135deg, var(--color-accent), var(--color-accent-strong));
  color: #fff;
  font-size: 1.1rem;
}

.site-nav {
  display: flex;
  gap: 1.25rem;
  font-size: 0.95rem;
}

.site-nav a {
  color: var(--color-text-muted);
  text-decoration: none;
  padding: 0.35rem 0;
  border-bottom: 2px solid transparent;
}

.site-nav a:hover {
  color: var(--color-text);
}

.site-nav a.router-link-active {
  color: var(--color-text);
  border-bottom-color: var(--color-accent);
}

@media (max-width: 560px) {
  .brand__text {
    display: none;
  }
}
</style>
