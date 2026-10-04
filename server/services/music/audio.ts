import { parseFile } from 'music-metadata'
import type { AppConfig } from '../../config.js'
import { ApiError } from '../../errors.js'
import { optionalTrimmed, truncate } from '../../utils/text.js'
import { sha256Hex } from '../../utils/hash.js'
import { AUDIO_EXTENSIONS, type AudioExtension } from './filename.js'

interface MimeRule {
  readonly mimeTypes: readonly string[]
}

const MIME_RULES: Record<AudioExtension, MimeRule> = {
  mp3: { mimeTypes: ['audio/mpeg', 'audio/mp3', 'audio/x-mp3', 'audio/mpeg3'] },
  wav: { mimeTypes: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'] },
  flac: { mimeTypes: ['audio/flac', 'audio/x-flac'] },
  ogg: { mimeTypes: ['audio/ogg', 'application/ogg', 'audio/vorbis', 'audio/opus'] },
  m4a: { mimeTypes: ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac'] },
  aac: { mimeTypes: ['audio/aac', 'audio/aacp', 'audio/x-aac', 'audio/mp4'] },
  opus: { mimeTypes: ['audio/opus', 'audio/ogg', 'application/ogg'] },
}

const GENERIC_MIME_TYPES = new Set(['application/octet-stream', 'binary/octet-stream', ''])

export type AudioContainer = 'mp3' | 'wav' | 'flac' | 'ogg' | 'm4a' | 'aac' | 'unknown'

export interface AudioMetadata {
  readonly fileName: string
  readonly title?: string
  readonly artist?: string
  readonly album?: string
  readonly year?: number
  readonly duration?: number
  readonly mimeType: string
  readonly size: number
  readonly sha256: string
}

export interface ValidatedAudioUpload {
  readonly fileName: string
  readonly extension: AudioExtension
  readonly mimeType: string
  readonly container: AudioContainer
  readonly size: number
  readonly sha256: string
}

export function normalizeMimeType(rawMime: string | undefined): string {
  if (!rawMime) return ''
  return rawMime.split(';')[0]?.trim().toLowerCase() ?? ''
}

export function isMimeAllowed(mimeType: string, extension: AudioExtension): boolean {
  if (GENERIC_MIME_TYPES.has(mimeType)) return true
  return MIME_RULES[extension].mimeTypes.includes(mimeType)
}

export function detectContainer(buffer: Buffer): AudioContainer {
  if (buffer.length >= 4) {
    const magic0 = buffer.toString('latin1', 0, 4)
    if (magic0 === 'fLaC') return 'flac'
    if (magic0 === 'OggS') return 'ogg'
    if (magic0.startsWith('ID3')) return 'mp3'
  }
  if (buffer.length >= 12) {
    const riff = buffer.toString('latin1', 0, 4)
    const wave = buffer.toString('latin1', 8, 12)
    if (riff === 'RIFF' && wave === 'WAVE') return 'wav'
    const ftyp = buffer.toString('latin1', 4, 8)
    if (ftyp === 'ftyp') return 'm4a'
  }
  if (buffer.length >= 2) {
    const first = buffer[0] ?? 0
    const second = buffer[1] ?? 0
    if (first === 0xff && (second & 0xf6) === 0xf0) return 'aac' // ADTS sync
    if (first === 0xff && (second & 0xe0) === 0xe0) return 'mp3' // MPEG frame sync
  }
  return 'unknown'
}

function containersConflict(container: AudioContainer, extension: AudioExtension): boolean {
  if (container === 'unknown') return false
  if (container === 'ogg' && (extension === 'ogg' || extension === 'opus')) return false
  if (container === 'm4a' && (extension === 'm4a' || extension === 'aac')) return false
  if (container === 'aac' && extension === 'aac') return false
  if (container === 'aac' && extension === 'm4a') return false
  return container !== extension
}

export function validateAudioUpload(params: {
  fileName: string
  extension: AudioExtension
  mimeType: string
  buffer: Buffer
  config: AppConfig
}): ValidatedAudioUpload {
  const { fileName, extension, mimeType, buffer, config } = params

  if (buffer.length === 0) {
    throw ApiError.badRequest('The uploaded file is empty')
  }
  if (buffer.length > config.maxUploadSize) {
    throw ApiError.payloadTooLarge(
      `The file exceeds the maximum upload size of ${config.maxUploadSize} bytes`,
    )
  }
  if (!isMimeAllowed(mimeType, extension)) {
    throw ApiError.unsupportedMediaType(
      `Content type "${mimeType}" does not match the allowed types for .${extension}`,
    )
  }

  const container = detectContainer(buffer)
  if (containersConflict(container, extension)) {
    throw ApiError.unsupportedMediaType(
      `The file content (${container}) does not match the extension ".${extension}"`,
    )
  }

  return {
    fileName,
    extension,
    mimeType: mimeType.length > 0 ? mimeType : 'application/octet-stream',
    container,
    size: buffer.length,
    sha256: sha256Hex(buffer),
  }
}

export async function extractAudioMetadata(
  filePath: string,
  upload: ValidatedAudioUpload,
): Promise<AudioMetadata> {
  const base: AudioMetadata = {
    fileName: upload.fileName,
    mimeType: upload.mimeType,
    size: upload.size,
    sha256: upload.sha256,
  }

  try {
    const parsed = await parseFile(filePath, { duration: true })
    const common = parsed.common
    const duration = parsed.format.duration
    return {
      ...base,
      title: optionalTrimmed(common.title, 300),
      artist: optionalTrimmed(common.artist, 300),
      album: optionalTrimmed(common.album, 300),
      year:
        typeof common.year === 'number' && Number.isFinite(common.year) ? common.year : undefined,
      duration:
        typeof duration === 'number' && Number.isFinite(duration) && duration > 0
          ? Math.round(duration)
          : undefined,
    }
  } catch {
    return base
  }
}

export function describeUpload(upload: ValidatedAudioUpload): Record<string, unknown> {
  return {
    fileName: truncate(upload.fileName, 120),
    extension: upload.extension,
    container: upload.container,
    size: upload.size,
    sha256Prefix: upload.sha256.slice(0, 12),
  }
}

export function supportedExtensionsLabel(): string {
  return AUDIO_EXTENSIONS.map((extension) => `.${extension}`).join(', ')
}
