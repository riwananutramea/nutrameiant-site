# Handoff — NutraMEA member meetings

For any engineer or agent picking this up. Written to be read cold.

**Branch:** `claude/nutrameaint-video-conferencing-prhbty`
**Status:** feature complete and tested; **not yet deployed to production**
**Blocker to going live:** nobody has uploaded the files to the host yet. There
is no technical work outstanding for a first release.

---

## 1. What this is

Private video meetings for NutraMEA members, recorded in the organiser's own
browser, with automatic meeting notes. It runs at **zero cost, permanently** —
that is a hard product constraint, not a preference, and it shapes most of the
architecture below.

Read `docs/MEETINGS.md` first for the operator-level picture. This document
covers what a developer needs that the operator guide does not.

---

## 2. The single most important fact about the target site

**nutrameaint.com does NOT have WooCommerce.** Verified live:

- `GET /my-account/` → **404**
- `GET /wp-json/` → namespaces are `nutramea/v1`, `nmcore/v1`, `nwbos/v1`,
  `nwb/v1`, `nmi/v1`, `nutramea-intelligence/v1`, `nmar/v1`,
  `better-messages/v1`, `elementor/v1`, `complianz/v1`, `litespeed/v1`,
  `hostinger-tools-plugin/v1`, `really-simple-security/...`, `wp/v2`.
  **No `wc/v1|v2|v3` anywhere.**
- Existing member URLs: `/account/` (200), `/dashboard/` (200), `/login/` (200)
- Theme: `wp-content/themes/nutramea-theme`
- Stack: Elementor, LiteSpeed cache, Hostinger, Really Simple Security,
  Complianz GDPR + WP Consent API, and in-house `nutramea-*` plugins.

An earlier version of this feature hooked **only** WooCommerce account
endpoints. On that site it would have installed cleanly, raised no errors, and
produced no feature whatsoever. If you change the entry points, re-check this
assumption before you ship — a feature that silently does nothing is the
hardest kind of bug to notice.

**Therefore the primary entry point is a standalone `/meetings/` route**, with
WooCommerce support kept only as an optional extra.

---

## 3. Layout

```
site/meet/                     the browser app (plain ES modules, no build step)
  index.html                   page + Content-Security-Policy
  assets/js/boot.js            entry point (separate file so CSP needs no
                               'unsafe-inline')
  assets/js/config.js          configuration + the security boundary. START HERE.
  assets/js/core/              bus, logger, IndexedDB store, utils
  assets/js/media/             jitsi transport, recorder, sinks, resilience
  assets/js/ai/                transcriber engines, notes extraction, exporters
  assets/js/storage/           Google Drive upload, delivery
  assets/js/ui/                app orchestration, tour, preflight, icons, toasts
  embed-harness.html           dev fixture — NOT shipped
  dashboard-preview.html       dev fixture — NOT shipped

theme/nutramea-meetings.php    the WordPress integration (theme code, NOT a plugin)
theme/woocommerce/myaccount/dashboard.php   optional, WooCommerce sites only

tests/*.test.mjs               JavaScript unit tests (node:test)
tests/php/                     WordPress integration, auth-safety, standalone,
                               API-contract suites
tests/e2e/wordpress.mjs        end-to-end against a real WordPress
scripts/verify-wordpress.sh    stands up that real WordPress from scratch
```

There is **no build step and no bundler**. Native ES modules, served as files.
Do not introduce a bundler without a reason — the absence of one is why this
deploys by copying a folder.

---

## 4. Non-obvious decisions, and why

Change these only with the reason in hand.

**No provider recording API.** Every hosted option is metered or gated behind a
paid plan — including Daily's `local` recording mode, which reads as free but
is a paid-plan feature. Browser-side capture is the only route that is
genuinely free and stays free.

**Jitsi as the default transport.** No account, no API key, no credit card, no
duration cap, and it cannot generate a bill. It is a real SFU, so CPU and
bandwidth stay flat as participants are added. Self-hostable later via one
config value.

**Recording streams to disk, never to an array.** A 60-minute recording is
~540 MB. Accumulating that in memory is the usual reason long browser
recordings die partway through. Slices go to a `FileSystemWritableFileStream`,
or to IndexedDB with crash recovery, and are released immediately.

**The microphone is mixed in separately.** Tab audio does not contain your own
voice — you never hear yourself played back. Without the separate mic capture
the organiser is silent in their own recording.

**Web Speech transcription is attributed to the local participant only.**
Remote voices reach the speakers and are removed from the mic by echo
cancellation, so this engine only ever hears the local user. Attributing it to
the call's dominant speaker would mislabel the transcript. Whole-room capture
is the Whisper engine's job, running over the recorder's mixed audio.

**The transcript view renders a bounded window.** An hour is ~8,000 lines;
keeping them all in the DOM makes the second half of a meeting stutter. Full
data lives in memory and is what exports read.

**Permalink flushing is `admin_init` only.** See §6.

