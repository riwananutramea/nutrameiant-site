# Walkthrough: design rules installed, landing page rebuilt to them

## What was done

**`DESIGN_RULES.md`** is now the styling law for nutrameaint.com. It covers colour,
depth, icons, typography and copy, motion, scale, layout, placeholder content and code
craft, and it opens with a table binding each rule to this project's actual tokens.
It applies to this repo and to the `nutramea-theme` WordPress theme.

**`CLAUDE.md`** points every future session at those rules before any markup or CSS is
written, so the constraints survive past this conversation.

**`tools/design-check.sh`** enforces the mechanical half of the rules: gradient text,
blue to purple gradients, unmarked shadows, sparkle glyphs and emoji used as interface,
em dashes in copy, the banned word list, hover scale above 1.02, durations over 300ms,
font sizes outside the 12 to 56px range, spacing that is not a multiple of 4, hardcoded
colours, images without alt, clickable divs, and missing focus styles. It runs in CI on
every push and pull request, and deploy now waits on it.

**`site/assets/tokens.css`** is the single source of colour, radius, type scale and
spacing. Pages import it. No page redeclares `:root`, and no element carries a raw hex
value.

**`site/index.html`** was a header stub with a comment where the page should be. It is
now a real page: hero, what subscribers use it for, coverage, subscribe, footer. One
accent on a neutral ground, no shadows, no gradients, Lucide menu icon inline at text
size with no container behind it, 48px headline on desktop and 32px on mobile, section
padding 64px desktop and 48px mobile, every spacing value a multiple of 4.

**Removed**: `mobile_preview.html` and `nutrameiant_preview.html`. Both were byte
duplicates of `site/index.html`. Three copies of one header is exactly what rule 9
forbids, and only `site/` is deployed. Git history keeps them.

## Verified

- `tools/design-check.sh` passes on all four site files, and fails with 15 findings on a
  deliberately non-compliant probe page.
- Rendered in Chromium at 1280px and at mobile width. Menu disclosure, focus outlines
  and subscribe validation behave.

## Still to do

- Copy is placeholder written to be specific rather than generic. The market and
  authority lists are plausible but need your sign-off, and the product claims need to
  match what the platform does today.
- The subscribe form posts to `https://nutrameaint.com/wp-json/nutramea/v1/subscribe`.
  That REST route has to be registered in `nutramea-theme` for the form to work.
- `/brief/`, `/coverage/`, `/podcast/`, `/about/`, `/access/`, `/contact/`, `/privacy/`,
  `/ar/` and `/zh/` are linked but not built yet.
- Port the tokens and rules into `nutramea-theme` so the WordPress side matches.
