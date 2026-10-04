import type { LyricSegment } from '../opencode/types.js'

function pad(value: number, size = 2): string {
  return String(Math.floor(value)).padStart(size, '0')
}

export function formatSrtTime(seconds: number): string {
  const clamped = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const hours = Math.floor(clamped / 3600)
  const minutes = Math.floor((clamped % 3600) / 60)
  const secs = Math.floor(clamped % 60)
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000)
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`
}

/** Builds an SRT document from timed lyric segments. */
export function buildSrt(segments: readonly LyricSegment[]): string {
  return segments
    .filter((segment) => segment.text.trim().length > 0)
    .map((segment, index) => {
      const end = segment.end > segment.start ? segment.end : segment.start + 2
      return `${index + 1}\n${formatSrtTime(segment.start)} --> ${formatSrtTime(end)}\n${segment.text.trim()}\n`
    })
    .join('\n')
}

export function lyricsFilePath(trackId: string): string {
  return `data/lyrics/${trackId}.txt`
}

export function subtitlesFilePath(trackId: string): string {
  return `data/subtitles/${trackId}.srt`
}

export interface TrackAssetFile {
  readonly path: string
  readonly content: string
}

/** Lyrics text and SRT file for a track, when lyrics were detected. */
export function buildTrackAssetFiles(track: {
  id: string
  lyrics?: string
  subtitles?: readonly LyricSegment[]
}): TrackAssetFile[] {
  const files: TrackAssetFile[] = []
  const lyrics = track.lyrics?.trim()
  if (lyrics) {
    files.push({ path: lyricsFilePath(track.id), content: `${lyrics}\n` })
  }
  if (track.subtitles && track.subtitles.length > 0) {
    const srt = buildSrt(track.subtitles)
    if (srt.length > 0) {
      files.push({
        path: subtitlesFilePath(track.id),
        content: srt.endsWith('\n') ? srt : `${srt}\n`,
      })
    }
  }
  return files
}
