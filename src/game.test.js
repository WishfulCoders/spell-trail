import { describe, expect, it } from 'vitest'
import { awardAnswer, DEFAULT_PROGRESS, finishSession, levelFromXp, makeRound } from './game.js'
import { WORD_TIERS } from './words.js'

describe('Spell Trail progress', () => {
  it('awards more than participation XP for a correct answer', () => {
    expect(awardAnswer(DEFAULT_PROGRESS, 'friend', true).xp).toBeGreaterThan(
      awardAnswer(DEFAULT_PROGRESS, 'friend', false).xp,
    )
  })

  it('resets a streak without erasing the best streak', () => {
    const progress = { ...DEFAULT_PROGRESS, streak: 4, bestStreak: 4 }
    const next = awardAnswer(progress, 'friend', false)
    expect(next.streak).toBe(0)
    expect(next.bestStreak).toBe(4)
  })

  it('includes two typing questions in an eight-word trail', () => {
    const round = makeRound(WORD_TIERS[0], () => 0.5)
    expect(round.filter((item) => item.mode === 'type')).toHaveLength(2)
  })

  it('unlocks the first badge after a completed session', () => {
    expect(finishSession(DEFAULT_PROGRESS).badges).toContain('first-step')
  })

  it('advances a level every 120 XP', () => {
    expect(levelFromXp(0)).toBe(1)
    expect(levelFromXp(120)).toBe(2)
  })
})
