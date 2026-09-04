# Spell Trail — working notes

Internal notes for anyone (human or agent) changing this codebase. The public-facing
description lives in [README.md](./README.md); this file is the "how it actually works and
what to be careful about" companion.

## Where things stand

| | |
| --- | --- |
| Live at | `spelltrail.app`, `www.spelltrail.app`, `spell-trail.wishfulcoders.workers.dev` |
| Landing site | `about.spelltrail.app` (GitHub Pages, from `site/`) |
| Cloudflare account | wishfulcoders@gmail.com — account ID lives in `wrangler.prod.jsonc`, which is gitignored |
| Zone | `spelltrail.app`, active, TLS auto-renewed by Cloudflare |
| Storage | `BACKUPS` KV — optional backups only; namespace ID also in `wrangler.prod.jsonc` |
| Repo | `github.com/wishfulcoders/spell-trail`, public, committed directly to `main` |

Shipped: six tiers of 64 words, five question modes, a five-rung per-word mastery
ladder with a pass-off trail and a written-test check-off, review camp, in-session
correction, an "I don't know" escape on every question, up to six player profiles,
parent-entered word lists, firefly-bought companions, backup codes, per-player
session length, voice selection, a levelling curve with a level-up celebration, and
a privacy page.

Known gaps, in the order worth fixing:

- **`Always Use HTTPS` is off** for the zone, so `http://spelltrail.app` serves over
  plaintext instead of redirecting. Fix in Cloudflare → SSL/TLS → Edge Certificates. It
  needs dashboard access; the wrangler token cannot change zone settings.
- **The backup API has no rate limiting.** Codes have roughly 10^11 combinations so
  brute force is impractical, but a Cloudflare rate-limiting rule on `/api/backup/*`
  would close it properly.
- **`missedModes` is recorded but unused.** `awardAnswer` counts which mode each word
  was missed in. Review camp does not read it yet; weighting a review question towards
  the mode a word keeps failing in is the obvious next use.

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

- **Words** — `buildRound({ words })` takes any list: a tier, a custom pack, or the
  review queue. For a tier, `orderByNeed` puts revision first — words met but not yet
  passed off, longest-unseen first, up to half the trail — then new words, and only
  reaches for already-passed words once nothing else is left. `buildRound({ passOff: true })`
  skips all of that and builds the pass-off trail instead: every word, typed from sound
  alone (see **Mastery**).
- **Length** — `length` clamps to the pool, so a five-word pack makes a five-word trail.
- **Modes** — `planModes(length)` anchors *recall checkpoints* at roughly evenly spaced
  slots ending on the last question; every checkpoint but the last drifts one slot either
  way so two trails don't feel identical, and the two recall modes are dealt in random
  order rather than always typing first. The three supporting modes rotate between
  checkpoints. `buildRound` then caps each word's assigned mode at its `modeCeiling`
  (see **Mastery**) and, before that, swaps recall checkpoints onto words that have
  already reached the ceiling to be typed — a checkpoint landing on a word met thirty
  seconds ago would just get capped back down anyway.

Each mode declares what a word must carry (`MODE_REQUIREMENTS`). A word with no
syllable chunks cannot be a build-the-word question, so `resolveMode` steps down
`MODE_DIFFICULTY` rather than rendering something unanswerable. The same guard covers
devices with no speech voices: typing questions become memory-trail questions, which
need no audio, and written clues are shown instead.

`src/modes.jsx` holds the per-mode React components and the registry that maps a mode
name to its component and copy. Memory trail shows the word for `peekMs(word)` — longer
words get longer, capped at five seconds — then hides it and asks for it typed.

## Mastery

