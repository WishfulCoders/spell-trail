import { normalizeCode as canonicalCode, isValidCode } from '../worker/index.js'
import { normalizeStore } from './profiles.js'

export { isValidCode }

export function normalizeCode(raw) {
  return canonicalCode(raw)
}

// The backup is the whole store minus the bits that are device-local. Keeping
// it a plain JSON string means the server never has to understand the shape.
export function packStore(store) {
  return JSON.stringify({ version: 1, savedAt: Date.now(), profiles: store.profiles, activeId: store.activeId })
}

export function unpackStore(payload) {
  const parsed = JSON.parse(payload)
  const normalized = normalizeStore(parsed)
  if (!normalized) {
    throw new Error('That backup did not contain any players.')
  }
  return {
    activeId: normalized.activeId,
    profiles: normalized.profiles,
    savedAt: Number(parsed.savedAt) || null,
  }
}

async function readError(response) {
  try {
    const body = await response.json()
    return body?.error || `http-${response.status}`
  } catch {
    return `http-${response.status}`
  }
}

const MESSAGES = {
  'not-found': 'No backup found for that code. Check for typos.',
  'bad-code': 'That does not look like a backup code.',
  'too-large': 'This backup is too big to upload.',
  'no-payload': 'There was nothing to back up.',
}

function friendly(error) {
  return MESSAGES[error] || 'Could not reach the backup service. Check your connection and try again.'
}

export async function saveBackup(store, code = null, fetcher = fetch) {
  const response = await fetcher('/api/backup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: code || undefined, payload: packStore(store) }),
  })
  if (!response.ok) throw new Error(friendly(await readError(response)))
  const body = await response.json()
  return { code: body.code, savedAt: body.savedAt }
}

export async function deleteBackup(rawCode, fetcher = fetch) {
  const code = normalizeCode(rawCode)
  if (!isValidCode(code)) throw new Error(MESSAGES['bad-code'])
  const response = await fetcher(`/api/backup/${code}`, { method: 'DELETE' })
  // A backup that is already gone is the outcome the caller wanted.
  if (response.status === 404) return { code, deleted: true }
  if (!response.ok) throw new Error(friendly(await readError(response)))
  return { code, deleted: true }
}

export async function loadBackup(rawCode, fetcher = fetch) {
  const code = normalizeCode(rawCode)
  if (!isValidCode(code)) throw new Error(MESSAGES['bad-code'])
  const response = await fetcher(`/api/backup/${code}`)
  if (!response.ok) throw new Error(friendly(await readError(response)))
  const body = await response.json()
  return { code, ...unpackStore(body.payload) }
}
