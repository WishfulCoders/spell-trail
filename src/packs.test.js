import { describe, expect, it } from 'vitest'
import { blankFor, blankSentence, buildRound, generateDecoys, supportedModes } from './game.js'
import { MAX_PACK_WORDS, buildPackWords, buildWordEntry, cleanWord, parseWordList, syllabify } from './wordgen.js'
import {
  MAX_PROFILES,
  PROFILE_STORAGE_KEY,
  activeProfile,
  addProfile,
  createPack,
  emptyStore,
  loadStore,
  removeProfile,
  updateProfile,
} from './profiles.js'
import { STORAGE_KEY as LEGACY_KEY } from './game.js'

function memoryStorage(seed = {}) {
  const data = { ...seed }
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = value },
    data,
  }
}

describe('syllabify', () => {
  const samples = ['rocket', 'butterfly', 'elephant', 'computer', 'wonderful', 'happen', 'purple', 'banana', 'spelling', 'octopus']

  it('always rejoins into the original word', () => {
    for (const word of samples) {
      expect(syllabify(word).join(''), `${word} lost letters`).toBe(word)
    }
  })

  it('splits multi-syllable words into more than one piece', () => {
    for (const word of samples) {
      expect(syllabify(word).length, `${word} was not split`).toBeGreaterThan(1)
    }
  })

  it('leaves very short words whole', () => {
    expect(syllabify('cat')).toEqual(['cat'])
    expect(syllabify('go')).toEqual(['go'])
  })

  it('never emits an empty piece', () => {
    for (const word of [...samples, 'rhythm', 'queue', 'strength', 'aeon']) {
      expect(syllabify(word).every(Boolean), `${word} emitted an empty chunk`).toBe(true)
    }
  })
})

describe('buildWordEntry', () => {
  it('produces an entry every game mode can use', () => {
    const entry = buildWordEntry('rocket')
    expect(supportedModes(entry).sort()).toEqual(['chunks', 'listen', 'missing', 'type'])
  })

  it('gives three distinct blank options including the answer', () => {
    for (const word of ['rocket', 'happen', 'banana', 'spelling', 'wonderful']) {
      const blank = blankFor(buildWordEntry(word))
      expect(new Set(blank.options).size, `${word} duplicate options`).toBe(3)
      expect(blank.options).toContain(blank.target)
    }
  })

  it('generates two distinct distractors that are not the word', () => {
    for (const word of ['rocket', 'friend', 'embarrass', 'believe', 'purple']) {
      const entry = buildWordEntry(word)
      expect(new Set(entry.distractors).size, `${word} duplicate distractors`).toBe(2)
      expect(entry.distractors).not.toContain(word)
    }
  })

  it('keeps a supplied sentence only when it actually contains the word', () => {
    expect(buildWordEntry('rocket', 'The rocket lifted off.').sentence).toBe('The rocket lifted off.')
    expect(buildWordEntry('rocket', 'Something unrelated.').sentence).toContain('rocket')
  })

  it('always yields a sentence the blank prompt can use', () => {
    for (const word of ['rocket', 'banana', 'queue']) {
      expect(blankSentence(buildWordEntry(word).sentence, word)).toContain('_____')
    }
  })

  it('normalizes messy input and rejects empty input', () => {
    expect(cleanWord('  Rocket!  ')).toBe('rocket')
    expect(cleanWord('123')).toBe('')
    expect(buildWordEntry('   ')).toBeNull()
  })

  it('survives a word with regex characters in it', () => {
    expect(() => buildWordEntry('re-do')).not.toThrow()
  })
})

describe('word packs', () => {
  it('parses a pasted list split by newlines, commas, or semicolons', () => {
    expect(parseWordList('rocket, planet\nmoon; star')).toEqual(['rocket', 'planet', 'moon', 'star'])
  })

  it('drops duplicates and blanks', () => {
    const words = buildPackWords(['rocket', 'Rocket', '  ', 'planet'])
    expect(words.map((entry) => entry.word)).toEqual(['rocket', 'planet'])
  })

  it('caps a pack so one paste cannot fill storage', () => {
    const many = Array.from({ length: MAX_PACK_WORDS + 20 }, (_, index) => `word${'a'.repeat(index % 5)}${index}`)
    expect(buildPackWords(many).length).toBeLessThanOrEqual(MAX_PACK_WORDS)
  })

  it('builds a playable round from a custom pack', () => {
    const pack = createPack('Week 3', buildPackWords(['rocket', 'planet', 'comet', 'meteor', 'galaxy']))
    const round = buildRound({ words: pack.words, length: 5 })
    expect(round).toHaveLength(5)
    expect(round.every((item) => item.mode)).toBe(true)
  })

  it('handles a pack of words too short to split into chunks', () => {
    const pack = createPack('Short', buildPackWords(['cat', 'dog', 'sun']))
    const round = buildRound({ words: pack.words, length: 3 })
    expect(round.every((item) => ['listen', 'type'].includes(item.mode))).toBe(true)
  })
})

