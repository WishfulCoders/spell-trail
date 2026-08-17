# Spell Trail

A calm, local-first spelling game designed around short practice sessions. Questions
mix listening, recognition, missing-letter, and chunk-building activities, with typing
checkpoints spaced evenly through each trail.

## Run it

```bash
npm install
npm run dev
```

Everything is stored in the browser with `localStorage`. No account or backend.

## How a trail is built

`src/game.js` owns the round. Three inputs are independent, so a new game mode only
has to supply one of them:

- **Words** — `buildRound({ words })` takes any list: a tier, a custom pack, or a
  future review queue.
- **Length** — `length` clamps to the pool, so a five-word pack makes a five-word trail.
- **Modes** — `planModes(length)` spaces typing checkpoints evenly and rotates the
  other modes. At length 8 that is two typing questions; at length 3 it is one.

Each mode declares what a word must carry (`MODE_REQUIREMENTS`). A word with no
syllable chunks cannot be a build-the-word question, so `resolveMode` falls back
rather than rendering something unanswerable. The same guard covers devices with no
speech voices, where typing questions are swapped out and written clues shown instead.

`src/modes.jsx` holds the per-mode React components and the registry that maps a mode
name to its component and copy.

## Correction

A missed word comes back before the trail ends, once, one step easier than the mode it
was missed in (`easierMode` walks `MODE_DIFFICULTY` down from typing toward
listen-and-choose). Second looks are scored as practice: they update that word's record
for later review, but they do not move the streak or the accuracy counters, which
describe first attempts only.

## Word data

`src/words.js` has six tiers of thirty-two words. Every entry carries a sentence,
syllable chunks, two plausible misspellings, and an authored fill-the-gap blank. Decoys
are hand-written because generated ones tend to be non-words a player can eliminate
without knowing the spelling. `src/game.test.js` enforces the invariants — chunks must
rejoin into the word, the sentence must contain it, and every blank must offer three
distinct options including the answer.

Trails draw eight words from a pool of thirty-two, so replaying a tier gives a mostly
different set each time.

## Players and custom word lists

Up to six players share a device, each with separate progress, badges, and word lists.
A save from the earlier single-player version is migrated into the first profile rather
than discarded.

Grown-ups can type in a weekly spelling list under **Players & word lists**. Entries are
one per line or comma-separated, and `word: sentence` supplies your own sentence.
`src/wordgen.js` syllabifies each word and generates misspellings so a bare list still
plays every game mode.

## Checks

```bash
npm test
```

```bash
npm run build
```

## Deploy

The production build is served by Cloudflare Workers Static Assets.

```bash
npm run deploy
```
