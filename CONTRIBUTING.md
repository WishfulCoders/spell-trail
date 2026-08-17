# Contributing to Spell Trail

Thanks for wanting to help. 🌱

Spell Trail is a small, deliberately simple codebase — React and Vite on the front, one
Cloudflare Worker on the back, no router and no state library. If you can run `npm install`
you can contribute.

## Before you start

```bash
npm install
npm run dev      # Vite dev server (everything except the backup API)
npm test         # Vitest
npm run build    # production build
```

For anything touching backups, run the Worker instead — the plain dev server has no API
and backup calls will 404:

```bash
npx wrangler dev
```

Please make sure `npm test` and `npm run build` both pass before opening a PR.

## Things that are especially welcome

- **New words for the tiers.** See the format below — the bar is that decoys must be
  *plausible* misspellings, not obvious non-words.
- **New question modes.** `src/game.js` is built so a mode only has to declare what a word
  needs (`MODE_REQUIREMENTS`) and supply a component in `src/modes.jsx`.
- **Accessibility fixes.** Touch targets, focus order, screen-reader labels, colour
  contrast, reduced motion. These get merged fast.
- **Translations and non-English word sets**, if you're up for the design conversation
  that comes with them — syllabification and speech both assume English today.
- **Bug reports with a repro.** Which browser, which mode, which word.

## Things to check with us first

Open an issue before building these, so you don't spend an evening on something that
doesn't fit:

- Anything that adds an **account, login, or server-side profile.** No accounts is a
  product decision, not an unfinished feature.
- Anything that adds a **third-party script, analytics, ad, or tracker.** The privacy page
  is a promise; a dependency that phones home breaks it.
- New **runtime dependencies.** The app ships React and nothing else on purpose.
- Anything that **gates word content behind fireflies or purchases.** The currency is
  cosmetic by design.

## Adding words

Words live in `src/words.js`, six tiers of sixty-four. Each entry carries:

- the word and a **sentence that contains it**,
- **syllable chunks** that rejoin exactly into the word,
- **two plausible misspellings**, and
- an authored **fill-the-gap blank** with three distinct options including the answer.

`src/game.test.js` enforces all of that, plus the rule that no word appears in two tiers.
Run `npm test` and it will tell you precisely what's wrong.

## Code style

There's no linter config to fight with. Match the file you're editing: the codebase leans
on small pure functions in `src/game.js`, keeps components thin, and comments the *why*
rather than the *what*. `CLAUDE.md` explains the reasoning behind most of the non-obvious
decisions — it's worth a skim before a larger change.

## Pull requests

- Branch off `main`, keep the PR focused on one thing.
- Describe what changes for a *player*, not just what changed in the code.
- If you change anything about what data is stored or sent, **update the privacy page**
  in `src/App.jsx` in the same PR. That page must never overstate or understate what the
  app does.

## The CLA

Spell Trail is dual-licensed (AGPL-3.0 plus an optional commercial license), so we ask
contributors to agree to the [Contributor License Agreement](./CLA.md). It's a one-time
thing and takes a minute. By opening a pull request you agree your contribution is
licensed under the same terms as the project.

## Code of conduct

Be decent. This is a kids' education app maintained in people's spare time — assume good
faith, keep review comments about the code, and skip the sarcasm. Anything abusive gets
the contributor removed without much ceremony. Report problems to
<hello@wishfulcoders.com>.
