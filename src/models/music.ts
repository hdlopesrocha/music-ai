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

export interface Classification {
  style: string
  confidence: number
  substyles: string[]
  tags: string[]
  instrumental: boolean | null
  lyrics: string
  lyricsLanguage: string | null
  songMatch: SongProposal | null
  diagnostics: TrackDiagnostics | null
}

export interface PullRequestRef {
  number: number
  url: string
  branch: string
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
