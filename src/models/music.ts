export interface VerifiedSong {
  title: string
  artist: string
  album?: string
  year?: number
  provider: 'musicbrainz'
  recordingId?: string
  score?: number
}

export interface TrackDiagnostics {
  bpm?: number
  duration?: number
  key?: string
  energy?: number
  instrumentation?: string[]
}

export interface Track {
  id: string
  fileName: string
  title?: string
  artist?: string
  album?: string
  year?: number
  duration?: number
  style: string
  substyles?: string[]
  tags?: string[]
  confidence: number
  hasLyrics?: boolean
  lyricsLanguage?: string
  subtitles?: LyricSegment[]
  song?: VerifiedSong
  detectedAt: string
  source: 'opencode'
  diagnostics?: TrackDiagnostics
}

export interface MusicDatabase {
  version: number
  tracks: Track[]
}

export interface StyleDatabase {
  version: number
  styles: string[]
}

export interface SongProposal {
  title: string
  artist: string
  confidence: number
}

export interface LyricSegment {
  start: number
  end: number
  text: string
}

export interface Classification {
  style: string
  confidence: number
  substyles: string[]
  tags: string[]
  instrumental: boolean | null
  lyrics: string
  lyricsSegments: LyricSegment[]
  lyricsLanguage: string | null
  songMatch: SongProposal | null
  diagnostics: TrackDiagnostics | null
}

export interface PullRequestRef {
  number: number
  url: string
  branch: string
}

export interface CommitRef {
  sha: string | null
  url: string
  branch: string
}

export interface Publication {
  type: 'pull-request' | 'commit'
  url: string
  branch: string
  number: number | null
  commitSha: string | null
}

export interface StyleCount {
  style: string
  count: number
}

export interface TrackStats {
  totalTracks: number
  knownStyles: number
  mostPopularStyle: StyleCount | null
  recentlyAddedAt: string | null
  styleCounts: StyleCount[]
}
