import { stripControlCharacters } from '../../utils/text.js'

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus'] as const
export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number]

const AUDIO_EXTENSION_SET = new Set<string>(AUDIO_EXTENSIONS)

export class InvalidFileNameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidFileNameError'
  }
}

export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.')
  if (index <= 0 || index === fileName.length - 1) return ''
  return fileName.slice(index + 1).toLowerCase()
}

export function isAllowedAudioExtension(extension: string): extension is AudioExtension {
  return AUDIO_EXTENSION_SET.has(extension)
}

/**
 * Turns an untrusted, user supplied file name into a safe basename.
 *
 * - URL decoding is attempted (the frontend sends the name URL encoded)
 * - path components from both POSIX and Windows are stripped
 * - control characters and zero-width characters are removed
 * - reserved device names and leading dots are neutralised
 */
export function sanitizeFileName(raw: string, maxLength: number): string {
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    // keep the original value when it is not valid percent-encoding
  }

  const basename = decoded.split(/[\\/]/).pop() ?? ''
  const cleaned = stripControlCharacters(basename)
    .replace(/["<>|:*?]/g, '_')
    .normalize('NFKC')

  const withoutLeadingDots = cleaned.replace(/^\.+/, '')
  const trimmed = withoutLeadingDots.trim()

  if (trimmed.length === 0) {
    throw new InvalidFileNameError('A valid file name is required')
  }

  const limited = trimmed.slice(0, maxLength)

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(limited)) {
    return `file-${limited}`
  }

  return limited
}

export interface ParsedFileName {
  readonly fileName: string
  readonly extension: string
}

export function parseMusicFileName(raw: string, maxLength: number): ParsedFileName {
  const fileName = sanitizeFileName(raw, maxLength)
  const extension = extensionOf(fileName)
  if (extension.length === 0) {
    throw new InvalidFileNameError('The file name must include a file extension')
  }
  if (!isAllowedAudioExtension(extension)) {
    throw new InvalidFileNameError(`Unsupported file extension ".${extension}"`)
  }
  return { fileName, extension }
}

/**
 * Best effort metadata inference from a file name such as
 * "Artist - Title.mp3" or "01. Artist - Title.flac".
 */
export function inferFromFileName(fileName: string): { artist?: string; title?: string } {
  const base = fileName.replace(/\.[^.]+$/, '').trim()
  const withoutTrackNumber = base.replace(/^\d{1,3}[.\-_ )]+/, '').trim()
  const separator = ' - '
  const index = withoutTrackNumber.indexOf(separator)
  if (index > 0) {
    const artist = withoutTrackNumber.slice(0, index).trim()
    const title = withoutTrackNumber.slice(index + separator.length).trim()
    if (artist.length > 0 && title.length > 0) return { artist, title }
  }
  return withoutTrackNumber.length > 0 ? { title: withoutTrackNumber } : {}
}