describe('profile store', () => {
  it('starts with exactly one profile', () => {
    const store = emptyStore()
    expect(store.profiles).toHaveLength(1)
    expect(activeProfile(store).id).toBe(store.activeId)
  })

  it('carries a single-profile save forward instead of discarding it', () => {
    const legacy = JSON.stringify({ xp: 240, wordsPracticed: 30, badges: ['first-step'] })
    const store = loadStore(memoryStorage({ [LEGACY_KEY]: legacy }))
    expect(store.profiles).toHaveLength(1)
    expect(activeProfile(store).progress.xp).toBe(240)
    expect(activeProfile(store).progress.badges).toEqual(['first-step'])
  })

  it('ignores a legacy save that has no progress in it', () => {
    const store = loadStore(memoryStorage({ [LEGACY_KEY]: JSON.stringify({ xp: 0, wordsPracticed: 0 }) }))
    expect(activeProfile(store).progress.xp).toBe(0)
  })

  it('adds kids and switches the active player to the new one', () => {
    const store = addProfile(addProfile(emptyStore(), 'Ada'), 'Ben')
    expect(store.profiles).toHaveLength(3)
    expect(activeProfile(store).name).toBe('Ben')
  })

  it('refuses to add past the profile cap', () => {
    let store = emptyStore()
    for (let index = 0; index < MAX_PROFILES + 3; index += 1) store = addProfile(store, `Kid ${index}`)
    expect(store.profiles).toHaveLength(MAX_PROFILES)
  })

  it('never removes the last profile', () => {
    const store = emptyStore()
    expect(removeProfile(store, store.activeId).profiles).toHaveLength(1)
  })

  it('reassigns the active profile when the active one is removed', () => {
    const store = addProfile(emptyStore(), 'Ada')
    const next = removeProfile(store, store.activeId)
    expect(next.profiles).toHaveLength(1)
    expect(activeProfile(next).id).toBe(next.activeId)
  })

  it('keeps each kid progress and packs separate', () => {
    let store = addProfile(emptyStore(), 'Ada')
    const adaId = store.activeId
    const otherId = store.profiles.find((profile) => profile.id !== adaId).id
    store = updateProfile(store, adaId, (profile) => ({ ...profile, progress: { ...profile.progress, xp: 99 } }))
    expect(store.profiles.find((profile) => profile.id === adaId).progress.xp).toBe(99)
    expect(store.profiles.find((profile) => profile.id === otherId).progress.xp).toBe(0)
  })

  it('recovers from corrupt profile storage', () => {
    const store = loadStore(memoryStorage({ [PROFILE_STORAGE_KEY]: '{not json' }))
    expect(store.profiles).toHaveLength(1)
  })

  it('rebuilds missing fields on a saved profile', () => {
    const saved = JSON.stringify({ activeId: 'x', profiles: [{ id: 'x', name: 'Ada' }] })
    const store = loadStore(memoryStorage({ [PROFILE_STORAGE_KEY]: saved }))
    expect(activeProfile(store).name).toBe('Ada')
    expect(activeProfile(store).progress.mastered).toEqual({})
    expect(activeProfile(store).packs).toEqual([])
  })
})

describe('generated blank options for custom words', () => {
  it('prefers pronounceable vowel swaps over letter-doubling junk', () => {
    // 'roc' used to yield ['ro', 'rroc'] — one of which no child would pick.
    expect(generateDecoys('roc').slice(0, 2)).toEqual(['rac', 'rec'])
    expect(generateDecoys('la').slice(0, 2)).toEqual(['le', 'li'])
  })

  it('still produces two options for a chunk with no vowel', () => {
    expect(generateDecoys('thm').length).toBeGreaterThanOrEqual(2)
    expect(generateDecoys('thm')).not.toContain('thm')
  })

  it('keeps every generated option distinct from the answer', () => {
    for (const chunk of ['roc', 'ket', 'la', 'xy', 'teor', 'i', 'a', 'str', 'ough']) {
      expect(generateDecoys(chunk), `${chunk} leaked the answer`).not.toContain(chunk)
      expect(generateDecoys(chunk).length, `${chunk} too few decoys`).toBeGreaterThanOrEqual(2)
    }
  })
})
