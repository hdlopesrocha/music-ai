import type { LyricSegment } from '@/models/music'

function pad(value: number, size = 2): string {
  return String(Math.floor(value)).padStart(size, '0')
}

/** Formats seconds as SRT time `HH:MM:SS,mmm`. */
export function formatSrtTime(seconds: number): string {
  const clamped = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const hours = Math.floor(clamped / 3600)
  const minutes = Math.floor((clamped % 3600) / 60)
  const secs = Math.floor(clamped % 60)
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000)
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`
}

/**
 * Builds an SRT subtitle document from timed lyric segments. Timings come from
 * the analysis excerpt, which starts at the beginning of the track.
 */
export function buildSrt(segments: readonly LyricSegment[]): string {
  return segments
    .filter((segment) => segment.text.trim().length > 0)
    .map((segment, index) => {
      const end = segment.end > segment.start ? segment.end : segment.start + 2
      return `${index + 1}\n${formatSrtTime(segment.start)} --> ${formatSrtTime(end)}\n${segment.text.trim()}\n`
    })
    .join('\n')
}

/** Triggers a browser download of the segments as an .srt file. */
export function downloadSrt(fileName: string, segments: readonly LyricSegment[]): void {
  const content = buildSrt(segments)
  if (content.length === 0) return
  const safeName = fileName.replace(/[\\/:*?"<>|]+/g, '_').replace(/\.[^.]+$/, '') || 'lyrics'
  const blob = new Blob([content], { type: 'application/x-subrip;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeName}.srt`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
