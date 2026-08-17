import { describe, expect, it } from 'vitest'
import { blankFor, blankSentence, buildRound, generateDecoys, supportedModes } from './game.js'
import { MAX_PACK_WORDS, buildPackWords, buildWordEntry, cleanWord, parseWordList, syllabify } from './wordgen.js'
import {
  MAX_NAME_LENGTH,
  MAX_PROFILES,
  PROFILE_STORAGE_KEY,
  activeProfile,
  addProfile,
  createPack,
  createProfile,
  emptyStore,
  loadStore,
  removeProfile,
  renameProfile,
  updateProfile,
} from './profiles.js'
import {
  COMPANIONS,
  buyCompanion,
  equipCompanion,
  nextCompanion,
  ownedCompanions,
  ownsCompanion,
} from './shop.js'
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

describe('firefly shop', () => {
  function withFireflies(count) {
    const profile = createProfile('Ada', 0)
    return { ...profile, progress: { ...profile.progress, fireflies: count } }
  }

  it('starts with the free companions and nothing else', () => {
    const profile = withFireflies(0)
    expect(ownedCompanions(profile).every((item) => item.cost === 0)).toBe(true)
    expect(ownedCompanions(profile).length).toBeLessThan(COMPANIONS.length)
  })

  it('gives every player a companion they already own as their icon', () => {
    for (let index = 0; index < 6; index += 1) {
      const profile = createProfile('', index)
      expect(ownsCompanion(profile, profile.avatar), `player ${index} starts locked`).toBe(true)
    }
  })

  it('spends fireflies and equips what was bought', () => {
    const paid = COMPANIONS.find((item) => item.cost > 0)
    const { profile, error } = buyCompanion(withFireflies(paid.cost + 5), paid.id)
    expect(error).toBeNull()
    expect(profile.progress.fireflies).toBe(5)
    expect(profile.avatar).toBe(paid.id)
    expect(ownsCompanion(profile, paid.id)).toBe(true)
  })

  it('refuses a purchase the player cannot afford, leaving fireflies untouched', () => {
    const paid = COMPANIONS.find((item) => item.cost > 0)
    const before = withFireflies(paid.cost - 1)
    const { profile, error } = buyCompanion(before, paid.id)
    expect(error).toBe('fireflies')
    expect(profile.progress.fireflies).toBe(paid.cost - 1)
    expect(ownsCompanion(profile, paid.id)).toBe(false)
  })

  it('never charges twice for the same companion', () => {
    const paid = COMPANIONS.find((item) => item.cost > 0)
    const first = buyCompanion(withFireflies(paid.cost * 3), paid.id).profile
    const second = buyCompanion(first, paid.id)
    expect(second.error).toBe('owned')
    expect(second.profile.progress.fireflies).toBe(first.progress.fireflies)
  })

  it('costs nothing to equip something already owned', () => {
    const profile = withFireflies(40)
    const free = ownedCompanions(profile).find((item) => item.id !== profile.avatar)
    const next = equipCompanion(profile, free.id)
    expect(next.avatar).toBe(free.id)
    expect(next.progress.fireflies).toBe(40)
  })

  it('will not equip a companion the player has not unlocked', () => {
    const profile = withFireflies(0)
    const paid = COMPANIONS.find((item) => item.cost > 0)
    expect(equipCompanion(profile, paid.id).avatar).toBe(profile.avatar)
  })

  it('prices companions in increasing order so the first is reachable', () => {
    const costs = COMPANIONS.map((item) => item.cost)
    expect([...costs].sort((a, b) => a - b)).toEqual(costs)
    expect(COMPANIONS.find((item) => item.cost > 0).cost).toBeLessThanOrEqual(25)
  })

  it('points at the cheapest companion still locked', () => {
    const profile = withFireflies(0)
    expect(nextCompanion(profile).cost).toBeGreaterThan(0)
    const bought = buyCompanion(withFireflies(1000), nextCompanion(profile).id).profile
    expect(nextCompanion(bought).cost).toBeGreaterThan(nextCompanion(profile).cost)
  })
})

describe('editing a player', () => {
  it('renames without touching progress or companions', () => {
    const store = addProfile(emptyStore(), 'Ada')
    const id = store.activeId
    const next = renameProfile(store, id, '  Ada  B  ')
    const profile = next.profiles.find((entry) => entry.id === id)
    expect(profile.name).toBe('Ada B')
    expect(profile.progress).toEqual(store.profiles.find((entry) => entry.id === id).progress)
  })

  it('ignores a blank rename rather than leaving a nameless player', () => {
    const store = addProfile(emptyStore(), 'Ada')
    expect(renameProfile(store, store.activeId, '   ')).toBe(store)
  })

  it('trims an over-long name to the limit', () => {
    const store = emptyStore()
    const next = renameProfile(store, store.activeId, 'x'.repeat(60))
    expect(activeProfile(next).name.length).toBe(MAX_NAME_LENGTH)
  })

  it('restores an emoji icon saved by an older version', () => {
    const owl = COMPANIONS.find((item) => item.id === 'owl')
    const saved = JSON.stringify({ activeId: 'x', profiles: [{ id: 'x', name: 'Ada', avatar: owl.emoji }] })
    expect(activeProfile(loadStore(memoryStorage({ [PROFILE_STORAGE_KEY]: saved }))).avatar).toBe('owl')
  })

  it('drops unknown companion ids from a saved unlock list', () => {
    const saved = JSON.stringify({ activeId: 'x', profiles: [{ id: 'x', name: 'Ada', unlocked: ['bee', 'not-a-thing'] }] })
    expect(activeProfile(loadStore(memoryStorage({ [PROFILE_STORAGE_KEY]: saved }))).unlocked).toEqual(['bee'])
  })

  it('keeps purchases when the store round-trips through storage', () => {
    const bought = buyCompanion({ ...createProfile('Ada', 0), progress: { ...createProfile('Ada', 0).progress, fireflies: 100 } }, 'butterfly').profile
    const saved = JSON.stringify({ activeId: bought.id, profiles: [bought] })
    const loaded = activeProfile(loadStore(memoryStorage({ [PROFILE_STORAGE_KEY]: saved })))
    expect(loaded.unlocked).toContain('butterfly')
    expect(loaded.avatar).toBe('butterfly')
    expect(loaded.progress.fireflies).toBe(80)
  })
})
