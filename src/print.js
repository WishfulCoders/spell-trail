// What a grown-up can put on paper. The app can only hear a spelling typed on a
// screen, and most school lists are tested with a pencil — so every list, typed
// in or built in, prints as a practice sheet, a written test, or a plain word
// list. Nothing here touches progress; ticking a written test off happens in
// `markWritten`, once the paper has been marked.
import { masteryOf } from './game.js'
import { WORD_TIERS } from './words.js'

export const SHEETS = [
  {
    id: 'practice',
    label: 'Practice sheet',
    hint: 'Look at the word, say it, cover it, write it — three tries per word.',
  },
  {
    id: 'test',
    label: 'Written test',
    hint: 'Numbered lines for the child. The words and sentences print on a separate page for the grown-up.',
  },
  {
    id: 'list',
    label: 'Word list',
    hint: 'The words and their sentences, for the fridge or the car.',
  },
]

export const DEFAULT_SHEET = 'practice'

// Every list a sheet can print from: this player's own lists first, since a
// school list is what usually needs a test sheet, then the six built-in tiers.
export function printableLists(profile) {
  return [
    ...profile.packs.map((pack) => ({ id: `pack:${pack.id}`, kind: 'pack', label: pack.name, words: pack.words })),
    ...WORD_TIERS.map((tier) => ({
      id: `tier:${tier.id}`, kind: 'tier', label: tier.label, grades: tier.grades, words: tier.words,
    })),
  ]
}

// Maps a trail-map selection onto a printable list id, so "Print" next to a
// list opens on that list. Review camp is a queue rather than a list and has
// no sheet of its own.
export function listIdFor(selection) {
  if (!selection || selection.kind === 'review') return null
  return `${selection.kind}:${selection.id}`
}

// A tier is sixty-four words, and a sheet of all of them is four pages a child
// has mostly already passed off or never met. The words worth a pencil are the
// ones met in a trail but not yet passed.
export function learningWords(progress, words) {
  return words.filter((entry) => !['new', 'passed'].includes(masteryOf(progress, entry.word)))
}

// A typed-in list always prints whole — it is this week's words, and a sheet
// missing some of them is not that list. A tier narrows to the words still
// being learned when asked and when that leaves something to print.
export function sheetWords(list, progress, { onlyLearning = false } = {}) {
  if (list.kind !== 'tier' || !onlyLearning) return list.words
  const learning = learningWords(progress, list.words)
  return learning.length ? learning : list.words
}
