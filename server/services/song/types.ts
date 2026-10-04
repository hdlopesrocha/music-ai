import type { AudioMetadata } from '../music/audio.js'
import type { SongProposal } from '../opencode/types.js'

export interface VerifiedSongMatch {
  readonly title: string
  readonly artist: string
  readonly album?: string
  readonly year?: number
  readonly provider: 'musicbrainz'
  readonly recordingId?: string
  readonly score?: number
}

export interface SongIdentificationInput {
  readonly proposal: SongProposal | null
  readonly metadata: AudioMetadata
  /** Transient lyrics used only to form the search query; never persisted. */
  readonly lyrics?: string
}

export interface SongIdentificationService {
  readonly name: string
  identify(input: SongIdentificationInput): Promise<VerifiedSongMatch | null>
}

export class NoopSongIdentificationService implements SongIdentificationService {
  readonly name = 'none'

  async identify(): Promise<VerifiedSongMatch | null> {
    return null
  }
}
