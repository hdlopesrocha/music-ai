import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Stateless feedback token. Binding the token to the repository, pull request
 * number and track id means a token can only ever be used to comment on the
 * exact PR it was issued for. Anyone who submitted a track receives a token for
 * that submission only.
 */
export function createFeedbackToken(
  secret: string,
  parts: { repository: string; pullRequestNumber: number; trackId: string },
): string {
  return createHmac('sha256', secret)
    .update(`${parts.repository}#${parts.pullRequestNumber}#${parts.trackId}`)
    .digest('hex')
}

export function verifyFeedbackToken(
  secret: string,
  token: string,
  parts: { repository: string; pullRequestNumber: number; trackId: string },
): boolean {
  const expected = createFeedbackToken(secret, parts)
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const providedBuffer = Buffer.from(token, 'utf8')
  if (expectedBuffer.length !== providedBuffer.length) return false
  return timingSafeEqual(expectedBuffer, providedBuffer)
}
