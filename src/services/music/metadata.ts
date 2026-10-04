export interface ClientMetadata {
  fileName: string
  title?: string
  artist?: string
  duration?: number
  mimeType: string
  size: number
}

export const SUPPORTED_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus'] as const

export const ACCEPT_ATTRIBUTE = [
  ...SUPPORTED_EXTENSIONS.map((extension) => `.${extension}`),
  'audio/*',
].join(',')

export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.')
  return index > 0 ? fileName.slice(index + 1).toLowerCase() : ''
}

export function isSupportedAudioFile(file: File): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extensionOf(file.name))
}

export function inferFromFileName(fileName: string): { artist?: string; title?: string } {
  const base = fileName.replace(/\.[^.]+$/, '').trim()
  const withoutTrackNumber = base.replace(/^\d{1,3}[.\-_ )]+/, '').trim()
  const index = withoutTrackNumber.indexOf(' - ')
  if (index > 0) {
    const artist = withoutTrackNumber.slice(0, index).trim()
    const title = withoutTrackNumber.slice(index + 3).trim()
    if (artist.length > 0 && title.length > 0) return { artist, title }
  }
  return withoutTrackNumber.length > 0 ? { title: withoutTrackNumber } : {}
}

export function readDuration(file: File, timeoutMs = 6000): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = document.createElement('audio')
    let settled = false

    const finish = (value: number | undefined): void => {
      if (settled) return
      settled = true
      audio.removeAttribute('src')
      audio.load()
      URL.revokeObjectURL(url)
      resolve(value)
    }

    const timer = window.setTimeout(() => finish(undefined), timeoutMs)

    audio.addEventListener('loadedmetadata', () => {
      window.clearTimeout(timer)
      const duration =
        Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined
      finish(duration)
    })
    audio.addEventListener('error', () => {
      window.clearTimeout(timer)
      finish(undefined)
    })
    audio.preload = 'metadata'
    audio.src = url
  })
}

export async function readClientMetadata(file: File): Promise<ClientMetadata> {
  const inferred = inferFromFileName(file.name)
  const duration = await readDuration(file)
  return {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    ...inferred,
    ...(duration !== undefined ? { duration: Math.round(duration) } : {}),
  }
}
