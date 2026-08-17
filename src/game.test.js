import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROGRESS,
  ROUND_LENGTH,
  awardAnswer,
  blankFor,
  blankSentence,
  buildRound,
  easierMode,
  finishSession,
  generateDecoys,
  levelFromXp,
  loadProgress,
  makeRetry,
  planModes,
  resolveMode,
  saveProgress,
  supportedModes,
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

  it('advances a level every 120 XP', () => {
    expect(levelFromXp(0)).toBe(1)
    expect(levelFromXp(120)).toBe(2)
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
    expect(loaded.mastered.friend).toEqual({ right: 1, tries: 2, lastSeen: 0, lastWrong: 0, missedModes: {} })
    expect(loaded.badges).toEqual([])
  })

  it('reports failure instead of throwing when storage is unavailable', () => {
    const throwing = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    expect(saveProgress(DEFAULT_PROGRESS, throwing)).toBe(false)
  })
})

describe('round building', () => {
  it('keeps two typing checkpoints in an eight-word trail', () => {
    const round = buildRound({ words: WORD_TIERS[0].words, length: ROUND_LENGTH, random: () => 0.5 })
    expect(round.filter((item) => item.mode === 'type')).toHaveLength(2)
  })

  it('still includes a typing checkpoint in a three-word trail', () => {
    const plan = planModes(3, () => 0.5)
    expect(plan).toHaveLength(3)
    expect(plan.filter((mode) => mode === 'type')).toHaveLength(1)
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

  it('falls back to typing when a word carries no chunks or distractors', () => {
    const bare = { word: 'spelling', sentence: 'Spelling takes practice.' }
    expect(supportedModes(bare)).toEqual(['type'])
    expect(resolveMode(bare, 'chunks')).toBe('type')
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
    expect(easierMode(word, 'type')).toBe('chunks')
    expect(easierMode(word, 'chunks')).toBe('missing')
    expect(easierMode(word, 'missing')).toBe('listen')
  })

  it('keeps the easiest mode easiest rather than looping to typing', () => {
    expect(easierMode(word, 'listen')).not.toBe('type')
  })

  it('skips modes the word cannot support', () => {
    const bare = { word: 'spelling', sentence: 'Spelling takes practice.', distractors: ['speling', 'spellling'] }
    expect(easierMode(bare, 'type')).toBe('listen')
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
