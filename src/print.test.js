import { describe, expect, it } from 'vitest'
import { awardAnswer, newProgress } from './game.js'
import { createPack, createProfile } from './profiles.js'
import { SHEETS, learningWords, listIdFor, printableLists, sheetWords } from './print.js'
import { WORD_TIERS } from './words.js'

const tier = WORD_TIERS[0]

function progressWith(words, { right = true } = {}) {
  let progress = newProgress()
  for (const word of words) {
    progress = awardAnswer(progress, word, right, { mode: 'listen' }).progress
  }
  return progress
}

describe('printable lists', () => {
  it('puts the player\'s own lists before the tiers', () => {
    const profile = { ...createProfile('Maya'), packs: [createPack('Week 3', [{ word: 'otter', sentence: 'An otter.' }])] }
    const lists = printableLists(profile)
    expect(lists[0]).toMatchObject({ kind: 'pack', label: 'Week 3' })
    expect(lists.slice(1).map((list) => list.id)).toEqual(WORD_TIERS.map((entry) => `tier:${entry.id}`))
    expect(lists.slice(1).every((list) => list.grades)).toBe(true)
  })

  it('maps a selection onto a list id, except review camp', () => {
    expect(listIdFor({ kind: 'tier', id: 'basecamp' })).toBe('tier:basecamp')
    expect(listIdFor({ kind: 'pack', id: 'abc' })).toBe('pack:abc')
    expect(listIdFor({ kind: 'review', id: 'review' })).toBeNull()
    expect(listIdFor(null)).toBeNull()
  })

  it('offers every sheet kind with a label and a hint', () => {
    expect(SHEETS.map((sheet) => sheet.id)).toEqual(['practice', 'test', 'list'])
    expect(SHEETS.every((sheet) => sheet.label && sheet.hint)).toBe(true)
  })
})

describe('sheet words', () => {
  const list = { kind: 'tier', words: tier.words }

  it('prints a whole tier when nothing has been met', () => {
    expect(sheetWords(list, newProgress(), { onlyLearning: true })).toHaveLength(tier.words.length)
  })

  it('narrows a tier to the words met but not passed', () => {
    const met = tier.words.slice(0, 3).map((entry) => entry.word)
    const progress = progressWith(met)
    expect(learningWords(progress, tier.words).map((entry) => entry.word)).toEqual(met)
    expect(sheetWords(list, progress, { onlyLearning: true }).map((entry) => entry.word)).toEqual(met)
    expect(sheetWords(list, progress)).toHaveLength(tier.words.length)
  })

  it('never narrows a typed-in list', () => {
    const words = [{ word: 'otter', sentence: 'An otter.' }, { word: 'river', sentence: 'A river.' }]
    const progress = progressWith(['otter'])
    expect(sheetWords({ kind: 'pack', words }, progress, { onlyLearning: true })).toEqual(words)
  })
})
