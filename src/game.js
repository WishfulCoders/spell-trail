export const STORAGE_KEY = 'spell-trail-progress-v1'

// Levelling curve. A default eight-word trail is worth roughly 105-155 XP, so
// the first level-up lands after two to three trails and each one after that
// takes a little longer. The growth is capped so high levels stay reachable
// rather than becoming a wall.
export const LEVEL_BASE_XP = 350
export const LEVEL_GROWTH = 1.15
export const LEVEL_REQUIREMENT_CAP = 2500
export const MAX_LEVEL = 50
export const XP_CURVE_VERSION = 2
const LEGACY_XP_PER_LEVEL = 120

export const SESSION_BONUS = 30
export const CORRECT_XP = 12
export const PARTICIPATION_XP = 4
export const PRACTICE_XP = 6
export const STREAK_BONUS_CAP = 5
export const STREAK_FIREFLY_BONUS_AT = 3
export const ROUND_LENGTH = 8
export const ROUND_LENGTH_OPTIONS = [3, 5, 8, 12, 16]
export const RECALL_SHARE = 0.25

export function clampRoundLength(value) {
  const wanted = Number(value)
  // Number(null) is 0, so a missing value must be rejected explicitly or an
  // older saved profile would silently drop to the shortest trail.
  if (!Number.isFinite(wanted) || wanted <= 0) return ROUND_LENGTH
  // Snap to the nearest offered size rather than allowing arbitrary lengths,
  // so the mode plan stays predictable.
  return ROUND_LENGTH_OPTIONS.reduce(
    (best, option) => (Math.abs(option - wanted) < Math.abs(best - wanted) ? option : best),
    ROUND_LENGTH,
  )
}

export const DEFAULT_WORD_STAT = Object.freeze({
  right: 0,
  tries: 0,
  // Clean answers since the last miss. This is what retires a word from review
  // camp, and it is why the total `right` count cannot do that job: a word can
  // be right ten times and still have been missed this morning.
  sinceWrong: 0,
  lastSeen: 0,
  lastWrong: 0,
  missedModes: {},
})

export const DEFAULT_PROGRESS = Object.freeze({
  xp: 0,
  xpCurve: XP_CURVE_VERSION,
  fireflies: 0,
  streak: 0,
  bestStreak: 0,
  wordsPracticed: 0,
  correctAnswers: 0,
  sessionsCompleted: 0,
  badges: [],
  mastered: {},
})

export const BADGES = [
  { id: 'first-step', icon: '🥾', label: 'First Step', detail: 'Finish your first trail', test: (p) => p.sessionsCompleted >= 1 },
  { id: 'bright-spark', icon: '✨', label: 'Bright Spark', detail: 'Reach a 5-answer streak', test: (p) => p.bestStreak >= 5 },
  { id: 'word-scout', icon: '🧭', label: 'Word Scout', detail: 'Practice 20 words', test: (p) => p.wordsPracticed >= 20 },
  { id: 'summit-star', icon: '🏔️', label: 'Summit Star', detail: 'Earn 500 XP', test: (p) => p.xp >= 500 },
]

// XP needed to go from `level` to the next one.
export function xpForLevelUp(level) {
  if (level >= MAX_LEVEL) return Infinity
  return Math.min(Math.round(LEVEL_BASE_XP * LEVEL_GROWTH ** (level - 1)), LEVEL_REQUIREMENT_CAP)
}

// Cumulative XP at which each level begins. Index 0 is unused so that
// THRESHOLDS[n] is the total XP required to be level n.
const THRESHOLDS = (() => {
  const totals = [0, 0]
  let running = 0
  for (let level = 1; level < MAX_LEVEL; level += 1) {
    running += xpForLevelUp(level)
    totals.push(running)
  }
  return totals
})()

// Total XP required to reach the start of `level`.
export function totalXpForLevel(level) {
  if (level <= 1) return 0
  return THRESHOLDS[Math.min(level, MAX_LEVEL)]
}

export function levelFromXp(xp) {
  const total = Math.max(0, Number(xp) || 0)
  for (let level = MAX_LEVEL; level >= 1; level -= 1) {
    if (total >= totalXpForLevel(level)) return level
  }
  return 1
}

export function xpIntoLevel(xp) {
  return Math.max(0, (Number(xp) || 0) - totalXpForLevel(levelFromXp(xp)))
}

export function xpToNextLevel(xp) {
  const level = levelFromXp(xp)
  if (level >= MAX_LEVEL) return 0
  return xpForLevelUp(level) - xpIntoLevel(xp)
}

