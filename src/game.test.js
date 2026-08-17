import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROGRESS,
  LEVEL_REQUIREMENT_CAP,
  MAX_LEVEL,
  RECALL_MODES,
  REVIEW_CLEAR,
  ROUND_LENGTH,
  XP_CURVE_VERSION,
  awardAnswer,
  blankFor,
  blankSentence,
  buildRound,
  easierMode,
  finishSession,
  generateDecoys,
  levelFromXp,
  levelProgress,
  levelUpBonus,
  loadProgress,
  makeRetry,
  migrateXp,
  newProgress,
  normalizeProgress,
  needsReview,
  passedCount,
  planModes,
  resolveMode,
  reviewWords,
  saveProgress,
  settleLevelUps,
  supportedModes,
  totalXpForLevel,
  xpForLevelUp,
  xpIntoLevel,
  xpToNextLevel,
} from './game.js'
import { WORD_TIERS } from './words.js'

const ALL_WORDS = WORD_TIERS.flatMap((tier) => tier.words)

describe('progress', () => {
  it('awards more than participation XP for a correct answer', () => {
    expect(awardAnswer(DEFAULT_PROGRESS, 'friend', true).xpEarned)
      .toBeGreaterThan(awardAnswer(DEFAULT_PROGRESS, 'friend', false).xpEarned)
  })

  it('reports the same XP it adds, so the UI cannot drift from the ledger', () => {
    const { progress, xpEarned } = awardAnswer({ ...DEFAULT_PROGRESS, streak: 3 }, 'friend', true)
    expect(progress.xp - DEFAULT_PROGRESS.xp).toBe(xpEarned)
  })

  it('resets a streak without erasing the best streak', () => {
    const next = awardAnswer({ ...DEFAULT_PROGRESS, streak: 4, bestStreak: 4 }, 'friend', false).progress
    expect(next.streak).toBe(0)
    expect(next.bestStreak).toBe(4)
  })

  it('records when a word was last missed, and in which mode', () => {
    const { progress } = awardAnswer(DEFAULT_PROGRESS, 'friend', false, { mode: 'type', now: 1000 })
    expect(progress.mastered.friend).toMatchObject({ tries: 1, right: 0, lastSeen: 1000, lastWrong: 1000 })
    expect(progress.mastered.friend.missedModes).toEqual({ type: 1 })
  })

  it('clears lastWrong tracking forward without mutating the previous entry', () => {
    const first = awardAnswer(DEFAULT_PROGRESS, 'friend', false, { mode: 'type', now: 1000 }).progress
    const second = awardAnswer(first, 'friend', true, { mode: 'listen', now: 2000 }).progress
    expect(second.mastered.friend).toMatchObject({ tries: 2, right: 1, lastWrong: 1000, lastSeen: 2000 })
    expect(first.mastered.friend.missedModes).toEqual({ type: 1 })
  })

  it('unlocks the first badge after a completed session', () => {
    expect(finishSession(DEFAULT_PROGRESS).badges).toContain('first-step')
  })

  it('never revokes a badge that was already discovered', () => {
    const earned = { ...DEFAULT_PROGRESS, badges: ['summit-star'] }
    expect(finishSession(earned).badges).toContain('summit-star')
  })

  it('starts at level 1 and reaches level 2 in two to four trails', () => {
    expect(levelFromXp(0)).toBe(1)
    // A default eight-word trail is worth roughly 105-155 XP.
    expect(levelFromXp(155 * 2)).toBe(1)
    expect(levelFromXp(155 * 4)).toBeGreaterThanOrEqual(2)
  })
})

describe('words passed off', () => {
  const words = [{ word: 'said' }, { word: 'they' }, { word: 'what' }]

  it('counts nothing on a fresh profile', () => {
    expect(passedCount(newProgress(), words)).toBe(0)
  })

  it('counts a word once it has been spelled right', () => {
    const progress = awardAnswer(newProgress(), 'said', true).progress
    expect(passedCount(progress, words)).toBe(1)
  })

  it('does not count a word that has only been missed', () => {
    const progress = awardAnswer(newProgress(), 'said', false).progress
    expect(passedCount(progress, words)).toBe(0)
  })

  it('never takes a passed word back after a later mistake', () => {
    const right = awardAnswer(newProgress(), 'said', true).progress
    const thenWrong = awardAnswer(right, 'said', false).progress
    expect(passedCount(thenWrong, words)).toBe(1)
  })

  it('ignores words from other trails', () => {
    const progress = awardAnswer(newProgress(), 'expedition', true).progress
    expect(passedCount(progress, words)).toBe(0)
  })
})

