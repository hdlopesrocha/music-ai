import type { StyleCount, Track, TrackStats } from '@/models/music'

export function computeTrackStats(tracks: readonly Track[], knownStyles: number): TrackStats {
  const counts = new Map<string, number>()
  let recentlyAddedAt: string | null = null

  for (const track of tracks) {
    counts.set(track.style, (counts.get(track.style) ?? 0) + 1)
    if (recentlyAddedAt === null || Date.parse(track.detectedAt) > Date.parse(recentlyAddedAt)) {
      recentlyAddedAt = track.detectedAt
    }
  }

  const styleCounts: StyleCount[] = [...counts.entries()]
    .map(([style, count]) => ({ style, count }))
    .sort((a, b) => b.count - a.count || a.style.localeCompare(b.style))

  return {
    totalTracks: tracks.length,
    knownStyles,
    mostPopularStyle: styleCounts[0] ?? null,
    recentlyAddedAt,
    styleCounts,
  }
}

export function recentTracks(tracks: readonly Track[], limit: number): Track[] {
  return [...tracks]
    .sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt))
    .slice(0, limit)
}