export function levelProgress(xp) {
  const level = levelFromXp(xp)
  if (level >= MAX_LEVEL) return 1
  return Math.min(1, xpIntoLevel(xp) / xpForLevelUp(level))
}

// Levelling up pays out in fireflies rather than XP, so the reward feeds the
// companion shop instead of compounding back into the curve it came from.
export function levelUpBonus(level) {
  return Math.min(10 * level, 80)
}

// Awards every level crossed between two XP totals, so a single generous
// answer that jumps two levels still pays both bonuses.
export function settleLevelUps(previousXp, progress) {
  const from = levelFromXp(previousXp)
  const to = levelFromXp(progress.xp)
  if (to <= from) return { progress, levelUps: [] }
  const levelUps = []
  let fireflies = progress.fireflies
  for (let level = from + 1; level <= to; level += 1) {
    const bonus = levelUpBonus(level)
    levelUps.push({ level, fireflies: bonus })
    fireflies += bonus
  }
  return { progress: { ...progress, fireflies }, levelUps }
}

// Players who earned XP under the old flat 120-per-level curve keep the level
// they had, and their progress through it, instead of appearing to be demoted.
export function migrateXp(oldXp) {
  const xp = Math.max(0, Number(oldXp) || 0)
  const oldLevel = Math.min(Math.floor(xp / LEGACY_XP_PER_LEVEL) + 1, MAX_LEVEL)
  const into = xp % LEGACY_XP_PER_LEVEL
  const requirement = xpForLevelUp(oldLevel)
  const carried = Number.isFinite(requirement) ? Math.round((into / LEGACY_XP_PER_LEVEL) * requirement) : 0
  return totalXpForLevel(oldLevel) + carried
}

// A word is passed off once it has been spelled right at least once. Later
// mistakes never take it back: the count is a record of ground covered, not a
// running score, so a track's progress bar only ever moves forwards.
export const PASS_THRESHOLD = 1

export function isPassed(progress, word) {
  return (progress?.mastered?.[word]?.right || 0) >= PASS_THRESHOLD
}

// `words` is a tier or pack word list — [{ word, ... }].
export function passedCount(progress, words) {
  return words.reduce((total, entry) => total + (isPassed(progress, entry.word) ? 1 : 0), 0)
}

/* ---------------------------------------------------------- review camp -- */

// Clean answers needed to walk a word back out of review camp. One is not
// enough: a lucky guess on a three-option question should not clear a word the
// child could not spell yesterday.
export const REVIEW_CLEAR = 2

export function needsReview(progress, word) {
  const stat = progress?.mastered?.[word]
  if (!stat || !stat.lastWrong) return false
  return (stat.sinceWrong || 0) < REVIEW_CLEAR
}

// Every word the player has missed and not yet walked back, neediest first:
// fewest clean answers since the miss, then the most recent mistake. Callers
// pass the pool to search — the tiers plus whatever their grown-up typed in.
export function reviewWords(progress, words) {
  return words
    .filter((entry) => needsReview(progress, entry.word))
    .sort((left, right) => {
      const a = progress.mastered[left.word]
      const b = progress.mastered[right.word]
      return (a.sinceWrong || 0) - (b.sinceWrong || 0) || (b.lastWrong || 0) - (a.lastWrong || 0)
    })
}

// What a player picks when they have no idea how to spell the word. It is
// graded as a miss so the word comes back for a second look, but it is never a
// real answer, so nothing in the UI should try to match it against an option.
export const UNKNOWN_ANSWER = '__i-dont-know__'

export function shuffle(items, random = Math.random) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

/* ---------------------------------------------------------------- modes -- */

export const MODES = ['listen', 'missing', 'chunks', 'memory', 'type']

// A mode can only be used for a word that carries the data it needs. Curated
// tier words carry everything; a parent-entered word may carry nothing but the
// word itself, so every mode has to say what it requires.
const MODE_REQUIREMENTS = {
  listen: (word) => Array.isArray(word.distractors) && word.distractors.length >= 2,
  missing: (word) => Array.isArray(word.chunks) && word.chunks.length >= 2,
  chunks: (word) => Array.isArray(word.chunks) && word.chunks.length >= 2,
  // Memory trail shows the word and takes it away again, so it needs nothing
  // but the word — and, unlike typing, no speech either.
  memory: () => true,
  type: () => true,
}

export function supportedModes(word, { audio = true } = {}) {
  return MODES.filter((mode) => {
    if (mode === 'type' && !audio) return false
    return MODE_REQUIREMENTS[mode](word)
  })
}