describe('review camp', () => {
  const words = [{ word: 'said' }, { word: 'they' }, { word: 'what' }]
  const missed = (progress, word, now) => awardAnswer(progress, word, false, { mode: 'type', now }).progress
  const right = (progress, word, now) => awardAnswer(progress, word, true, { mode: 'type', now }).progress

  it('is empty for a player who has missed nothing', () => {
    expect(reviewWords(newProgress(), words)).toEqual([])
  })

  it('gathers a word as soon as it is missed', () => {
    const progress = missed(newProgress(), 'said', 1000)
    expect(needsReview(progress, 'said')).toBe(true)
    expect(reviewWords(progress, words).map((entry) => entry.word)).toEqual(['said'])
  })

  it('keeps a word until it has been spelled right twice', () => {
    let progress = missed(newProgress(), 'said', 1000)
    for (let clean = 1; clean < REVIEW_CLEAR; clean += 1) {
      progress = right(progress, 'said', 1000 + clean)
      expect(needsReview(progress, 'said'), `cleared after ${clean} right answers`).toBe(true)
    }
    expect(needsReview(right(progress, 'said', 9000), 'said')).toBe(false)
  })

  it('only lets a whole-word recall answer count towards leaving camp', () => {
    const first = awardAnswer(newProgress(), 'said', false, { mode: 'type', now: 1000 }).progress
    const choiceRetry = awardAnswer(first, 'said', true, { mode: 'chunks', now: 2000, practice: true }).progress
    expect(choiceRetry.mastered.said.sinceWrong).toBe(0)
    const recallRetry = awardAnswer(choiceRetry, 'said', true, { mode: 'memory', now: 3000, practice: true }).progress
    expect(recallRetry.mastered.said.sinceWrong).toBe(1)
  })

  it('sends a word back to camp when it is missed again', () => {
    const cleared = right(right(missed(newProgress(), 'said', 1000), 'said', 2000), 'said', 3000)
    expect(needsReview(cleared, 'said')).toBe(false)
    expect(needsReview(missed(cleared, 'said', 4000), 'said')).toBe(true)
  })

  it('puts the neediest word first, then the freshest mistake', () => {
    let progress = missed(newProgress(), 'said', 1000)
    progress = missed(progress, 'they', 2000)
    progress = missed(progress, 'what', 3000)
    // 'said' has one clean answer behind it, so it needs the least work.
    progress = right(progress, 'said', 4000)
    expect(reviewWords(progress, words).map((entry) => entry.word)).toEqual(['what', 'they', 'said'])
  })

  it('only gathers words from the pool it was given', () => {
    const progress = missed(newProgress(), 'expedition', 1000)
    expect(reviewWords(progress, words)).toEqual([])
  })

  it('ignores a saved profile with no record of when a word was missed', () => {
    const loaded = normalizeProgress({ mastered: { said: { right: 0, tries: 1 } } })
    expect(needsReview(loaded, 'said')).toBe(false)
  })
})

describe('storage', () => {
  function fakeStorage(value) {
    return { getItem: () => value, setItem: () => {} }
  }

  it('falls back to a fresh profile on corrupt data', () => {
    expect(loadProgress(fakeStorage('{not json'))).toMatchObject({ xp: 0, mastered: {} })
  })

  it('backfills fields missing from an older saved profile', () => {
    const saved = JSON.stringify({ xp: 50, mastered: { friend: { right: 1, tries: 2 } } })
    const loaded = loadProgress(fakeStorage(saved))
    expect(loaded.mastered.friend).toEqual({ right: 1, tries: 2, sinceWrong: 0, lastSeen: 0, lastWrong: 0, missedModes: {} })
    expect(loaded.badges).toEqual([])
  })

  it('reports failure instead of throwing when storage is unavailable', () => {
    const throwing = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    expect(saveProgress(DEFAULT_PROGRESS, throwing)).toBe(false)
  })
})

