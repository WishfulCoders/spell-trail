# Spell Trail

A calm, local-first spelling game designed around short practice sessions. Questions
mix listening, recognition, missing-letter, and chunk-building activities, with typing
checkpoints spaced evenly through each trail.

**Live: https://spelltrail.app**

## Where things stand

| | |
| --- | --- |
| Live at | `spelltrail.app`, `www.spelltrail.app`, `spell-trail.wishfulcoders.workers.dev` |
| Cloudflare account | wishfulcoders@gmail.com (`4fb16a58f8142b7c35c5b55fcc17b033`) |
| Zone | `spelltrail.app`, active, TLS auto-renewed by Cloudflare |
| Storage | `BACKUPS` KV (`7b15846d1e874de0b8a787d2d2cb5139`) — optional backups only |
| Repo | `github.com:jlaw9/spell-trail`, committed directly to `main` |

Shipped: six tiers of 64 words, four question modes, in-session correction, up to six
player profiles, parent-entered word lists, firefly-bought companions, backup codes,
per-player session length, voice selection, a levelling curve with a level-up
celebration, and a privacy page.

Known gaps, in the order worth fixing:

- **`Always Use HTTPS` is off** for the zone, so `http://spelltrail.app` serves over
  plaintext instead of redirecting. Fix in Cloudflare → SSL/TLS → Edge Certificates. It
  needs dashboard access; the wrangler token cannot change zone settings.
- **The backup API has no rate limiting.** Codes have roughly 10^11 combinations so
  brute force is impractical, but a Cloudflare rate-limiting rule on `/api/backup/*`
  would close it properly.
- **Review Camp is unbuilt.** `awardAnswer` already records `lastSeen`, `lastWrong`, and
  `missedModes` per word, and nothing consumes them yet — that is the intended input.

## Run it

```bash
npm install
npm run dev
```

Progress lives in the browser with `localStorage`. There are no accounts. The only thing that
leaves the device is an optional backup the grown-up asks for — see **Backup** below.

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

`src/words.js` has six tiers of sixty-four words (384 in total). Every entry carries a sentence,
syllable chunks, two plausible misspellings, and an authored fill-the-gap blank. Decoys
are hand-written because generated ones tend to be non-words a player can eliminate
without knowing the spelling. `src/game.test.js` enforces the invariants — chunks must
rejoin into the word, the sentence must contain it, and every blank must offer three
distinct options including the answer.

Trails draw their words from a pool of sixty-four, so replaying a tier gives a mostly
different set each time. A test fails the build if any word appears in two tiers.

## Players and custom word lists

Up to six players share a device, each with separate progress, badges, companions, and
word lists. A save from the earlier single-player version is migrated into the first
profile rather than discarded. Names and companions are editable under **Players & word
lists**.

Grown-ups can type in a weekly spelling list under **Players & word lists**. Entries are
one per line or comma-separated, and `word: sentence` supplies your own sentence.
`src/wordgen.js` syllabifies each word and generates misspellings so a bare list still
plays every game mode.

## Levelling

`xpForLevelUp(level)` grows geometrically from 350 XP, capped at 2500 so high levels stay
reachable. A default eight-word trail is worth roughly 105-155 XP, so level 2 arrives after two
to three trails and each level after that takes a little longer. Crossing a level pays a firefly
bonus (`levelUpBonus`) rather than XP, so the reward feeds the companion shop instead of
compounding back into the curve it came from. `settleLevelUps` awards every level crossed, so a
single answer that jumps two still pays both.

Players from the old flat 120-XP-per-level curve are converted once on load (`migrateXp`, guarded
by `xpCurve`), keeping both their level and their progress through it. Raw XP numbers change;
the level a child sees does not.

## Fireflies

Fireflies are the soft currency — one per correct answer, two on a streak of three or
more. They buy trail companions (`src/shop.js`), which set the player's icon and are
cosmetic only: nothing in the word list is ever gated behind them. Prices climb from 20
to 600 so the first companion lands in a couple of trails and the last is a long goal.
Three are free, so a new player always starts owning their own icon.

## Words per session

Each player has their own trail length (3, 5, 8, 12, or 16 words), set under **Players & word
lists**. `clampRoundLength` snaps any stored value to one of those, so the typing-checkpoint
plan stays predictable. Missed words still come back for a second look, so a trail can run
slightly longer than the number chosen.

## Voice

Speech uses the browser's built-in synthesis. Browsers pick a default voice that is usually the
oldest and most robotic one installed, so `src/speech.js` scores the available English voices —
rewarding Natural / Neural / Premium / Enhanced / Google voices, penalising Compact and the
macOS novelty voices — and uses the best one. Grown-ups can override the choice, and the
selection is per device rather than per player.

## Backup

There are no accounts. Backing up mints a random four-part code (`otter-sequoia-thicket-3341`)
and stores the profile blob in Cloudflare KV under that code. Entering the code on another
device pulls it down. No email, no password, and nothing identifying beyond the nicknames
already typed in.

The trade-off, stated in the UI: the code is the only key, so anyone holding it can read that
backup. Restoring replaces everything on the device.

A backup can be deleted from the same panel, which removes the only copy held online. Untouched
backups expire after two years.

`worker/index.js` serves `POST /api/backup`, `GET /api/backup/:code`, and
`DELETE /api/backup/:code`, falling through to static assets for everything else. The KV
namespace is bound as `BACKUPS` in `wrangler.jsonc`.

## Privacy

`src/App.jsx` has a `Privacy` view linked from the footer and from the backup panel. It is the
user-facing statement of everything above and **must be updated whenever data handling changes**.
Two things in it are easy to get wrong and worth preserving:

- Some browsers, including Chrome's better voices, synthesise speech in the cloud, so the word
  and its sentence go to the browser maker. That is disclosed.
- Cloudflare Web Analytics is disclosed by name. If it is ever switched off, remove that section
  rather than leaving the page overstating what is collected.

## Fonts

DM Sans and Manrope are self-hosted from `public/fonts` as latin-subset variable fonts
(about 60 kB total, one file per family) and preloaded in `index.html`, so no font network
is involved.

The one third-party request the site makes is the Cloudflare Web Analytics beacon, which
Cloudflare injects at the edge on the `spelltrail.app` zone (it does not appear on
`workers.dev`). It is cookieless and does not identify visitors, and the privacy page says
so explicitly. Turning off Web Analytics auto-install for the zone would remove it — if
that ever happens, update the privacy page to match.

## Checks

```bash
npm test
```

```bash
npm run build
```

## Supporting the project

The heart in the footer and the card in the grown-ups area both point at `SUPPORT_URL`, a single
exported constant at the top of `src/App.jsx`. Change it there and both follow.

## Deploy

The Worker serves the API and the static build together. It lives on the
**wishfulcoders@gmail.com** Cloudflare account (`account_id` is pinned in `wrangler.jsonc`
because that login can see more than one account), alongside the `spelltrail.app` zone.

```bash
npm run deploy
```

To run the API locally (the plain `npm run dev` Vite server has no Worker, so backup calls 404):

```bash
npx wrangler dev
```