**`/meetings/` is marked never-cacheable.** It carries the member's own room;
the site runs LiteSpeed, and a cached copy would hand one member's room to
another.

---

## 5. The security boundary — read before touching `config.js`

`site/meet/index.html` is a **static file inside the theme**. Anyone can link
to it with any query string. It is not authenticated and cannot be.

That means the `cfg` query parameter is **attacker-controlled input**. It was
previously deep-merged into the config unvalidated, and because `cfg` sets the
transport domain — which is interpolated into a `<script src>` — a crafted
invite link executed arbitrary JavaScript on the live origin as the signed-in
member. Confirmed in a browser, now fixed. Three independent locks:

1. **`cfg` is an explicit allowlist** (`PACKED_SCHEMA` in `config.js`). Named
   keys only, each with a validator, values dropped rather than coerced on
   failure. The transport domain must be on `TRUSTED_DOMAINS` and match a
   strict hostname pattern, so `meet.jit.si.evil.com`, a port, a path, a scheme
   or credentials cannot pass.
2. **Anything sensitive never travels in the URL.** Google OAuth settings come
   from `window.NUTRAMEA_MEET_CONFIG`, an inline global the theme renders on the
   framing page and the app reads through `window.parent` — same-origin, and
   unwritable from a URL. Validating a client ID's *shape* is not enough: an
   attacker can register a real OAuth app and get a well-formed one.
3. **A Content-Security-Policy** on `index.html` names the only origins that may
   serve script.

**Rules for anyone editing this area:**
- Never add a key to `PACKED_SCHEMA` that controls a URL, an origin, a scope or
  a credential.
- Never widen `TRUSTED_DOMAINS` to a host you do not control or trust.
- If you add a third-party origin, update the CSP **and** confirm in a browser
  that nothing else broke.
- `tests/security.test.mjs` pins all of this. If a change makes it fail, the
  change is wrong until proven otherwise.

---

## 6. Authentication is untouchable

Sign-in, sign-up and activation must work when everything else is broken.

This feature registers **nothing at all** on `wp-login.php` (which also serves
registration, password reset and logout), `wp-signup.php`, `wp-activate.php`,
`wp-register.php`, cron, XML-RPC and installation. Not a guarded hook — no hook,
so there is nothing to misbehave through. See
`NutraMEA_Meetings::is_protected_request()`.

**Why this is stricter than it looks.** An earlier version called
`flush_rewrite_rules()` from `wp_loaded` — every request, including
`wp-login.php` — guarded only by an option write. That call regenerates every
rewrite rule on the site. If the guarding write ever failed to stick (stale
object cache, momentarily read-only database), the guard never closed and the
flush ran on every request permanently. It does not surface as an error; it
surfaces as the site becoming slow enough to look broken, sign-in first.

Now: `admin_init` only, gated on `is_admin()`, not AJAX, and `manage_options`,
once per version. **The guard option is written before the flush, not after**,
so a throwing flush still closes the gate. A failed flush costs one 404 that
re-saving permalinks fixes; a retry loop costs the whole site.

`tests/php/auth-safety.test.php` covers this, each case in its own PHP process
because hook registration happens once at include time. Run against the pre-fix
code, all fifteen fail.

---

## 7. Running the tests

```bash
npm run check        # lint + every suite below
npm run lint:js      # loads each module through the real ESM loader
npm run lint:php     # parses every PHP file
npm test             # JavaScript, then the three PHP suites
```

Two checks are **not** in CI because they need external resources. Run both
before a release and after any WooCommerce or WordPress update:

```bash
# API contract — every function and hook verified against real source
curl -sSL -o wp.tar.gz https://wordpress.org/latest.tar.gz && tar xzf wp.tar.gz
curl -sSL -o wc.zip https://downloads.wordpress.org/plugin/woocommerce.latest-stable.zip && unzip -q wc.zip
WP_SRC=./wordpress WC_SRC=./woocommerce php tests/php/api-contract.test.php

# End to end against a real WordPress (SQLite, no MySQL needed)
scripts/verify-wordpress.sh /tmp/nutramea-wp-verify 8090
BASE_URL=http://127.0.0.1:8090 node tests/e2e/wordpress.mjs
```

Last verified: **WordPress 7.1.1**, **WooCommerce 11.1.1** — 55 contract checks,
33 end-to-end checks, all passing.

**Two harness traps**, both fixed in the script, both worth knowing because they
cost an afternoon each:
- WordPress infers a path-prefixed site URL from the directory it is installed
  into, which sets auth cookies on a path the browser never sends back. Every
  login then fails silently. The script pins `WP_HOME` / `WP_SITEURL`.
- PHP's built-in server is single-threaded and deadlocks on a browser's parallel
  requests. The script sets `PHP_CLI_SERVER_WORKERS=8`.
- The router must serve a directory's own `index.php`, or `/wp-admin/` is served
  by the front-end `index.php` and nothing testing admin behaviour is actually
  in the admin.

---

## 8. Deploying

