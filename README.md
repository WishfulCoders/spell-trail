<div align="center">

# 🏕️ Spell Trail

**A calm, local-first spelling game built for short practice sessions.**

[**Play free at spelltrail.app →**](https://spelltrail.app)

[About the project](https://about.spelltrail.app) ·
[Privacy](https://spelltrail.app) ·
[A Wishful Coders app](https://wishfulcoders.com)

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-e56f3d.svg)](./LICENSE)
[![Commercial license available](https://img.shields.io/badge/commercial%20license-available-f1bd4a.svg)](./COMMERCIAL-LICENSE.md)
![No accounts](https://img.shields.io/badge/accounts-none-74ad82.svg)
![Runs offline](https://img.shields.io/badge/data-stays%20on%20device-74ad82.svg)

</div>

---

Most spelling apps are a worksheet with a progress bar bolted on. Spell Trail is built
around a different idea: a **trail** of eight or so words that takes about five minutes,
asks for each word in a way that suits it, and quietly brings back the ones that were
missed until they stick.

No accounts, no ads, no sign-up wall. A child's progress lives in their own browser, and
the only thing that ever leaves the device is a backup a grown-up explicitly asks for.

## What's in it

- **Five question modes.** Listen and spot the right spelling, fill the missing syllable
  chunk, build the word from its chunks, and two ways of recalling the whole word — a
  typing checkpoint, and *memory trail*, which flashes the word and asks for it back from
  memory.
- **Recall checkpoints, spaced.** Every trail spaces its whole-word questions evenly and
  alternates between the two recall modes, so each trail asks for a word twice in two
  different ways instead of clustering the hard ones at the end.
- **Review camp.** A missed word joins review camp immediately and only leaves after two
  clean answers — because a word can be right ten times and still have been missed this
  morning. The neediest words come up first.
- **Correction inside the trail.** A missed word comes back before the trail ends, one
  step easier than the mode that caught it. Second looks count towards review but never
  towards the streak, so the accuracy number stays honest.
- **384 hand-authored words** across six tiers. Every word carries a sentence, syllable
  chunks, two *plausible* misspellings, and a fill-the-gap blank. The decoys are written
  by hand, because generated ones tend to be non-words a child can rule out without
  knowing the spelling.
- **Bring your own list.** A grown-up can paste in this week's school spelling list and
  it plays every game mode — the app syllabifies each word and generates its decoys.
- **Up to six players** on one device, each with their own progress, badges, word lists,
  trail length, and companion.
- **Fireflies and companions.** One firefly per correct answer, two on a streak. They buy
  cosmetic trail companions — nothing in the word list is ever locked behind them.
- **Accessible by default.** 44px touch targets, visible focus rings, right/wrong marked
  with a glyph as well as a colour, `prefers-reduced-motion` respected, and every mode
  has a written fallback for devices with no speech voices.

## Privacy, in one paragraph

There are no accounts and no analytics beyond Cloudflare's cookieless Web Analytics,
which is disclosed by name in the app. Progress is `localStorage` on the device. Backup
is opt-in: it mints a random four-part code like `otter-sequoia-thicket-3341`, stores the
profile blob under that code, and the code is the only key — anyone holding it can read
that backup, which the UI says plainly. Backups can be deleted from the same panel and
expire after two years. Some browsers synthesise speech in the cloud, so the word and its
sentence go to the browser maker; that's disclosed too. The fonts are self-hosted so even
they don't phone home.

## Running it locally

```bash
npm install
npm run dev
```

That's a plain Vite dev server, which is everything except the backup API — and the app
is fully playable without it, since backups are the only thing that talks to a server.

To run the Cloudflare Worker that serves the API too, you'll need a KV namespace of your
own. The committed `wrangler.jsonc` ships with a placeholder rather than our production
IDs, so a clone can only ever touch your own Cloudflare account:

```bash
npx wrangler kv namespace create BACKUPS   # once — paste the id into wrangler.jsonc
npx wrangler dev
```

Tests and a production build:

```bash
npm test
npm run build
```

## How it's built

| | |
| --- | --- |
| **App** | React 18 + Vite, no router, no state library |
| **Backend** | One Cloudflare Worker (`worker/index.js`) — three endpoints, all for backups |
| **Storage** | `localStorage` on device; Cloudflare KV for opt-in backup blobs |
| **Speech** | The browser's own `SpeechSynthesis`, with voice scoring in `src/speech.js` |
| **Tests** | Vitest, including invariant tests over all 384 words |
| **Landing site** | One hand-written HTML file in `site/`, on GitHub Pages |

The interesting part is `src/game.js`. A round has three independent inputs — the word
list, the length, and the mode plan — so a new game mode only has to supply one of them,
and each mode declares what a word must carry (`MODE_REQUIREMENTS`). A word with no
syllable chunks can't be a build-the-word question, so the planner steps *down* a
difficulty ladder rather than rendering something unanswerable. The same guard is what
makes the app work on a device with no speech voices at all.

[CLAUDE.md](./CLAUDE.md) has the full architecture notes, the design reasoning behind
review camp and the XP curve, and the deployment/ops detail.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). New words for the
tiers, new question modes, and accessibility fixes are all especially useful. Because the
project is dual-licensed, contributors are asked to agree to the [CLA](./CLA.md); it's a
one-time thing.

Found a security issue? [SECURITY.md](./SECURITY.md) has the disclosure address.

## License

Spell Trail is **dual-licensed**:

- **[AGPL-3.0](./LICENSE)** — free to use, study, modify, and share. If you distribute a
  derived version, or run a modified version as a network service, you publish your
  source too.
- **[Commercial license](./COMMERCIAL-LICENSE.md)** — for building a closed-source
  product on this code, or hosting it without publishing your source.
  <licensing@wishfulcoders.com>

The **name and branding are not open source.** "Spell Trail" and "Wishful Coders" are
trademarks; the license grants you rights to the code, not to the brand. Fork it, ship
it, just don't call it Spell Trail.

<div align="center">

---

A **[Wishful Coders](https://wishfulcoders.com)** app · © Wishful Coders LLC

</div>
