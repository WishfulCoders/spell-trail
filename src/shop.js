// Fireflies had no sink — they only ever counted up. Companions give them
// somewhere to go: cosmetic only, never a gate on practice, and priced so the
// first one lands within a couple of trails and the last is a long goal.
export const COMPANIONS = [
  { id: 'fox', emoji: '🦊', name: 'Fox', cost: 0, note: 'Your first trail friend' },
  { id: 'owl', emoji: '🦉', name: 'Owl', cost: 0, note: 'Keeps watch at night' },
  { id: 'turtle', emoji: '🐢', name: 'Turtle', cost: 0, note: 'Slow and steady' },
  { id: 'butterfly', emoji: '🦋', name: 'Butterfly', cost: 20, note: 'Follows the wildflowers' },
  { id: 'hedgehog', emoji: '🦔', name: 'Hedgehog', cost: 30, note: 'Rustles in the leaves' },
  { id: 'deer', emoji: '🦌', name: 'Deer', cost: 45, note: 'Steps quietly ahead' },
  { id: 'bee', emoji: '🐝', name: 'Bee', cost: 60, note: 'Busy on every trail' },
  { id: 'squirrel', emoji: '🐿️', name: 'Squirrel', cost: 80, note: 'Hides snacks for later' },
  { id: 'raccoon', emoji: '🦝', name: 'Raccoon', cost: 110, note: 'Checks every pocket' },
  { id: 'otter', emoji: '🦦', name: 'Otter', cost: 150, note: 'Best at creek crossings' },
  { id: 'badger', emoji: '🦡', name: 'Badger', cost: 200, note: 'Digs in and finishes' },
  { id: 'wolf', emoji: '🐺', name: 'Wolf', cost: 275, note: 'Knows the long routes' },
  { id: 'bear', emoji: '🐻', name: 'Bear', cost: 350, note: 'Guards the camp' },
  { id: 'eagle', emoji: '🦅', name: 'Eagle', cost: 450, note: 'Sees the whole ridge' },
  { id: 'dragon', emoji: '🐉', name: 'Dragon', cost: 600, note: 'Only for summit climbers' },
]

export const DEFAULT_COMPANION = COMPANIONS[0].id

export function companionById(id) {
  return COMPANIONS.find((entry) => entry.id === id)
}

export function companionEmoji(id) {
  return (companionById(id) || COMPANIONS[0]).emoji
}

export function isFree(id) {
  const item = companionById(id)
  return Boolean(item) && item.cost === 0
}

export function ownedCompanions(profile) {
  const bought = Array.isArray(profile?.unlocked) ? profile.unlocked : []
  return COMPANIONS.filter((entry) => entry.cost === 0 || bought.includes(entry.id))
}

export function ownsCompanion(profile, id) {
  return ownedCompanions(profile).some((entry) => entry.id === id)
}

// Pure: takes a profile, returns the next profile plus why it did or did not
// change, so the UI never has to reimplement the affordability rule.
export function buyCompanion(profile, id) {
  const item = companionById(id)
  if (!item) return { profile, error: 'unknown' }
  if (ownsCompanion(profile, id)) return { profile, error: 'owned' }
  if (profile.progress.fireflies < item.cost) return { profile, error: 'fireflies' }
  return {
    error: null,
    profile: {
      ...profile,
      unlocked: [...(profile.unlocked || []), id],
      avatar: id,
      progress: { ...profile.progress, fireflies: profile.progress.fireflies - item.cost },
    },
  }
}

export function equipCompanion(profile, id) {
  if (!ownsCompanion(profile, id)) return profile
  return { ...profile, avatar: id }
}

export function nextCompanion(profile) {
  const owned = new Set(ownedCompanions(profile).map((entry) => entry.id))
  return COMPANIONS.find((entry) => !owned.has(entry.id)) || null
}
