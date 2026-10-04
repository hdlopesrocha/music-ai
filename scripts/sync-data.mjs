#!/usr/bin/env node
/**
 * Copies the repository's source-of-truth JSON databases into the Vite public
 * directory so the static site can fetch them at runtime.
 *
 * data/*.json -> public/data/*.json
 */
import { cp, mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = ['music.json', 'styles.json']

await mkdir(join(root, 'public', 'data'), { recursive: true })

for (const file of files) {
  const source = join(root, 'data', file)
  const raw = await readFile(source, 'utf8')
  JSON.parse(raw) // fail fast on invalid JSON
  await cp(source, join(root, 'public', 'data', file))
  console.info(`[sync-data] ${source} -> public/data/${file}`)
}
