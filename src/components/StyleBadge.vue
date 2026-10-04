<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  style: string
  size?: 'sm' | 'md' | 'lg'
}>()

function hashStyle(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 360
  }
  return hash
}

const colors = computed(() => {
  const hue = hashStyle(props.style)
  return {
    color: `hsl(${hue} 75% 72%)`,
    background: `hsl(${hue} 70% 55% / 0.14)`,
    border: `hsl(${hue} 70% 55% / 0.4)`,
  }
})
</script>

<template>
  <span class="style-badge" :class="`style-badge--${size ?? 'md'}`" :style="colors">
    {{ style }}
  </span>
</template>

<style scoped>
.style-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  border: 1px solid;
  font-size: 0.82rem;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
}

.style-badge--sm {
  font-size: 0.74rem;
  padding: 0.1rem 0.5rem;
}

.style-badge--lg {
  font-size: 1rem;
  padding: 0.35rem 0.9rem;
}
</style>
