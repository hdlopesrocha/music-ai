import type { AppConfig } from '../../config.js'
import type { Logger } from '../../logger.js'
import { MusicBrainzSongIdentificationService } from './musicbrainz.js'
import { NoopSongIdentificationService, type SongIdentificationService } from './types.js'

export function createSongIdentificationService(
  config: AppConfig,
  logger: Logger,
): SongIdentificationService {
  if (!config.songLookup.enabled || config.songLookup.provider === 'none') {
    return new NoopSongIdentificationService()
  }
  return new MusicBrainzSongIdentificationService(config.songLookup, logger)
}