describe('round building', () => {
  it('keeps two recall checkpoints in an eight-word trail, one of each kind', () => {
    const round = buildRound({ words: WORD_TIERS[0].words, length: ROUND_LENGTH, random: () => 0.5 })
    expect(round.filter((item) => item.mode === 'type')).toHaveLength(1)
    expect(round.filter((item) => item.mode === 'memory')).toHaveLength(1)
  })

  it('still includes a recall checkpoint in a three-word trail', () => {
    const plan = planModes(3, () => 0.5)
    expect(plan).toHaveLength(3)
    expect(plan.filter((mode) => RECALL_MODES.includes(mode))).toHaveLength(1)
  })

  it('gives a device with no speech a memory checkpoint instead of a typed one', () => {
    const round = buildRound({ words: WORD_TIERS[0].words, length: ROUND_LENGTH, random: () => 0.5, audio: false })
    expect(round.some((item) => item.mode === 'memory')).toBe(true)
  })

  it('spreads the non-typing modes evenly at full length', () => {
    const plan = planModes(ROUND_LENGTH, () => 0.5)
    for (const mode of ['listen', 'missing', 'chunks']) {
      expect(plan.filter((entry) => entry === mode)).toHaveLength(2)
    }
  })

  it('respects the requested length and never repeats a word', () => {
    const round = buildRound({ words: WORD_TIERS[1].words, length: 3 })
    expect(round).toHaveLength(3)
    expect(new Set(round.map((item) => item.word)).size).toBe(3)
  })

  it('falls back to the recall modes when a word carries no chunks or distractors', () => {
    const bare = { word: 'spelling', sentence: 'Spelling takes practice.' }
    expect(supportedModes(bare)).toEqual(['memory', 'type'])
    // Neither typing nor memory needs authored data, and memory keeps a trail
    // built from bare words from turning into nothing but typing.
    expect(resolveMode(bare, 'chunks')).toBe('memory')
  })

  it('drops typing when the device has no speech', () => {
    const round = buildRound({ words: WORD_TIERS[0].words, length: ROUND_LENGTH, audio: false })
    expect(round.some((item) => item.mode === 'type')).toBe(false)
  })
})

describe('missing-letter blanks', () => {
  it('always offers three distinct options including the answer', () => {
    for (const word of ALL_WORDS) {
      const blank = blankFor(word)
      expect(new Set(blank.options).size, `${word.word} has duplicate options`).toBe(3)
      expect(blank.options, `${word.word} lost its answer`).toContain(blank.target)
    }
  })

  it('blanks a chunk that is actually part of the word', () => {
    for (const word of ALL_WORDS) {
      expect(word.chunks.join(''), `${word.word} chunks do not spell the word`).toBe(word.word)
      expect(word.chunks[blankFor(word).at]).toBeTruthy()
    }
  })

  it('generates at least two usable decoys for a palindromic chunk', () => {
    // 'mem' reversed is 'mem' — the old generator collapsed to a coin flip here.
    expect(generateDecoys('mem').length).toBeGreaterThanOrEqual(2)
    expect(generateDecoys('mem')).not.toContain('mem')
  })

  it('generates decoys for a single-letter chunk that exclude the answer', () => {
    expect(generateDecoys('i')).not.toContain('i')
    expect(generateDecoys('i').length).toBeGreaterThanOrEqual(2)
  })

  it('varies the blanked chunk rather than always taking the same position', () => {
    const positions = new Set(ALL_WORDS.map((word) => blankFor(word).at))
    expect(positions.size).toBeGreaterThan(1)
  })
})

describe('sentence blanking', () => {
  it('hides the word in every curated sentence', () => {
    for (const word of ALL_WORDS) {
      const blanked = blankSentence(word.sentence, word.word)
      expect(blanked, `${word.word} not found in its sentence`).toContain('_____')
      expect(blanked.toLowerCase()).not.toContain(word.word)
    }
  })

  it('does not throw on a word containing regex characters', () => {
    expect(() => blankSentence('That costs $5 (roughly).', '$5 (roughly)')).not.toThrow()
    expect(blankSentence('That costs $5 (roughly).', '$5 (roughly)')).toBe('That costs _____.')
  })
})

