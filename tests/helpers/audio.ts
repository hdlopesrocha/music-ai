/**
 * Builds a valid, tiny PCM WAV file entirely in memory so metadata extraction
 * can be tested deterministically.
 */
export function buildWav(options: { seconds?: number; sampleRate?: number } = {}): Buffer {
  const seconds = options.seconds ?? 1
  const sampleRate = options.sampleRate ?? 8000
  const samples = Math.floor(seconds * sampleRate)
  const dataSize = samples * 2
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0, 'latin1')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'latin1')
  buffer.write('fmt ', 12, 'latin1')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'latin1')
  buffer.writeUInt32LE(dataSize, 40)

  return buffer
}

export function fakeMp3(payload = 'audio'): Buffer {
  return Buffer.concat([Buffer.from('ID3'), Buffer.alloc(32), Buffer.from(payload)])
}

export function fakeFlac(): Buffer {
  return Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(32)])
}