export function resolveMode(word, wanted, { audio = true } = {}) {
  const available = supportedModes(word, { audio })
  if (available.includes(wanted)) return wanted
  // Step down the difficulty ladder rather than jumping to an arbitrary mode:
  // a word that cannot be typed should land on the next-hardest thing it can
  // do, not on the easiest. Below the ladder, prefer any non-typing fallback so
  // a round does not turn into all typing.
  const wantedRank = MODE_DIFFICULTY.indexOf(wanted)
  for (let step = wantedRank - 1; step >= 0; step -= 1) {
    if (available.includes(MODE_DIFFICULTY[step])) return MODE_DIFFICULTY[step]
  }
  return available.find((mode) => mode !== 'type') || available[0] || 'type'
}

// Easiest to hardest: picking from three spellings gives the most support,
// typing from nothing but the spoken word the least. Memory trail sits just
// below typing — the word was on screen a moment ago, so there is something to
// reach for.
export const MODE_DIFFICULTY = ['listen', 'missing', 'chunks', 'memory', 'type']

export function easierMode(word, mode, { audio = true } = {}) {
  const available = supportedModes(word, { audio })
  const current = MODE_DIFFICULTY.indexOf(mode)
  for (let step = current - 1; step >= 0; step -= 1) {
    if (available.includes(MODE_DIFFICULTY[step])) return MODE_DIFFICULTY[step]
  }
  return available.find((entry) => entry !== mode) || mode
}

// A missed word comes back before the trail ends, one step easier than the
// mode it was missed in — seeing it again is the point, not scoring it again.
export function makeRetry(item, { audio = true } = {}) {
  return { ...item, mode: easierMode(item, item.mode, { audio }), retry: true }
}

// The two modes that ask a player to produce the whole word from nothing on
// screen. Checkpoints alternate between them so a trail asks for recall twice
// in two different ways rather than twice the same way.
export const RECALL_MODES = ['type', 'memory']

// Recall checkpoints land at evenly spaced positions, ending on the last
// question. At length 8 that is indices 3 and 7; at length 3 it is index 2.
export function planModes(length, random = Math.random) {
  if (length <= 0) return []
  const checkpoints = Math.min(length, Math.max(1, Math.round(length * RECALL_SHARE)))
  const checkpointAt = new Map()
  for (let slot = 1; slot <= checkpoints; slot += 1) {
    checkpointAt.set(Math.round((slot * length) / checkpoints) - 1, RECALL_MODES[(slot - 1) % RECALL_MODES.length])
  }
  const cycle = shuffle(['listen', 'missing', 'chunks'], random)
  const plan = []
  let cursor = 0
  for (let index = 0; index < length; index += 1) {
    if (checkpointAt.has(index)) {
      plan.push(checkpointAt.get(index))
      continue
    }
    plan.push(cycle[cursor % cycle.length])
    cursor += 1
  }
  return plan
}

// Word selection, round length, and mode assignment are independent inputs so
// a round can be built from a tier, a review queue, a daily seed, or a custom
// word pack without changing anything below this line.
export function buildRound({ words, length, random = Math.random, audio = true }) {
  const pool = shuffle(words, random)
  const wanted = length == null ? pool.length : Math.min(length, pool.length)
  const picked = pool.slice(0, Math.max(0, wanted))
  const plan = planModes(picked.length, random)
  return picked.map((entry, index) => ({ ...entry, mode: resolveMode(entry, plan[index], { audio }) }))
}

/* --------------------------------------------------------------- blanks -- */

const VOWELS = ['a', 'e', 'i', 'o', 'u']

// Fallback only. Curated words carry an authored `blank`, because generated
// decoys are non-words a player can eliminate without knowing the spelling.
export function generateDecoys(target) {
  if (target.length === 1) {
    return VOWELS.filter((vowel) => vowel !== target)
  }
  const pool = []
  // Swapping a vowel keeps the chunk pronounceable, so the player has to know
  // the spelling rather than spot the one option that looks like English.
  for (let index = 0; index < target.length; index += 1) {
    if (!VOWELS.includes(target[index])) continue
    for (const vowel of VOWELS) {
      if (vowel !== target[index]) pool.push(target.slice(0, index) + vowel + target.slice(index + 1))
    }
  }
  const last = target[target.length - 1]
  if (!VOWELS.includes(last)) pool.push(target + last)
  pool.push(target.slice(0, -1))
  // Only reached for chunks with no vowel to swap, e.g. 'thm'.
  pool.push(target[0] + target)
  pool.push(target.split('').reverse().join(''))
  return [...new Set(pool)].filter((option) => option && option !== target)
}

