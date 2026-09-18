# Walkthrough: design rules, ten pages, and the WordPress bridge

## The rules

`DESIGN_RULES.md` is the styling law for nutrameaint.com. Colour, depth, icons,
typography and copy, motion, scale, layout, placeholder content, code craft, and a
checklist to run before calling anything finished. Section 0 binds each rule to this
project's own tokens, so the rules resolve to values rather than to taste. `CLAUDE.md`
points every future session at them before any markup gets written.

`tools/design-check.sh` enforces the mechanical half: gradient text, blue to purple
gradients, unmarked shadows, sparkle glyphs and emoji used as interface, em dashes in
copy, the banned word list, hover scale above 1.02, durations over 300ms, font sizes
outside 12 to 56px, spacing off the 4px grid, hardcoded colours, images without alt,
clickable divs, and missing focus styles. It passes on all 13 site files and reports 15
findings on a deliberately non-compliant probe page.

## The site

Nine links in the nav and footer used to 404. All of them now resolve.

Pages are generated from `src/` by `tools/build.mjs`: one layout, one set of locale
strings, one shared subscribe form. Ten pages in three languages come out of it, and the
header exists in exactly one file. Copying it ten times would have broken the reuse rule
on the day the rule was written.

- English: home, weekly brief, coverage, podcast, about, request access, contact, privacy
- Arabic and Chinese: home, with the language switcher wired across all three

The subscribe form has real states now. Invalid address blocks the request and shows the
error. A valid one posts by fetch, disables the button, and reports success or failure.
All three paths were tested against a local stand-in for the endpoint.

## The WordPress bridge

`wordpress/nutramea-design.php` is generated from the same stylesheets the static site
uses, so the theme cannot drift from the repo. It carries the tokens inline and registers
`POST /wp-json/nutramea/v1/subscribe`, storing addresses and emailing the admin, with a
rate limit and an administrator-only CSV export. `wordpress/README.md` is the install
guide: copy one block, paste at the bottom of `functions.php`, press Update File.

## CI

The old workflow ran `npm ci` in `site/` with no lockfile present, so the deploy job
would have failed on its install step. It now builds the pages, fails if the committed
output is stale, runs the design check, and only then deploys.

## What needs a human

- **Copy is written, not verified.** Markets, authorities, product categories and the
  claims about what the platform does are plausible and specific, but they are mine. Read
  them before this goes public.
- **`hello@nutrameaint.com`** is used across the contact, access and privacy pages. If
  that mailbox does not exist, create it or tell me the real address.
- **The privacy page** describes this site accurately today: no cookies, no analytics,
  one third party (Google Fonts). Adding analytics later makes it wrong.
- **Self-hosting Inter** would remove that last third party and the render-blocking
  request. The font files could not be downloaded from this container.