describe('word data integrity', () => {
  it('covers six tiers with sixty-four words each', () => {
    expect(WORD_TIERS).toHaveLength(6)
    for (const tier of WORD_TIERS) {
      expect(tier.words.length, `${tier.id} word count`).toBe(64)
      expect(tier.icon, `${tier.id} icon`).toBeTruthy()
    }
  })

  it('gives every word two distinct distractors that are not the word', () => {
    for (const word of ALL_WORDS) {
      expect(word.distractors, `${word.word} distractor count`).toHaveLength(2)
      expect(new Set(word.distractors).size, `${word.word} duplicate distractors`).toBe(2)
      expect(word.distractors, `${word.word} distractor equals answer`).not.toContain(word.word)
    }
  })

  it('never repeats a word across tiers', () => {
    const seen = new Map()
    const dupes = []
    for (const tier of WORD_TIERS) {
      for (const entry of tier.words) {
        if (seen.has(entry.word)) dupes.push(`${entry.word} (${seen.get(entry.word)} + ${tier.id})`)
        else seen.set(entry.word, tier.id)
      }
    }
    expect(dupes, `duplicated across tiers: ${dupes.join(', ')}`).toEqual([])
  })

  it('uses a unique word within each tier', () => {
    for (const tier of WORD_TIERS) {
      expect(new Set(tier.words.map((word) => word.word)).size, `${tier.id} repeats a word`).toBe(tier.words.length)
    }
  })

  it('draws a varied trail from a tier larger than the round', () => {
    const first = buildRound({ words: WORD_TIERS[1].words, length: ROUND_LENGTH }).map((item) => item.word)
    const second = buildRound({ words: WORD_TIERS[1].words, length: ROUND_LENGTH }).map((item) => item.word)
    expect(first).toHaveLength(ROUND_LENGTH)
    expect(first.join()).not.toBe(second.join())
  })
})

describe('in-session correction', () => {
  const word = { word: 'friend', sentence: 'My friend saved me a seat.', chunks: ['fri', 'end'], distractors: ['freind', 'frend'], blank: { at: 0, options: ['fre', 'fir'] } }

  it('brings a missed word back one step easier', () => {
    expect(easierMode(word, 'type')).toBe('memory')
    expect(easierMode(word, 'memory')).toBe('chunks')
    expect(easierMode(word, 'chunks')).toBe('missing')
    expect(easierMode(word, 'missing')).toBe('listen')
  })

  it('keeps the easiest mode easiest rather than looping to typing', () => {
    expect(easierMode(word, 'listen')).not.toBe('type')
  })

  it('skips modes the word cannot support', () => {
    const bare = { word: 'spelling', sentence: 'Spelling takes practice.', distractors: ['speling', 'spellling'] }
    // No chunks, so building and gap-filling are both out of reach.
    expect(easierMode(bare, 'memory')).toBe('listen')
  })

  it('marks the retry and never repeats the original mode', () => {
    const retry = makeRetry({ ...word, mode: 'type' })
    expect(retry.retry).toBe(true)
    expect(retry.mode).not.toBe('type')
    expect(retry.word).toBe('friend')
  })

  it('does not offer a typing retry on a device with no speech', () => {
    expect(makeRetry({ ...word, mode: 'type' }, { audio: false }).mode).not.toBe('type')
  })

  it('leaves accuracy counters to first attempts only', () => {
    const first = awardAnswer(DEFAULT_PROGRESS, 'friend', false, { mode: 'type' }).progress
    const retry = awardAnswer(first, 'friend', true, { mode: 'chunks', practice: true }).progress
    expect(retry.wordsPracticed).toBe(1)
    expect(retry.correctAnswers).toBe(0)
  })

  it('does not let a retry break or rebuild the streak', () => {
    const onStreak = { ...DEFAULT_PROGRESS, streak: 4, bestStreak: 4 }
    expect(awardAnswer(onStreak, 'friend', false, { practice: true }).progress.streak).toBe(4)
    expect(awardAnswer(onStreak, 'friend', true, { practice: true }).progress.streak).toBe(4)
  })

  it('still records the retry against the word for later review', () => {
    const first = awardAnswer(DEFAULT_PROGRESS, 'friend', false, { mode: 'type', now: 1000 }).progress
    const retry = awardAnswer(first, 'friend', true, { mode: 'chunks', now: 2000, practice: true }).progress
    expect(retry.mastered.friend).toMatchObject({ tries: 2, right: 1, lastSeen: 2000, lastWrong: 1000 })
  })

  it('awards something for a correct retry but nothing for a second miss', () => {
    expect(awardAnswer(DEFAULT_PROGRESS, 'friend', true, { practice: true }).xpEarned).toBeGreaterThan(0)
    expect(awardAnswer(DEFAULT_PROGRESS, 'friend', false, { practice: true }).xpEarned).toBe(0)
  })
})