Theme code. Three items into `wp-content/themes/nutramea-theme/`, one
`require_once` line in that theme's `functions.php`, then re-save permalinks.
Full steps in `docs/MEETINGS.md` §4. **The undo is deleting that one line.**

`.github/workflows/deploy-theme.yml` automates it: manual trigger, dry-run by
default, runs the full suite first, uploads only staged files,
`dangerous-clean-slate: false` so it cannot mirror-delete the theme, then
verifies `/meetings/` gates correctly and the home page still returns 200.
It needs `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` as repository secrets.

---

## 9. What is done, and what is not

**Done:** transport, 1-hour recording with crash recovery, weak-network
degradation, AI notes with exports, Drive delivery, guided tour, pre-flight
setup check, standalone route, optional WooCommerce integration, mobile UX,
WCAG AA contrast, CSP, the security fixes in §5, the auth guarantees in §6.

**Deliberately not done:**
- **No meeting scheduling.** No calendar, no invitations by email, no reminders.
  Rooms are ad hoc or the member's own permanent room.
- **No presence.** You cannot see who is in a room before joining it.
- **No server-side recording archive.** Recordings never touch the site. This is
  the zero-cost constraint; changing it means paying for storage and egress.
- **Whisper whole-room notes are opt-in and largely unexercised.** The Web Speech
  path is well tested; Whisper needs a real session with a real model download
  before trusting it.
- **No link from the site's navigation to `/meetings/`.** Members must be given
  the URL. Their nav is custom and I did not want to guess at it. **This is the
  most valuable next task** — see §11.

---

## 10. Plugins already on the site — assessment

The question asked was whether an already-installed plugin could improve the
video meeting experience **at no cost**. Checked against what the site actually
runs:

**Better Messages** (`better-messages/v1` is live). It does have HD video and
audio calls, one-to-one and group, inside the messenger thread. **They are not
free.** Calls require the WebSocket licence — **$11.99/month billed annually,
about $143.88 per site per year**, or $14.99 monthly. In the free version the
call buttons are hidden. It also does not use Jitsi; calls run on their own
hosted relay.

So it **fails the free requirement** and is not a replacement for what is built.

**But the free tier is still worth using**, for a different job: it is already
the platform's messaging layer, so a meeting invite can be *delivered* through
it. Sending `/meetings/<room>` as a Better Messages message is free, uses
infrastructure already installed, and removes the "how do I get the link to
them" step. That is a genuinely good integration and is listed in §11.

**Complianz GDPR + WP Consent API** (both live, both free). More relevant than
they look: this feature records meetings, and recording consent is a real
obligation for a B2B platform operating across the EU and the Gulf. The
recording flow currently takes consent in-app and announces it in the meeting
chat. Wiring it to the site's existing consent framework would make that
defensible rather than merely reasonable. Free, already installed.

**Elementor** (live). Useful as a host: `[nutramea_meetings]` drops into a
shortcode widget on `/account/` or `/dashboard/` with no code.

**LiteSpeed Cache** (live). Already handled — the meetings page sets
`DONOTCACHEPAGE` and `nocache_headers()`. If you add any other per-member page,
do the same.

**Verdict:** no installed plugin improves the meetings feature for free. Keep
the in-house implementation. Use Better Messages free for invite delivery and
Complianz for consent.

---

## 11. Suggested next tasks, highest value first

1. **Put a link to `/meetings/` in the member navigation.** The feature is
   invisible without it. Their nav is custom (`nutramea-*` plugins), so this
   needs a look at the live theme rather than a guess.
2. **Deliver invites through Better Messages free.** A "send this link to…"
   control that posts `/meetings/<room>` into an existing thread.
3. **Wire recording consent to WP Consent API / Complianz** so it is recorded
   against the platform's consent log rather than only in the meeting chat.
4. **Exercise the Whisper engine for real** — a full session, real model
   download, measure whether it keeps up on a mid-range laptop.
5. **Scheduling**, if the product wants it. Note it implies notifications, which
   implies email deliverability, which is a much larger surface.

---

## 12. Things that will bite you

- **The tab-audio tick.** When Chrome asks what to share, the organiser must
  choose "This tab" and tick "Also share tab audio". Miss it and the recording
  contains only their own voice — and the meeting sounds completely normal
  throughout, so it is discovered on playback, afterwards. The pre-flight check
  exists solely for this. Do not remove it.
- **Recording needs Chromium on a desktop.** The call works anywhere; recording
  does not. The capability list on the lobby says so up front.
- **`indexedDB.open()` can hang forever** — `blocked` fires when another tab
  holds an older version and no success or error follows. It is guarded with a
  timeout; do not remove it. Losing the store is survivable, hanging is not.
- **`exit` inside a render path ends the test run.** That is why
  `output_standalone_page()` is split from `maybe_render_standalone()`.
- **`slugifyRoom()` never returns empty** — it falls back to `"room"`. Check for
  an absent value *before* slugifying, or an unprefixed room silently becomes
  `room-<name>`.
