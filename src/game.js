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
  // Whole-word recall answers since the last miss. This is what retires a word from review
  // camp, and it is why the total `right` count cannot do that job: a word can
  // be right ten times and still have been missed this morning.
  sinceWrong: 0,
  lastSeen: 0,
  lastWrong: 0,
  missedModes: {},
  // Distinct days on which the word was typed correctly from hearing alone,
  // on a first attempt. Memory trail does not count: the word was on screen a
  // moment earlier, so it proves holding, not spelling.
  typedDays: [],
  // When the word was last typed right in a pass-off trail, or ticked by a
  // grown-up on a written test. Zero until then, and cleared by any later miss.
  passedOff: 0,
  // When a grown-up last ticked it on a written test. Informational.
  written: 0,
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

/* -------------------------------------------------------------- mastery -- */

// Every word climbs the same ladder. Getting a supporting question right is
// not spelling, so it cannot pass a word off; only typing it from the spoken
// word alone moves the top rungs, and only a pass-off trail (or a grown-up
// ticking a written test) reaches the last one. A later first-attempt miss
// knocks the word straight off the top rung again, because "passed off" has
// to keep meaning "can spell it today".
export const MASTERY = ['new', 'seen', 'practicing', 'spelled', 'passed']

export function masteryOf(progress, word) {
  const stat = progress?.mastered?.[word]
  if (!stat || !(stat.tries > 0)) return 'new'
  if (stat.passedOff) return 'passed'
  if ((stat.typedDays || []).length >= 1) return 'spelled'
  if ((stat.right || 0) > 0) return 'practicing'
  return 'seen'
}

export function masteryAtLeast(progress, word, level) {
  return MASTERY.indexOf(masteryOf(progress, word)) >= MASTERY.indexOf(level)
}

export function isPassed(progress, word) {
  return masteryOf(progress, word) === 'passed'
}

// `words` is a tier or pack word list — [{ word, ... }].
export function passedCount(progress, words) {
  return words.reduce((total, entry) => total + (isPassed(progress, entry.word) ? 1 : 0), 0)
}

export function masteryCounts(progress, words) {
  const counts = Object.fromEntries(MASTERY.map((level) => [level, 0]))
  for (const entry of words) counts[masteryOf(progress, entry.word)] += 1
  return counts
}

// A list can be passed off once every word on it has been typed right at least
// once in an ordinary trail. Words already passed do not need to be re-earned.
export function canPassOff(progress, words) {
  return words.length > 0 && words.every((entry) => masteryAtLeast(progress, entry.word, 'spelled'))
}

// The hardest question a word should be asked, given how well the player
// knows it. A word never met before is only ever recognised or completed; the
// second meeting can be built from pieces; a word answered right before can be
// shown then hidden; and only a word answered right twice is typed from sound
// alone. This is what stops a child's first encounter with a word being a
// blank text box.
export function modeCeiling(progress, word) {
  const stat = progress?.mastered?.[word]
  const right = stat?.right || 0
  if (!stat || !(stat.tries > 0)) return 'missing'
  if (right === 0) return 'chunks'
  if (right === 1) return 'memory'
  return 'type'
}

export function capMode(wanted, ceiling) {
  return MODE_DIFFICULTY.indexOf(wanted) > MODE_DIFFICULTY.indexOf(ceiling) ? ceiling : wanted
}

const DAY_MS = 86_400_000
export function dayOf(now) {
  return Math.floor(now / DAY_MS)
}

// A grown-up marking the written test. Ticked means the word is passed off
// and leaves review camp; unticked means it was misspelled on paper, which is
// a miss like any other and sends it back to camp.
export function markWritten(progress, word, passed, { now = Date.now() } = {}) {
  const previous = progress.mastered[word] || DEFAULT_WORD_STAT
  const stat = passed
    ? {
      ...previous,
      passedOff: now,
      written: now,
      sinceWrong: Math.max(previous.sinceWrong || 0, REVIEW_CLEAR),
      lastSeen: now,
      tries: (previous.tries || 0) + 1,
      right: (previous.right || 0) + 1,
    }
    : {
      ...previous,
      passedOff: 0,
      written: 0,
      sinceWrong: 0,
      lastWrong: now,
      lastSeen: now,
      tries: (previous.tries || 0) + 1,
      missedModes: { ...(previous.missedModes || {}), written: ((previous.missedModes || {}).written || 0) + 1 },
    }
  return { ...progress, mastered: { ...progress.mastered, [word]: stat } }
}

