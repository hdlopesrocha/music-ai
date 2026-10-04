#!/usr/bin/env node
/**
 * Dependency-free validation of the JSON databases.
 *
 * Used by CI (`npm run validate:data`) so that an invalid data file can never
 * reach GitHub Pages, regardless of whether application tests pass.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const errors = []

function fail(message) {
  errors.push(message)
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

async function readJson(relativePath) {
  const raw = await readFile(join(root, relativePath), 'utf8')
  try {
    return JSON.parse(raw)
  } catch (error) {
    fail(`${relativePath}: invalid JSON (${error.message})`)
    return null
  }
}

const stylesDoc = await readJson('data/styles.json')
const musicDoc = await readJson('data/music.json')

let styleSet = new Set()

if (stylesDoc !== null) {
  if (!isPlainObject(stylesDoc)) fail('data/styles.json: root must be an object')
  else {
    if (!Number.isInteger(stylesDoc.version)) fail('data/styles.json: "version" must be an integer')
    if (!Array.isArray(stylesDoc.styles)) fail('data/styles.json: "styles" must be an array')
    else {
      for (const [index, style] of stylesDoc.styles.entries()) {
        if (!isNonEmptyString(style)) {
          fail(`data/styles.json: styles[${index}] must be a non-empty string`)
          continue
        }
        const normalized = style.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
        if (styleSet.has(normalized)) fail(`data/styles.json: duplicate style "${style}"`)
        styleSet.add(normalized)
      }
    }
  }
}

if (musicDoc !== null) {
  if (!isPlainObject(musicDoc)) fail('data/music.json: root must be an object')
  else {
    if (!Number.isInteger(musicDoc.version)) fail('data/music.json: "version" must be an integer')
    if (!Array.isArray(musicDoc.tracks)) fail('data/music.json: "tracks" must be an array')
    else {
      const ids = new Set()
      const allowedKeys = new Set([
        'id',
        'fileName',
        'title',
        'artist',
        'album',
        'year',
        'duration',
        'style',
        'substyles',
        'tags',
        'confidence',
        'hasLyrics',
        'lyricsLanguage',
        'subtitles',
        'song',
        'detectedAt',
        'source',
        'diagnostics',
      ])
      for (const [index, track] of musicDoc.tracks.entries()) {
        const where = `data/music.json: tracks[${index}]`
        if (!isPlainObject(track)) {
          fail(`${where} must be an object`)
          continue
        }
        for (const key of Object.keys(track)) {
          if (!allowedKeys.has(key)) fail(`${where}: unexpected key "${key}"`)
        }
        if (!isNonEmptyString(track.id) || !/^[a-f0-9]{64}$/.test(track.id))
          fail(`${where}: "id" must be a lowercase SHA-256 hex string`)
        else if (ids.has(track.id)) fail(`${where}: duplicate id "${track.id}"`)
        else ids.add(track.id)
        if (!isNonEmptyString(track.fileName)) fail(`${where}: "fileName" is required`)
        if (!isNonEmptyString(track.style)) fail(`${where}: "style" is required`)
        else if (styleSet.size > 0 && !styleSet.has(track.style.trim().toLowerCase()))
          fail(`${where}: style "${track.style}" is not present in data/styles.json`)
        if (typeof track.confidence !== 'number' || track.confidence < 0 || track.confidence > 1)
          fail(`${where}: "confidence" must be a number between 0 and 1`)
        if (track.subtitles !== undefined) {
          if (!Array.isArray(track.subtitles)) {
            fail(`${where}: "subtitles" must be an array`)
          } else {
            for (const [segmentIndex, segment] of track.subtitles.entries()) {
              const segWhere = `${where}.subtitles[${segmentIndex}]`
              if (!isPlainObject(segment)) {
                fail(`${segWhere} must be an object`)
                continue
              }
              if (typeof segment.start !== 'number' || segment.start < 0)
                fail(`${segWhere}: "start" must be a non-negative number`)
              if (typeof segment.end !== 'number' || segment.end < 0)
                fail(`${segWhere}: "end" must be a non-negative number`)
              if (!isNonEmptyString(segment.text))
                fail(`${segWhere}: "text" must be a non-empty string`)
            }
          }
        }
        if (!isNonEmptyString(track.detectedAt) || Number.isNaN(Date.parse(track.detectedAt)))
          fail(`${where}: "detectedAt" must be an ISO date string`)
        if (track.source !== 'opencode') fail(`${where}: "source" must be "opencode"`)
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`validate-data: ${errors.length} problem(s) found\n`)
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.info(`validate-data: OK (${styleSet.size} styles, ${musicDoc?.tracks?.length ?? 0} tracks)`)
