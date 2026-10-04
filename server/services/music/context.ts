import type { Track } from './database.js'
import type { MusicExample } from '../opencode/types.js'

export interface ContextSelectionOptions {
  readonly maxTotal: number
  readonly perStyle: number
}

/**
 * Selects a small, representative slice of the database as few-shot context.
 *
 * Strategy: keep the most recent entries per style, then interleave styles
 * round-robin so every style is represented before any style gets extras.
 * This keeps prompt size bounded as the database grows.
 */
export function selectContextExamples(
  tracks: readonly Track[],
  options: ContextSelectionOptions,
): MusicExample[] {
  if (options.maxTotal <= 0) return []

  const groups = new Map<string, Track[]>()

  for (const track of tracks) {
    const group = groups.get(track.style)
    if (group) group.push(track)
    else groups.set(track.style, [track])
  }

  const sortedGroups = [...groups.entries()]
    .map(([style, entries]) => ({
      style,
      entries: [...entries].sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt)),
    }))
    .sort((a, b) => a.style.localeCompare(b.style))

  const selected: Track[] = []
  for (let index = 0; index < options.perStyle; index += 1) {
    for (const group of sortedGroups) {
      const track = group.entries[index]
      if (track) selected.push(track)
      if (selected.length >= options.maxTotal) break
    }
    if (selected.length >= options.maxTotal) break
  }

  return selected.map((track) => ({
    fileName: track.fileName,
    style: track.style,
    ...(track.title ? { title: track.title } : {}),
    ...(track.artist ? { artist: track.artist } : {}),
    ...(track.substyles && track.substyles.length > 0 ? { substyles: track.substyles } : {}),
    ...(track.tags && track.tags.length > 0 ? { tags: track.tags } : {}),
  }))
}