/* ---------------------------------------------------------- review camp -- */

// Whole-word recall answers needed to walk a word back out of review camp. One is not
// enough: a lucky guess on a three-option question should not clear a word the
// child could not spell yesterday.
export const REVIEW_CLEAR = 2

// Only a recall answer walks a word out of camp, so a review trail has to ask
// for recall far more often than an ordinary trail — otherwise the exit is
// gated on questions the trail hardly ever asks, and camp never drains. Half:
// enough that a word meets a recall question most trails, while the supported
// modes still carry the words the child is stuck on.
export const REVIEW_RECALL_SHARE = 0.5

export function needsReview(progress, word) {
  const stat = progress?.mastered?.[word]
  if (!stat || !stat.lastWrong) return false
  return (stat.sinceWrong || 0) < REVIEW_CLEAR
}

// Every word the player has missed and not yet walked back, neediest first:
// fewest recall answers since the miss, then the most recent mistake. Callers
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

// Recall checkpoints land at roughly evenly spaced positions, ending on the
// last question. At length 8 the anchors are indices 3 and 7; each one except
// the last may drift a slot either way so two trails do not feel identical,
// and the two recall modes are dealt in a random order rather than always
// typing first.
export function planModes(length, random = Math.random, { recallShare = RECALL_SHARE } = {}) {
  if (length <= 0) return []
  const checkpoints = Math.min(length, Math.max(1, Math.round(length * recallShare)))
  const recall = shuffle(RECALL_MODES, random)
  const checkpointAt = new Map()
  for (let slot = 1; slot <= checkpoints; slot += 1) {
    const anchor = Math.round((slot * length) / checkpoints) - 1
    const drift = slot === checkpoints ? 0 : Math.floor(random() * 3) - 1
    let index = Math.min(length - 1, Math.max(0, anchor + drift))
    while (checkpointAt.has(index) && index < length - 1) index += 1
    checkpointAt.set(index, recall[(slot - 1) % recall.length])
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

// Ordering for a tier trail. Up to half the trail is revision: words the
// player has met but not passed off, longest-unseen first, so a word does not
// vanish into a pool of sixty-four for a month. The rest is new ground. Words
// already passed off are only drawn when nothing else is left.
function orderByNeed(shuffled, wanted, progress) {
  const revision = shuffled
    .filter((entry) => !['new', 'passed'].includes(masteryOf(progress, entry.word)))
    .sort((left, right) => (progress.mastered[left.word]?.lastSeen || 0) - (progress.mastered[right.word]?.lastSeen || 0))
  const fresh = shuffled.filter((entry) => masteryOf(progress, entry.word) === 'new')
  const passed = shuffled.filter((entry) => masteryOf(progress, entry.word) === 'passed')
  const revisionShare = Math.ceil(wanted / 2)
  return [...revision.slice(0, revisionShare), ...fresh, ...revision.slice(revisionShare), ...passed]
}

// Word selection, round length, and mode assignment are independent inputs so
// a round can be built from a tier, a review queue, a daily seed, or a custom
// word pack without changing anything below this line.
//
// `progress` lets the round respect each word's ceiling (see `modeCeiling`)
// and hand the recall checkpoints to words that are ready for them. Without
// it every word is treated as fully known, which is what the tests want.
// `passOff` builds the pass-off trail: every word, typed from sound alone.
export function buildRound({
  words, length, random = Math.random, audio = true, recallShare = RECALL_SHARE, progress = null, passOff = false, priority = false,
}) {
  if (passOff) {
    return shuffle(words, random).map((entry) => ({ ...entry, mode: resolveMode(entry, 'type', { audio }), passOff: true }))
  }
  const shuffled = shuffle(words, random)
  const wanted = length == null ? shuffled.length : Math.min(length, shuffled.length)
  // Take the front of a list that arrives already ordered by need, otherwise
  // sample with a bias towards words the player has not passed off yet.
  const pool = priority ? words : (progress ? orderByNeed(shuffled, wanted, progress) : shuffled)
  const picked = pool.slice(0, Math.max(0, wanted))
  const plan = planModes(picked.length, random, { recallShare })
  if (!progress) return picked.map((entry, index) => ({ ...entry, mode: resolveMode(entry, plan[index], { audio }) }))

  // Give recall slots to the words that can take them: a checkpoint asked of a
  // word the child met thirty seconds ago would be capped down to a supporting
  // question anyway, so swap in a word that is ready to be typed.
  const ready = picked.filter((entry) => capMode('type', modeCeiling(progress, entry.word)) === 'type')
  const rest = picked.filter((entry) => !ready.includes(entry))
  const arranged = new Array(picked.length)
  plan.forEach((mode, index) => {
    if (RECALL_MODES.includes(mode) && ready.length) arranged[index] = ready.shift()
  })
  const leftovers = shuffle([...ready, ...rest], random)
  for (let index = 0; index < arranged.length; index += 1) {
    if (!arranged[index]) arranged[index] = leftovers.shift()
  }
  return arranged.map((entry, index) => ({
    ...entry,
    mode: resolveMode(entry, capMode(plan[index], modeCeiling(progress, entry.word)), { audio }),
  }))
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
//
// `unknown` marks an "I don't know" — a fair thing to ask for, but not an
// attempt, so it earns nothing. Otherwise tapping it eight times would be the
// quickest trail in the app.
//
// `passOff` marks an answer inside a pass-off trail: a correct one stamps the
// word as passed off. Any first-attempt miss, in any mode, clears that stamp.
export function awardAnswer(progress, word, isCorrect, {
  mode = null, now = Date.now(), practice = false, unknown = false, passOff = false,
} = {}) {
  const streak = practice ? progress.streak : (isCorrect ? progress.streak + 1 : 0)
  const xpEarned = practice
    ? (isCorrect ? PRACTICE_XP : 0)
    : (isCorrect ? CORRECT_XP + Math.min(streak, STREAK_BONUS_CAP) : (unknown ? 0 : PARTICIPATION_XP))
  const firefliesEarned = practice
    ? (isCorrect ? 1 : 0)
    : (isCorrect ? (streak >= STREAK_FIREFLY_BONUS_AT ? 2 : 1) : 0)

  const previous = progress.mastered[word]
  const missedModes = { ...(previous?.missedModes || {}) }
  if (!isCorrect && mode) missedModes[mode] = (missedModes[mode] || 0) + 1

  const typedDays = [...(previous?.typedDays || [])]
  if (isCorrect && !practice && mode === 'type' && !typedDays.includes(dayOf(now))) typedDays.push(dayOf(now))

  const stat = {
    right: (previous?.right || 0) + (isCorrect ? 1 : 0),
    tries: (previous?.tries || 0) + 1,
    // Review Camp promises spelling, not lucky multiple-choice picks. Only the
    // two whole-word recall modes move a missed word toward leaving camp.
    sinceWrong: isCorrect
      ? (previous?.sinceWrong || 0) + (RECALL_MODES.includes(mode) ? 1 : 0)
      : 0,
    lastSeen: now,
    lastWrong: isCorrect ? previous?.lastWrong || 0 : now,
    missedModes,
    typedDays: typedDays.slice(-10),
    passedOff: isCorrect ? (passOff && mode === 'type' ? now : previous?.passedOff || 0) : (practice ? previous?.passedOff || 0 : 0),
    written: isCorrect || practice ? previous?.written || 0 : 0,
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
    out[word] = {
      ...DEFAULT_WORD_STAT,
      ...stat,
      missedModes: { ...(stat.missedModes || {}) },
      typedDays: Array.isArray(stat.typedDays) ? stat.typedDays.filter(Number.isFinite) : [],
    }
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
