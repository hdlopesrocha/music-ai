<script setup lang="ts">
import { ref } from 'vue'
import { ACCEPT_ATTRIBUTE, SUPPORTED_EXTENSIONS } from '@/services/music/metadata'

const emit = defineEmits<{ (event: 'file', file: File): void }>()

const input = ref<HTMLInputElement | null>(null)
const dragging = ref(false)

function emitFile(file: File | undefined): void {
  if (file) emit('file', file)
}

function onInput(event: Event): void {
  const target = event.target as HTMLInputElement
  emitFile(target.files?.[0])
  target.value = ''
}

function onDrop(event: DragEvent): void {
  dragging.value = false
  emitFile(event.dataTransfer?.files?.[0])
}

function onDragOver(): void {
  dragging.value = true
}

function onDragLeave(): void {
  dragging.value = false
}
</script>

<template>
  <div
    class="dropzone"
    :class="{ 'dropzone--dragging': dragging }"
    role="button"
    tabindex="0"
    @click="input?.click()"
    @keydown.enter.prevent="input?.click()"
    @keydown.space.prevent="input?.click()"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <span class="dropzone__icon" aria-hidden="true">&#9835;</span>
    <p class="dropzone__title">Choose a music file</p>
    <p class="dropzone__hint">or drag and drop it here</p>
    <p class="dropzone__formats">
      Supported: {{ SUPPORTED_EXTENSIONS.map((extension) => `.${extension}`).join(', ') }}
    </p>
    <input
      ref="input"
      class="visually-hidden"
      type="file"
      :accept="ACCEPT_ATTRIBUTE"
      @change="onInput"
    />
  </div>
</template>

<style scoped>
.dropzone {
  border: 2px dashed var(--color-border-strong);
  border-radius: var(--radius-lg);
  padding: 2.75rem 1.5rem;
  text-align: center;
  cursor: pointer;
  background: var(--color-surface);
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.15s ease;
}

.dropzone:hover,
.dropzone:focus-visible {
  border-color: var(--color-accent);
  outline: none;
}

.dropzone--dragging {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 10%, var(--color-surface));
  transform: scale(1.005);
}

.dropzone__icon {
  font-size: 2rem;
  display: block;
  margin-bottom: 0.5rem;
  color: var(--color-accent);
}

.dropzone__title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
}

.dropzone__hint {
  margin: 0.35rem 0 0;
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.dropzone__formats {
  margin: 1rem 0 0;
  color: var(--color-text-faint);
  font-size: 0.78rem;
  letter-spacing: 0.02em;
}
</style>
