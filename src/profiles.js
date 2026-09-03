import { ROUND_LENGTH, STORAGE_KEY as LEGACY_KEY, clampRoundLength, newProgress, normalizeProgress } from './game.js'
import { COMPANIONS, DEFAULT_COMPANION, companionById } from './shop.js'

export const PROFILE_STORAGE_KEY = 'spell-trail-profiles-v1'
export const MAX_PROFILES = 6
export const MAX_NAME_LENGTH = 16

export const PROFILE_COLORS = ['#56a87f', '#428fa4', '#e28b4a', '#8d6aae', '#c9585f', '#3f7f8c']

// Older saves stored the emoji itself; companions are keyed by id now.
function companionIdFrom(raw) {
  if (companionById(raw)) return raw
  const byEmoji = COMPANIONS.find((entry) => entry.emoji === raw)
  return byEmoji ? byEmoji.id : null
}

let counter = 0
function nextId(prefix) {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`
}

export function cleanName(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
}

export function createProfile(name, index = 0) {
  return {
    id: nextId('kid'),
    name: cleanName(name) || `Player ${index + 1}`,
    color: PROFILE_COLORS[index % PROFILE_COLORS.length],
    avatar: FREE_COMPANION_IDS[index % FREE_COMPANION_IDS.length] || DEFAULT_COMPANION,
    createdAt: Date.now(),
    progress: newProgress(),
    packs: [],
    unlocked: [],
    roundLength: ROUND_LENGTH,
    // The trail this player last chose, so the app opens on their school list
    // rather than Base Camp every time. Null means "pick a sensible default".
    lastSelection: null,
  }
}

const FREE_COMPANION_IDS = COMPANIONS.filter((entry) => entry.cost === 0).map((entry) => entry.id)

export function createPack(name, words) {
  return {
    id: nextId('pack'),
    name: String(name || '').trim().slice(0, 40) || 'This week',
    createdAt: Date.now(),
    words,
  }
}

function normalizePack(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.words)) return null
  const words = raw.words.filter((entry) => entry && typeof entry.word === 'string' && Array.isArray(entry.chunks))
  if (!words.length) return null
  return {
    id: raw.id || nextId('pack'),
    name: String(raw.name || 'This week').slice(0, 40),
    createdAt: Number(raw.createdAt) || Date.now(),
    words,
  }
}

function normalizeProfile(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  const base = createProfile(raw.name, index)
  return {
    ...base,
    id: raw.id || base.id,
    color: PROFILE_COLORS.includes(raw.color) ? raw.color : base.color,
    avatar: companionIdFrom(raw.avatar) || base.avatar,
    createdAt: Number(raw.createdAt) || base.createdAt,
    progress: normalizeProgress(raw.progress),
    packs: Array.isArray(raw.packs) ? raw.packs.map(normalizePack).filter(Boolean) : [],
    unlocked: Array.isArray(raw.unlocked)
      ? [...new Set(raw.unlocked.filter((id) => companionById(id)))]
      : [],
    roundLength: clampRoundLength(raw.roundLength),
    lastSelection: normalizeSelection(raw.lastSelection),
  }
}

function normalizeSelection(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (!['tier', 'pack', 'review'].includes(raw.kind)) return null
  return { kind: raw.kind, id: typeof raw.id === 'string' ? raw.id : null }
}

export function setLastSelection(store, id, selection) {
  return updateProfile(store, id, (profile) => ({ ...profile, lastSelection: normalizeSelection(selection) }))
}

// Where a player lands: whatever they chose last if it still exists,
// otherwise their newest word list, otherwise the default tier.
export function defaultSelection(profile, defaultTierId) {
  const last = profile.lastSelection
  if (last?.kind === 'pack' && profile.packs.some((pack) => pack.id === last.id)) return last
  if (last?.kind === 'tier' && last.id) return last
  const newest = [...profile.packs].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0]
  if (newest) return { kind: 'pack', id: newest.id }
  return { kind: 'tier', id: defaultTierId }
}

export const DEFAULT_SETTINGS = Object.freeze({ voiceUri: null })

function normalizeSettings(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  return { ...DEFAULT_SETTINGS, voiceUri: typeof raw.voiceUri === 'string' ? raw.voiceUri : null }
}

function normalizeBackupCode(raw) {
  const code = String(raw || '').trim().toLowerCase()
  return /^[a-z]+-[a-z]+-[a-z]+-\d{4}$/.test(code) ? code : null
}

// Local saves and downloaded backups pass through the same boundary. Keeping
// normalization in one place prevents a valid but older backup from entering
// live React state with fields the current UI cannot safely read.
export function normalizeStore(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.profiles)) return null
  const profiles = raw.profiles.map(normalizeProfile).filter(Boolean).slice(0, MAX_PROFILES)
  if (!profiles.length) return null
  const activeId = profiles.some((profile) => profile.id === raw.activeId) ? raw.activeId : profiles[0].id
  return {
    activeId,
    profiles,
    settings: normalizeSettings(raw.settings),
    backupCode: normalizeBackupCode(raw.backupCode),
  }
}

export function setRoundLength(store, id, length) {
  return updateProfile(store, id, (profile) => ({ ...profile, roundLength: clampRoundLength(length) }))
}

export function updatePack(store, profileId, packId, changes) {
  return updateProfile(store, profileId, (profile) => ({
    ...profile,
    packs: profile.packs.map((pack) => (pack.id === packId ? { ...pack, ...changes, id: pack.id } : pack)),
  }))
}

export function renameProfile(store, id, name) {
  const clean = cleanName(name)
  if (!clean) return store
  return updateProfile(store, id, (profile) => ({ ...profile, name: clean }))
}

export function emptyStore() {
  const first = createProfile('', 0)
  return { activeId: first.id, profiles: [first], settings: { ...DEFAULT_SETTINGS }, backupCode: null }
}

// A player who used the single-profile version keeps everything: their save
// becomes the first kid's profile rather than being discarded.
function migrateLegacy(storage) {
  try {
    const legacy = storage.getItem(LEGACY_KEY)
    if (!legacy) return null
    const progress = normalizeProgress(JSON.parse(legacy))
    if (!progress.wordsPracticed && !progress.xp) return null
    const profile = { ...createProfile('', 0), progress }
    return { activeId: profile.id, profiles: [profile], settings: { ...DEFAULT_SETTINGS }, backupCode: null }
  } catch {
    return null
  }
}

export function loadStore(storage = localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(PROFILE_STORAGE_KEY))
    const normalized = normalizeStore(saved)
    if (normalized) return normalized
  } catch {
    // fall through to migration / empty store
  }
  return migrateLegacy(storage) || emptyStore()
}

export function saveStore(store, storage = localStorage) {
  try {
    storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(store))
    return true
  } catch {
    return false
  }
}

export function activeProfile(store) {
  return store.profiles.find((profile) => profile.id === store.activeId) || store.profiles[0]
}

export function updateProfile(store, id, updater) {
  return { ...store, profiles: store.profiles.map((profile) => (profile.id === id ? updater(profile) : profile)) }
}

export function addProfile(store, name) {
  if (store.profiles.length >= MAX_PROFILES) return store
  const profile = createProfile(name, store.profiles.length)
  return { ...store, activeId: profile.id, profiles: [...store.profiles, profile] }
}

export function setVoice(store, voiceUri) {
  return { ...store, settings: { ...(store.settings || DEFAULT_SETTINGS), voiceUri: voiceUri || null } }
}

export function removeProfile(store, id) {
  // Never leave the app with nobody to play as.
  if (store.profiles.length <= 1) return store
  const profiles = store.profiles.filter((profile) => profile.id !== id)
  const activeId = profiles.some((profile) => profile.id === store.activeId) ? store.activeId : profiles[0].id
  return { ...store, activeId, profiles }
}
