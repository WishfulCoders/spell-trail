# Security Policy

## Reporting a vulnerability

Please **don't** open a public issue for a security problem.

Email **<security@wishfulcoders.com>** (or <hello@wishfulcoders.com> if that bounces) with:

- what the issue is and roughly how bad you think it is,
- the steps to reproduce it, and
- anything you need from us to confirm it.

You can also use GitHub's [private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository.

This is a small project maintained in spare time. Expect an acknowledgement within a few
days and a fix or a plan within a couple of weeks for anything real. We'll credit you in
the release notes unless you'd rather we didn't.

## Supported versions

Only what's currently deployed at `spelltrail.app` is supported. There are no long-lived
release branches.

## What the attack surface actually is

Worth knowing before you go looking, because it's smaller than most web apps:

- **There are no accounts**, no passwords, no sessions, and no cookies. Progress is
  `localStorage` on the device.
- **The only server code** is `worker/index.js` — a Cloudflare Worker with three
  endpoints: `POST /api/backup`, `GET /api/backup/:code`, and `DELETE /api/backup/:code`.
  Everything else falls through to static assets.
- **The only stored data** is opt-in backup blobs in Cloudflare KV, keyed by a random
  four-part code. The blob holds nicknames and game progress — no email, no password,
  nothing else identifying.

## Known and accepted

Reporting these is fine, but they're already on the list:

- **The backup code is a bearer token by design.** Anyone holding the code can read that
  backup. This trade-off is stated in the app's UI and on the privacy page; it's the price
  of having no accounts. Codes have roughly 10^11 combinations.
- **The backup API has no rate limiting yet.** Brute-forcing the code space is
  impractical, but a Cloudflare rate-limiting rule on `/api/backup/*` is the proper fix
  and is a tracked gap.
- **`Always Use HTTPS` is currently off** for the zone, so `http://spelltrail.app` serves
  over plaintext rather than redirecting. Also a tracked gap.

## Out of scope

- Reports from automated scanners with no demonstrated impact.
- Missing headers or best practices with no exploit path.
- Anything requiring physical access to an unlocked device — the app is explicitly
  local-first and offers no protection against someone using the device.
- Social engineering of the maintainers.