describe('levelling', () => {
  // A default eight-word trail is worth roughly 105-155 XP.
  const TRAIL_LOW = 105
  const TRAIL_HIGH = 155

  it('needs two to four trails for the first level-up', () => {
    const needed = xpForLevelUp(1)
    expect(needed / TRAIL_HIGH).toBeGreaterThanOrEqual(2)
    expect(needed / TRAIL_LOW).toBeLessThanOrEqual(4)
  })

  it('asks for more XP at every successive level', () => {
    for (let level = 1; level < 12; level += 1) {
      expect(xpForLevelUp(level + 1), `level ${level + 1} should cost more`).toBeGreaterThan(xpForLevelUp(level))
    }
  })

  it('caps the requirement so high levels stay reachable', () => {
    expect(xpForLevelUp(40)).toBeLessThanOrEqual(LEVEL_REQUIREMENT_CAP)
  })

  it('keeps level, progress, and thresholds consistent', () => {
    for (const xp of [0, 1, 349, 350, 351, 752, 5875, 99999]) {
      const level = levelFromXp(xp)
      expect(totalXpForLevel(level), `level start for ${xp}`).toBeLessThanOrEqual(xp)
      expect(xpIntoLevel(xp)).toBe(xp - totalXpForLevel(level))
      expect(levelProgress(xp)).toBeGreaterThanOrEqual(0)
      expect(levelProgress(xp)).toBeLessThanOrEqual(1)
      if (level < MAX_LEVEL) {
        expect(xpIntoLevel(xp) + xpToNextLevel(xp)).toBe(xpForLevelUp(level))
      }
    }
  })

  it('lands exactly on a new level at its threshold', () => {
    for (let level = 2; level <= 10; level += 1) {
      expect(levelFromXp(totalXpForLevel(level))).toBe(level)
      expect(levelFromXp(totalXpForLevel(level) - 1)).toBe(level - 1)
    }
  })

  it('never exceeds the maximum level', () => {
    expect(levelFromXp(Number.MAX_SAFE_INTEGER)).toBe(MAX_LEVEL)
    expect(xpToNextLevel(Number.MAX_SAFE_INTEGER)).toBe(0)
    expect(levelProgress(Number.MAX_SAFE_INTEGER)).toBe(1)
  })

  it('pays a firefly bonus for each level crossed', () => {
    const before = totalXpForLevel(1)
    const after = { ...DEFAULT_PROGRESS, xp: totalXpForLevel(2), fireflies: 5 }
    const { progress, levelUps } = settleLevelUps(before, after)
    expect(levelUps).toHaveLength(1)
    expect(levelUps[0].level).toBe(2)
    expect(progress.fireflies).toBe(5 + levelUpBonus(2))
  })

  it('pays every level when a single answer crosses two', () => {
    const after = { ...DEFAULT_PROGRESS, xp: totalXpForLevel(4), fireflies: 0 }
    const { progress, levelUps } = settleLevelUps(totalXpForLevel(1), after)
    expect(levelUps.map((entry) => entry.level)).toEqual([2, 3, 4])
    expect(progress.fireflies).toBe(levelUpBonus(2) + levelUpBonus(3) + levelUpBonus(4))
  })

  it('pays nothing when no level was crossed', () => {
    const after = { ...DEFAULT_PROGRESS, xp: 40, fireflies: 7 }
    const { progress, levelUps } = settleLevelUps(10, after)
    expect(levelUps).toEqual([])
    expect(progress.fireflies).toBe(7)
  })

  it('gives a bigger bonus at higher levels, then holds steady', () => {
    expect(levelUpBonus(3)).toBeGreaterThan(levelUpBonus(2))
    expect(levelUpBonus(40)).toBe(levelUpBonus(30))
  })
})

describe('xp curve migration', () => {
  it('keeps the level a player already had', () => {
    for (const oldLevel of [1, 2, 3, 5, 9]) {
      const oldXp = (oldLevel - 1) * 120
      expect(levelFromXp(migrateXp(oldXp)), `old level ${oldLevel}`).toBe(oldLevel)
    }
  })

  it('keeps roughly the same progress through the level', () => {
    // Half way through old level 3.
    const migrated = migrateXp(2 * 120 + 60)
    expect(levelFromXp(migrated)).toBe(3)
    expect(levelProgress(migrated)).toBeCloseTo(0.5, 1)
  })

  it('runs once and leaves already-converted profiles alone', () => {
    const once = normalizeProgress({ xp: 240 })
    expect(once.xpCurve).toBe(XP_CURVE_VERSION)
    const twice = normalizeProgress(once)
    expect(twice.xp).toBe(once.xp)
  })

  it('leaves a brand new profile at zero', () => {
    expect(normalizeProgress({}).xp).toBe(0)
    expect(newProgress().xp).toBe(0)
  })
})
