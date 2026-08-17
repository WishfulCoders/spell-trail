import { STORAGE_KEY as LEGACY_KEY, newProgress, normalizeProgress } from './game.js'
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
  }
}

export function renameProfile(store, id, name) {
  const clean = cleanName(name)
  if (!clean) return store
  return updateProfile(store, id, (profile) => ({ ...profile, name: clean }))
}

export function emptyStore() {
  const first = createProfile('', 0)
  return { activeId: first.id, profiles: [first] }
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
    return { activeId: profile.id, profiles: [profile] }
  } catch {
    return null
  }
}

export function loadStore(storage = localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(PROFILE_STORAGE_KEY))
    if (saved && Array.isArray(saved.profiles) && saved.profiles.length) {
      const profiles = saved.profiles.map(normalizeProfile).filter(Boolean).slice(0, MAX_PROFILES)
      if (profiles.length) {
        const activeId = profiles.some((profile) => profile.id === saved.activeId) ? saved.activeId : profiles[0].id
        return { activeId, profiles }
      }
    }
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
  return { activeId: profile.id, profiles: [...store.profiles, profile] }
}

export function removeProfile(store, id) {
  // Never leave the app with nobody to play as.
  if (store.profiles.length <= 1) return store
  const profiles = store.profiles.filter((profile) => profile.id !== id)
  const activeId = profiles.some((profile) => profile.id === store.activeId) ? store.activeId : profiles[0].id
  return { activeId, profiles }
}
