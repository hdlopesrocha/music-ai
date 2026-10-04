/**
 * Client-side SHA-256 of the selected file. This is a convenience preview -
 * the server recomputes the hash from the received bytes, which is the value
 * actually used as the deterministic track id.
 */
export async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
