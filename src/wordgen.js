// Turns a bare word typed by a parent or teacher into an entry rich enough for
// every game mode: syllable chunks for building and fill-the-gap, plausible
// misspellings for listen-and-spot, and a sentence to read it in.
import { generateDecoys } from './game.js'

const VOWELS = 'aeiouy'

export const MAX_PACK_WORDS = 30
export const MAX_WORD_LENGTH = 24

export function cleanWord(raw) {
  return String(raw || '').trim().toLowerCase().replace(/[^a-z'-]/g, '')
}

function isVowel(letter) {
  return VOWELS.includes(letter)
}

// Heuristic English syllable split. It is not a dictionary, so it errs toward
// even, pronounceable pieces — the goal is a fair building task, not phonetic
// truth. Guaranteed to rejoin exactly into the original word.
export function syllabify(word) {
  const letters = word.split('')
  if (letters.length <= 3) return [word]

  // A final consonant + 'le' is its own syllable: pur-ple, lit-tle, ta-ble.
  // The silent-e rule below would otherwise swallow it.
  if (/[^aeiouy]le$/.test(word) && word.length >= 5) {
    return [...syllabify(word.slice(0, -3)), word.slice(-3)]
  }

  // Locate vowel groups.
  const groups = []
  let current = null
  letters.forEach((letter, index) => {
    if (isVowel(letter)) {
      if (current) current.end = index
      else current = { start: index, end: index }
    } else if (current) {
      groups.push(current)
      current = null
    }
  })
  if (current) groups.push(current)
  if (groups.length <= 1) return [word]

  // A trailing silent 'e' does not start its own syllable.
  if (groups.length > 1 && word.endsWith('e') && groups[groups.length - 1].start === letters.length - 1) {
    groups.pop()
  }
  if (groups.length <= 1) return [word]

  const cuts = []
  for (let index = 0; index < groups.length - 1; index += 1) {
    const gapStart = groups[index].end + 1
    const gapEnd = groups[index + 1].start
    const consonants = gapEnd - gapStart
    if (consonants === 0) cuts.push(gapStart)
    else if (consonants === 1) cuts.push(gapStart)
    else cuts.push(gapStart + 1)
  }

  const chunks = []
  let cursor = 0
  for (const cut of cuts) {
    if (cut > cursor) chunks.push(word.slice(cursor, cut))
    cursor = cut
  }
  chunks.push(word.slice(cursor))

  // Fold away any stray one-letter consonant-only piece.
  const merged = []
  for (const chunk of chunks) {
    const previous = merged[merged.length - 1]
    if (previous && (chunk.length === 0 || (chunk.length === 1 && !isVowel(chunk)))) {
      merged[merged.length - 1] = previous + chunk
    } else {
      merged.push(chunk)
    }
  }
  return merged.filter(Boolean)
}

const DOUBLE_ABLE = 'bdfglmnprst'

// Plausible misspellings, in roughly the order children actually make them.
function misspellings(word) {
  const out = []
  const push = (candidate) => {
    if (candidate && candidate !== word && !out.includes(candidate)) out.push(candidate)
  }

  // Undouble a doubled consonant: 'embarrass' -> 'embarass'
  const doubled = word.match(/([bcdfglmnprstz])\1/)
  if (doubled) push(word.replace(doubled[0], doubled[1]))

  // ie / ei transposition: 'friend' -> 'freind'
  if (word.includes('ie')) push(word.replace('ie', 'ei'))
  if (word.includes('ei')) push(word.replace('ei', 'ie'))

  // Double an interior single consonant: 'later' -> 'latter'
  for (let index = 1; index < word.length - 1; index += 1) {
    const letter = word[index]
    if (DOUBLE_ABLE.includes(letter) && word[index - 1] !== letter && word[index + 1] !== letter && isVowel(word[index - 1])) {
      push(word.slice(0, index) + letter + word.slice(index))
      break
    }
  }

  // Swap an unstressed interior vowel: 'calendar' -> 'calender'
  for (let index = 1; index < word.length - 1; index += 1) {
    if (isVowel(word[index]) && !isVowel(word[index + 1])) {
      const swap = word[index] === 'e' ? 'a' : 'e'
      push(word.slice(0, index) + swap + word.slice(index + 1))
      break
    }
  }

  // Drop a silent final 'e', or drop one letter of a vowel digraph.
  if (word.endsWith('e') && word.length > 4) push(word.slice(0, -1))
  const digraph = word.match(/[aeiou]{2}/)
  if (digraph) push(word.replace(digraph[0], digraph[0][0]))

  // Last resort so every word always gets two options.
  push(word + word[word.length - 1])
  push(word.slice(0, -1))
  return out
}

export function buildWordEntry(raw, sentence = '') {
  const word = cleanWord(raw)
  if (!word) return null
  const chunks = syllabify(word)
  const distractors = misspellings(word).slice(0, 2)
  const text = String(sentence || '').trim()
  // The sentence has to contain the word, or the blanked prompt shows nothing.
  const usable = text && new RegExp(`\\b${word}\\b`, 'i').test(text)
  const at = Math.max(0, chunks.length - 2)
  return {
    word,
    sentence: usable ? text : `Can you spell the word ${word}?`,
    chunks,
    distractors,
    blank: { at, options: generateDecoys(chunks[at]).slice(0, 2) },
    custom: true,
  }
}

export function buildPackWords(entries) {
  const seen = new Set()
  const words = []
  for (const entry of entries) {
    const raw = typeof entry === 'string' ? entry : entry?.word
    const cleaned = cleanWord(raw)
    if (!cleaned || cleaned.length > MAX_WORD_LENGTH || seen.has(cleaned)) continue
    const built = buildWordEntry(cleaned, typeof entry === 'string' ? '' : entry?.sentence)
    if (!built) continue
    seen.add(cleaned)
    words.push(built)
    if (words.length >= MAX_PACK_WORDS) break
  }
  return words
}

// Accepts a paste from a school newsletter: newlines, commas, or semicolons.
// Commas stop being separators once the list uses `word: sentence` form, since
// the sentences themselves will contain commas.
export function parseWordList(text) {
  const source = String(text || '')
  const separators = source.includes(':') ? /[\n;]+/ : /[\n,;]+/
  return source
    .split(separators)
    .map((part) => part.trim())
    .filter(Boolean)
}

// `rocket` or `rocket: The rocket lifted off at dawn.`
export function parseEntries(text) {
  return parseWordList(text).map((line) => {
    const split = line.indexOf(':')
    if (split === -1) return { word: line, sentence: '' }
    return { word: line.slice(0, split), sentence: line.slice(split + 1).trim() }
  })
}
