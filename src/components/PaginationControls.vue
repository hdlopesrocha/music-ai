<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  page: number
  pageCount: number
}>()

const emit = defineEmits<{ (event: 'update:page', page: number): void }>()

const pages = computed(() => {
  const total = props.pageCount
  const current = props.page
  const window: number[] = []
  const start = Math.max(1, Math.min(current - 1, total - 2))
  const end = Math.min(total, start + 2)
  for (let index = start; index <= end; index += 1) window.push(index)
  return window
})

function go(page: number): void {
  if (page < 1 || page > props.pageCount || page === props.page) return
  emit('update:page', page)
}
</script>

<template>
  <nav v-if="pageCount > 1" class="pagination" aria-label="Pagination">
    <button type="button" class="pagination__button" :disabled="page <= 1" @click="go(page - 1)">
      Previous
    </button>
    <button
      v-for="pageNumber in pages"
      :key="pageNumber"
      type="button"
      class="pagination__button"
      :class="{ 'pagination__button--active': pageNumber === page }"
      :aria-current="pageNumber === page ? 'page' : undefined"
      @click="go(pageNumber)"
    >
      {{ pageNumber }}
    </button>
    <button
      type="button"
      class="pagination__button"
      :disabled="page >= pageCount"
      @click="go(page + 1)"
    >
      Next
    </button>
  </nav>
</template>

<style scoped>
.pagination {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 1.25rem;
}

.pagination__button {
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-muted);
  border-radius: 0.5rem;
  padding: 0.4rem 0.75rem;
  font-size: 0.85rem;
  cursor: pointer;
}

.pagination__button:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-text);
}

.pagination__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pagination__button--active {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: #fff;
  font-weight: 600;
}
</style>
