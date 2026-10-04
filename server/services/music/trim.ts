import { extname } from 'node:path'

/**
 * Caps the audio sent to the model to `maxSeconds` so long tracks do not make
 * analysis slow or expensive. WAV is trimmed frame-accurately; MP3 is trimmed
 * proportionally using the duration already extracted from the container.
 * Returns the original buffer when trimming is disabled or unnecessary.
 */
export function trimAudioForAnalysis(
  buffer: Buffer,
  fileName: string,
  durationSeconds: number | undefined,
  maxSeconds: number,
): Buffer {
  if (maxSeconds <= 0) return buffer
  const extension = extname(fileName).toLowerCase()

  if (extension === '.wav') return trimWav(buffer, maxSeconds)
  if (extension === '.mp3') return trimMp3(buffer, durationSeconds, maxSeconds)
  return buffer
}

interface WavFormat {
  readonly format: number
  readonly channels: number
  readonly sampleRate: number
  readonly bitsPerSample: number
}

function parseWav(
  buffer: Buffer,
): { format: WavFormat; dataStart: number; dataLength: number } | null {
  if (
    buffer.length < 44 ||
    buffer.toString('latin1', 0, 4) !== 'RIFF' ||
    buffer.toString('latin1', 8, 12) !== 'WAVE'
  ) {
    return null
  }

  let offset = 12
  let format: WavFormat | null = null
  let dataStart = -1
  let dataLength = 0

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('latin1', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8

    if (id === 'fmt ' && size >= 16 && chunkStart + 16 <= buffer.length) {
      format = {
        format: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      }
    } else if (id === 'data') {
      dataStart = chunkStart
      dataLength = Math.min(size, Math.max(0, buffer.length - chunkStart))
      break
    }

    offset = chunkStart + size + (size % 2)
  }

  if (!format || dataStart < 0 || format.sampleRate <= 0) return null
  return { format, dataStart, dataLength }
}

function trimWav(buffer: Buffer, maxSeconds: number): Buffer {
  const parsed = parseWav(buffer)
  if (!parsed) return buffer

  const { format, dataStart, dataLength } = parsed
  const bytesPerFrame = format.channels * (format.bitsPerSample / 8)
  if (!Number.isFinite(bytesPerFrame) || bytesPerFrame <= 0) return buffer

  const totalFrames = Math.floor(dataLength / bytesPerFrame)
  const maxFrames = Math.floor(maxSeconds * format.sampleRate)
  if (totalFrames <= maxFrames) return buffer

  const keepBytes = maxFrames * bytesPerFrame
  const output = Buffer.alloc(44 + keepBytes)
  output.write('RIFF', 0, 'latin1')
  output.writeUInt32LE(36 + keepBytes, 4)
  output.write('WAVE', 8, 'latin1')
  output.write('fmt ', 12, 'latin1')
  output.writeUInt32LE(16, 16)
  output.writeUInt16LE(format.format, 20)
  output.writeUInt16LE(format.channels, 22)
  output.writeUInt32LE(format.sampleRate, 24)
  output.writeUInt32LE(format.sampleRate * bytesPerFrame, 28)
  output.writeUInt16LE(bytesPerFrame, 32)
  output.writeUInt16LE(format.bitsPerSample, 34)
  output.write('data', 36, 'latin1')
  output.writeUInt32LE(keepBytes, 40)
  buffer.copy(output, 44, dataStart, dataStart + keepBytes)
  return output
}

function trimMp3(buffer: Buffer, durationSeconds: number | undefined, maxSeconds: number): Buffer {
  if (!durationSeconds || durationSeconds <= maxSeconds) return buffer
  const ratio = Math.min(1, maxSeconds / durationSeconds)
  const keep = Math.round(buffer.length * ratio)
  if (keep >= buffer.length) return buffer
  return buffer.subarray(0, Math.max(1024, keep))
}
