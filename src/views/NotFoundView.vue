<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <div class="page not-found">
    <h1 class="page-title">Page not found</h1>
    <p class="page-subtitle">The page you are looking for does not exist.</p>
    <RouterLink to="/" class="button button--primary">Back to home</RouterLink>
  </div>
</template>

<style scoped>
.not-found {
  text-align: center;
  justify-items: center;
  padding-top: 3rem;
}
</style>