export function blankFor(word, random = Math.random) {
  const chunks = word.chunks || []
  const authored = word.blank
  const at = Math.min(authored ? authored.at : Math.max(0, chunks.length - 2), Math.max(0, chunks.length - 1))
  const target = chunks[at]
  const source = authored?.options?.length ? authored.options : generateDecoys(target)
  // Trim decoys *before* adding the target so shuffling can never drop it.
  const decoys = [...new Set(source)].filter((option) => option !== target).slice(0, 2)
  return { at, target, options: shuffle([target, ...decoys], random) }
}

export function blankSentence(sentence, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return sentence.replace(new RegExp(escaped, 'i'), '_____')
}

/* ------------------------------------------------------------- progress -- */

// `practice` marks a second look at a word already missed this trail. It still
// updates that word's record, but it does not touch the streak or the accuracy
// counters — those describe first attempts, and a retry should never feel like
// a way to inflate them or a way to lose a streak twice for one mistake.
export function awardAnswer(progress, word, isCorrect, { mode = null, now = Date.now(), practice = false } = {}) {
  const streak = practice ? progress.streak : (isCorrect ? progress.streak + 1 : 0)
  const xpEarned = practice
    ? (isCorrect ? PRACTICE_XP : 0)
    : (isCorrect ? CORRECT_XP + Math.min(streak, STREAK_BONUS_CAP) : PARTICIPATION_XP)
  const firefliesEarned = practice
    ? (isCorrect ? 1 : 0)
    : (isCorrect ? (streak >= STREAK_FIREFLY_BONUS_AT ? 2 : 1) : 0)

  const previous = progress.mastered[word]
  const missedModes = { ...(previous?.missedModes || {}) }
  if (!isCorrect && mode) missedModes[mode] = (missedModes[mode] || 0) + 1

  const stat = {
    right: (previous?.right || 0) + (isCorrect ? 1 : 0),
    tries: (previous?.tries || 0) + 1,
    // A retry counts here. Getting it right on the second look is exactly the
    // progress review camp is watching for.
    sinceWrong: isCorrect ? (previous?.sinceWrong || 0) + 1 : 0,
    lastSeen: now,
    lastWrong: isCorrect ? previous?.lastWrong || 0 : now,
    missedModes,
  }

  return {
    xpEarned,
    firefliesEarned,
    progress: {
      ...progress,
      xp: progress.xp + xpEarned,
      fireflies: progress.fireflies + firefliesEarned,
      streak,
      bestStreak: Math.max(progress.bestStreak, streak),
      wordsPracticed: progress.wordsPracticed + (practice ? 0 : 1),
      correctAnswers: progress.correctAnswers + (!practice && isCorrect ? 1 : 0),
      mastered: { ...progress.mastered, [word]: stat },
    },
  }
}

export function finishSession(progress) {
  const next = {
    ...progress,
    sessionsCompleted: progress.sessionsCompleted + 1,
    xp: progress.xp + SESSION_BONUS,
  }
  const earned = BADGES.filter((badge) => badge.test(next)).map((badge) => badge.id)
  // Union, never a replacement: a badge already discovered is never taken back.
  return { ...next, badges: [...new Set([...progress.badges, ...earned])] }
}

function normalizeMastered(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [word, stat] of Object.entries(raw)) {
    if (!stat || typeof stat !== 'object') continue
    out[word] = { ...DEFAULT_WORD_STAT, ...stat, missedModes: { ...(stat.missedModes || {}) } }
  }
  return out
}

export function normalizeProgress(saved) {
  if (!saved || typeof saved !== 'object') return newProgress()
  const curve = Number(saved.xpCurve) || 1
  const rawXp = Math.max(0, Number(saved.xp) || 0)
  return {
    ...DEFAULT_PROGRESS,
    ...saved,
    // One-time conversion off the old flat 120-per-level curve.
    xp: curve < XP_CURVE_VERSION ? migrateXp(rawXp) : rawXp,
    xpCurve: XP_CURVE_VERSION,
    badges: Array.isArray(saved.badges) ? [...new Set(saved.badges)] : [],
    mastered: normalizeMastered(saved.mastered),
  }
}

export function loadProgress(storage = localStorage) {
  try {
    return normalizeProgress(JSON.parse(storage.getItem(STORAGE_KEY)))
  } catch {
    return newProgress()
  }
}

export function saveProgress(progress, storage = localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(progress))
    return true
  } catch {
    // Private-mode or quota failures must not take the game down.
    return false
  }
}

export function newProgress() {
  return { ...DEFAULT_PROGRESS, badges: [], mastered: {} }
}
