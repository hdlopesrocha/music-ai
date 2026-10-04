import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface SubmissionWorkspace {
  readonly dir: string
  readonly filePath: string
  cleanup(): Promise<void>
}

/**
 * Creates an isolated, per-request temporary directory with restrictive
 * permissions containing the uploaded audio file. The directory is removed
 * after processing; audio is never committed or retained.
 */
export async function createSubmissionWorkspace(
  fileName: string,
  data: Buffer,
): Promise<SubmissionWorkspace> {
  const dir = await mkdtemp(join(tmpdir(), 'music-ai-'))
  const filePath = join(dir, fileName)
  await writeFile(filePath, data, { mode: 0o600 })

  let cleaned = false
  return {
    dir,
    filePath,
    async cleanup(): Promise<void> {
      if (cleaned) return
      cleaned = true
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    },
  }
}