Every word climbs the same ladder, `MASTERY = ['new', 'seen', 'practicing', 'spelled',
'passed']` (`masteryOf`). Getting a supporting question right — listen, fill-the-gap,
build-the-word — is not spelling, so it only carries a word to `practicing`; only typing
it from the spoken word alone, correctly, on a first attempt in an ordinary trail moves
it to `spelled` (`typedDays` records the distinct days this has happened; memory trail
and second looks don't count). `passed` is reached only in a pass-off trail
(`buildRound({ passOff: true })`, scored with `awardAnswer(..., { passOff: true })`) or
by a grown-up ticking a word off on a written test (`markWritten`). There is no
`PASS_THRESHOLD` shortcut any more — a word cannot be passed off by getting lucky once
in an ordinary trail.

Any first-attempt miss, in any mode, knocks a word straight back off `passed` (down to
`new` or wherever its stats land it) — "passed off" has to keep meaning "can spell it
today", not "could once." A track's progress bar can go backwards by design.

`passOffWords(progress, words)` is the list a pass-off trail actually asks: the words not
already `passed`. A word that has been spelled from sound alone has nothing to prove, and
retesting it could only knock it back down, so it is left out.
`canPassOff(progress, words)` unlocks a list's pass-off trail once every word still to pass
has been met in a trail (at least `seen`), so one practice session is enough to try it; a
list with nothing left to pass off offers no pass-off at all.

`markWritten(progress, word, passed)` records the grown-up's check-off:
ticked stamps the word `passed` and clears it out of review camp; unticked counts as a
miss (`missedModes.written`) and sends it back into camp, same as any other wrong answer.

`modeCeiling(progress, word)` caps how hard a word may be asked, independent of the mode
plan above: never met → listen or fill-the-gap only; met but never right → up to
build-the-word; right once → up to memory trail; right twice → typing. This is why a
child's first meeting with a word is never a blank text box. A never-met word is also
flagged `meet` on its round entry, and `Game` shows a "meet a new word" card — the word,
its sentence with the word picked out, and the audio — before the question itself.

When a typed or built answer is wrong, the feedback shows what the child produced next
to the right spelling, so a puzzling miss is a visible slip rather than a mystery.

"I don't know" (`unknown: true`) earns no XP — a fair thing to ask for, but not an
attempt, so it can't be farmed for XP by tapping it repeatedly.

## Review camp

A word joins review camp the moment it is missed and leaves after `REVIEW_CLEAR` (2)
clean answers, tracked per word as `sinceWrong`. The total `right` count cannot do that
job: a word can be right ten times and still have been missed this morning. A correct
second look inside a trail counts towards leaving, which is the whole point of it.

`reviewWords(progress, pool)` returns the missed words neediest-first — fewest clean
answers since the miss, then the freshest mistake. `App.jsx` passes it every word the
player could have met (the six tiers plus their own lists) and shows the track on the
trail map only when it holds something. A review trail takes the words at the *front*
of that list rather than sampling it, so the neediest words come up first.

Unticking a word on a written test (`markWritten`) is a miss like any other: it sends
the word back into camp exactly as a wrong answer in a trail would.

## Correction

A missed word comes back before the trail ends, once, one step easier than the mode it
was missed in (`easierMode` walks `MODE_DIFFICULTY` down from typing toward
listen-and-choose). Second looks are scored as practice: they update that word's record
for later review, but they do not move the streak or the accuracy counters, which
describe first attempts only — and, unlike a first-attempt miss, a wrong practice
answer cannot knock a word off `passed` (see **Mastery**).

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
A typed-in word that a tier already carries reuses the curated entry, its hand-written
decoys and sentence included (the parent's own sentence still wins), and since progress is
keyed by the word itself it is one word passed off in both places. Otherwise
`src/wordgen.js` syllabifies each word and generates misspellings so a bare list still
plays every game mode.

Each profile remembers `lastSelection`. `defaultSelection` (`src/profiles.js`) opens the
app on whatever the player picked last, else their newest word list, else Base Camp —
so a player who's mid-way through a custom list lands back on it rather than the tiers.

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
is involved. `site/fonts` holds the same two files for the landing page, for the same reason.

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

## The studio line

The footer carries **A Wishful Coders app**, linking to `STUDIO_URL`
(`https://wishfulcoders.com`) — the same wording and link every Wishful Coders app should
use, so the studio reads the same wherever someone meets it. Markup is
`<a class="studio-line">A <b>Wishful Coders</b> app</a>`.

## Configuration and deploys

Since the repo went public there are **two** Worker configs, and the split is the only
thing stopping a contributor from deploying over production:

| File | Tracked? | Holds |
| --- | --- | --- |
| `wrangler.jsonc` | committed | No account ID, a `REPLACE_WITH_YOUR_OWN_KV_NAMESPACE_ID` placeholder, no custom domains |
| `wrangler.prod.jsonc` | **gitignored** | The real account ID, the real `BACKUPS` namespace ID, and the `spelltrail.app` / `www` custom domains |

`npm run deploy` passes `-c wrangler.prod.jsonc`, so it only works on a machine that has
that file. A fresh clone that runs `wrangler deploy` hits its own account and fails on the
placeholder namespace — which is the intended, loud failure.

Wrangler has no environment-variable substitution for binding IDs (only `account_id` has
a `CLOUDFLARE_ACCOUNT_ID` equivalent), so a second config file is the mechanism rather
than `.env`. **Don't reintroduce the IDs into `wrangler.jsonc`.** If `wrangler.prod.jsonc`
is ever lost, both IDs are readable from the Cloudflare dashboard.

```bash
npm run deploy
```

To run the API locally (the plain `npm run dev` Vite server has no Worker, so backup calls
404). This uses the committed config, so it needs your own KV namespace id pasted in:

```bash
npx wrangler kv namespace create BACKUPS   # once
npx wrangler dev
```

## The landing site

`site/` is a single hand-written `index.html` with no build step, served by GitHub Pages at
`about.spelltrail.app` via `.github/workflows/pages.yml` and `site/CNAME`. It is the public
front for the project — what Spell Trail is, and where the code lives — and deliberately
does not duplicate the app's own privacy page, which stays canonical inside the app.

Anything that changes the pitch (new modes, new tiers, a changed support address) should be
reflected there too. It has no dependencies and no analytics; keep it that way.

### Search and assistant metadata

The landing page is written to be found for "free spelling app for kids, no ads" and to be
quoted by assistants. The rules, in order of leverage:

- **One description.** The sentence in the landing page's `<meta name="description">` is
  the description of Spell Trail. It is repeated in `index.html`, `public/llms.txt`,
  `site/llms.txt`, both JSON-LD graphs, and the hub's `apps.ts`. Change it in all of them.
- **The lede under the H1 is a quick answer**: 40–60 words that say what it is, who it is
  for, and that it is free with no ads and no account. Assume it gets quoted verbatim.
- **The FAQ section and the `FAQPage` JSON-LD must match word for word.** Edit both.
- **Entity ids are shared.** The Organization (`https://wishfulcoders.com/#organization`)
  and Person (`https://wishfulcoders.com/about/#person`) ids are the hub's. The app id
  (`https://spelltrail.app/#app`) is used by both the landing page and the app shell.

`scripts/landing-schema.test.js` enforces all of that under `npm test`. The wider plan
lives in `wishful_coders_planning/growth-plan.md`.

`public/robots.txt`, `public/sitemap.xml`, and `public/llms.txt` ship with the app;
`site/` carries its own copies for `about.spelltrail.app`. After a deploy, resubmit the
sitemap in Google Search Console and Bing Webmaster Tools if the page set changed.

## Email

`support@spelltrail.app` forwards to `wishfulcoders@gmail.com` through Cloudflare Email
Routing, so the address a family sees on the privacy page is the app's own rather than a
personal mailbox. It is exported as `SUPPORT_EMAIL` at the top of `src/App.jsx` — change
it there and add a matching routing rule. Nothing in the app sends or receives mail:
this is DNS and a routing rule, not code, and the Worker has no `email()` handler.

```bash
npx wrangler email routing settings spelltrail.app   # enabled / status
npx wrangler email routing rules list spelltrail.app # who forwards where
```

The zone previously used Namecheap's forwarders. Cloudflare refuses to enable while
foreign MX records are present, so those (`eforward1-5.registrar-servers.com`) and their
SPF TXT were deleted first; enabling then published Cloudflare's own MX, SPF, and DKIM
records. The catch-all is **disabled and set to drop**, so only `support@` is delivered
and mail to any other address at the domain bounces — turn the catch-all on if that is
ever not what you want.

Note the wrangler OAuth token can manage routing (`email_routing:write`) but holds no
DNS record scope, so DNS edits still need the dashboard or a `Zone → DNS → Edit` token.

## Licensing

Dual-licensed: AGPL-3.0 ([LICENSE](./LICENSE)) plus an optional commercial license
([COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md)). Contributions are covered by
[CLA.md](./CLA.md). This is the studio-wide policy — keep it in step with the
`wishful_coders` repo rather than diverging here.
