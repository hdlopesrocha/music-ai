import type { AppConfig } from '../config.js'
import { ApiError } from '../errors.js'
import { getHeader, type ApiRequest } from '../http/types.js'
import {
  InvalidFileNameError,
  parseMusicFileName,
  type AudioExtension,
} from '../services/music/filename.js'
import {
  extractAudioMetadata,
  normalizeMimeType,
  validateAudioUpload,
} from '../services/music/audio.js'
import { createSubmissionWorkspace, type SubmissionWorkspace } from '../services/music/temp.js'
import type { AudioAnalysisInput } from '../services/opencode/types.js'

export interface PreparedSubmission {
  readonly input: AudioAnalysisInput
  readonly workspace: SubmissionWorkspace
}

export function requireContentLengthUnderLimit(req: ApiRequest, config: AppConfig): void {
  const rawLength = getHeader(req, 'content-length')
  if (!rawLength) return
  const length = Number.parseInt(rawLength, 10)
  if (Number.isFinite(length) && length > config.maxUploadSize) {
    throw ApiError.payloadTooLarge(
      `The upload exceeds the maximum size of ${config.maxUploadSize} bytes`,
    )
  }
}

/**
 * Validates the anonymous upload and prepares the isolated temporary workspace
 * used by the analysis agent. The caller is responsible for calling
 * `workspace.cleanup()` when done (always, in a finally block).
 */
export async function prepareSubmission(
  req: ApiRequest,
  config: AppConfig,
): Promise<PreparedSubmission> {
  requireContentLengthUnderLimit(req, config)

  const rawName = getHeader(req, 'x-music-filename')
  if (!rawName || rawName.trim().length === 0) {
    throw ApiError.badRequest('Missing X-Music-Filename header')
  }

  let parsedName: { fileName: string; extension: string }
  try {
    parsedName = parseMusicFileName(rawName, config.maxFilenameLength)
  } catch (error) {
    if (error instanceof InvalidFileNameError) throw ApiError.badRequest(error.message)
    throw error
  }

  const mimeType = normalizeMimeType(getHeader(req, 'content-type'))
  const upload = validateAudioUpload({
    fileName: parsedName.fileName,
    extension: parsedName.extension as AudioExtension,
    mimeType,
    buffer: req.body,
    config,
  })

  const workspace = await createSubmissionWorkspace(upload.fileName, req.body)

  try {
    const metadata = await extractAudioMetadata(workspace.filePath, upload)
    return {
      workspace,
      input: {
        filePath: workspace.filePath,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        size: upload.size,
        sha256: upload.sha256,
        metadata,
      },
    }
  } catch (error) {
    await workspace.cleanup()
    throw error
  }
}
