# NutraMEA Int. design rules

These are constraints, not suggestions. When a rule conflicts with what you were about
to generate, the rule wins. They apply to every file that renders on nutrameaint.com:
this repo, the WordPress theme (`nutramea-theme`), email templates, podcast pages,
investor and partner decks rendered as HTML.

The goal is not "avoid a list of things". It is to make a deliberate choice in each
place where the default would be decoration. If you remove a banned element and put
nothing considered in its place, the result is worse, not better.

Read this before writing markup or CSS. Run `tools/design-check.sh` before saying a
change is finished.

---

## 0. Project bindings

The rules below are generic. These are the specific values they resolve to here.
Never invent a parallel set per page.

| Token | Value | Use |
| --- | --- | --- |
| `--accent` | `#b9ff39` | The one accent. Links, active state, the single primary button per view. |
| `--accent-ink` | `#0a0c0b` | Text sitting on accent fill. |
| `--bg` | `#0a0c0b` | Page ground. |
| `--panel` | `#111512` | One background step up. The only step. |
| `--text` | `#f3f5f3` | Body and headings. |
| `--muted` | `#98a099` | Secondary text. 6.6:1 on panel, passes. |
| `--line` | `rgba(255,255,255,.1)` | The one border colour. |
| `--error` | `#ffaaa8` | Destructive and failure states only. |
| `--radius` | `4px` | The one radius. Every corner, everywhere. |
| `--space` | 4px base | Every margin, padding and gap is a multiple of 4. |

Type: Inter for everything. Tahoma is a script fallback for Arabic, not a second
design family. Scale is 12 / 14 / 16 / 20 / 24 / 32 / 48. No sizes between steps.

Greys are one family at one temperature (cool-neutral green-black). Never mix in a
warm grey.

Source of truth is `site/assets/tokens.css`. Import it. Do not redeclare `:root` in a
page, and do not paste hex values inline.

---

## 1. Colour

- One accent colour. Everything else is neutral, a single family of greys at a
  consistent temperature.
- A second colour is allowed only when it carries meaning: destructive, success,
  warning. Never for variety.
- Banned: blue to purple and indigo to violet gradients, anywhere. Backgrounds,
  buttons, headings, logos, icons, borders, blurred blobs, mesh backgrounds.
- Banned: gradient text (`background-clip: text`). Headings are one solid colour.
- Banned: giving each feature, category or section its own hue. A category grid uses
  the same colour for every card. Colour encodes meaning, it is not decoration.
- Do not ship a framework's default palette untouched. Define your own tokens.
- Accent usage target: under 10% of the visible surface. If the page looks colourful,
  you have overused it.

## 2. Depth and separation

- Banned: a drop shadow on anything that is not genuinely floating above the page.
  Cards, sections, images, inputs, badges and static buttons get no shadow.
- Shadows are permitted only on elements that truly overlay: dropdowns, popovers,
  modals, toasts. Tight and low-opacity. A real one reads as
  `0 1px 2px rgba(0,0,0,.06)`, not a 40px bloom.
- Separate blocks with a 1px border, a background step, or whitespace, in that order
  of preference. Whitespace is the best separator and costs nothing.
- Do not stack multiple shadows on one element to simulate depth.
- One border-radius value and one border colour, used everywhere.

## 3. Icons and emoji

- Banned: the sparkle icon and every "AI shimmer" glyph, in buttons, badges, logos,
  nav, headings, or beside a product name. It is the single clearest tell there is.
  If a feature uses AI, say so in words.
- Banned: emoji used as UI. No emoji in headings, buttons, feature lists, badges,
  navigation or empty states. Emoji are user content, never interface.
- Banned: any container around an icon. No tinted rounded square, no circle, no
  bordered box, no coloured chip behind it. The icon sits directly on the background
  at text size.
- One real icon set (Lucide here) at one stroke weight. Monochrome, inheriting
  `currentColor`, sized to the text beside it.
- Dingbats pasted as text are not an icon set. No `☰`, `→`, `✓` as glyphs. Inline SVG.
- If a feature is clear from its label, it does not need an icon at all.

## 4. Typography and copy

- Banned words, in copy and in headings: unleash, supercharge, elevate, transform,
  revolutionise, empower, seamless, effortless, effortlessly, cutting-edge,
  game-changing, next-level, unlock, harness, robust, leverage, powerful, delve,
  paradigm, synergy. If a sentence survives deleting the adjective, delete it.
- Banned: the em dash in UI copy. Write two sentences, or use a comma. Applies to
  headings, body, tooltips and empty states.
- Say what the product does, in concrete nouns and real numbers. "Import a supplier
  catalogue as CSV and get SFDA and MoHAP status per SKU" beats anything abstract.
- One type family (two at most: UI and mono). A real scale. No sizes between steps.
- Body text is left-aligned. Centre only short headings. Never centre a paragraph over
  three lines. Cap measure at about 70 characters.
- Sentence case for headings and buttons. No Title Case Everywhere, no ALL-CAPS except
  tiny labels with tracking.
- Arabic: `dir="rtl"` flips layout, not the rules. Same scale, same spacing, same
  restraint. Do not switch to a decorative Arabic display face.

## 5. Motion

- Banned: an arrow inside a button that slides on hover. Also banned: arrows that
  animate on their own, bouncing chevrons, any looping idle motion.
- Banned: hover glow. No box-shadow bloom, no coloured halo, no `scale()` above 1.02,
  no lift on hover for cards or buttons.
- Hover states change background or border colour only, at 120 to 160ms `ease-out`.
- Animate `opacity` and `transform` only. 120 to 200ms for UI feedback, up to 300ms for
  something entering. Nothing eases for half a second.
- No scroll-triggered fade-ins on every section. No parallax, no typewriter, no
  counters ticking up, no marquee of logos.
- Honour `prefers-reduced-motion: reduce` and disable non-essential motion inside it.

## 6. Scale and proportion

Nothing is oversized. Everything is sized to its content and fits neatly. Inflated
type, padding and buttons are how a generated page announces itself before you read a
word.

- Hero headline 40 to 56px on desktop, 28 to 34px on mobile. Never 72px+.
- Body text 15 to 16px. Secondary 13 to 14px. Nothing below 12px.
- Buttons 36 to 44px tall, padding sized to the label. Never full-width on desktop.
  A primary and a secondary button are enough.
- Section padding 64 to 96px vertical on desktop, 40 to 56px on mobile. Not 160px+.
- Content max-width 1100 to 1280px. Text columns capped at 65 to 70 characters.
- Inline icons 16 to 20px, standalone icons 24px. No 48px+ decorative icons.
- No section is a full viewport tall just for impact. The hero shows that content
  continues below it.
- Cards are sized by their content. Force equal heights only when the content really
  is equal.
- Every spacing value is a multiple of 4. Elements in a row share their top and bottom
  edges. Related items align to the same left edge.

## 7. Layout and structure

- Banned: the eyebrow badge. No pill above the hero reading "Introducing v2.0",
  "AI-Powered", "New" or "Trusted by 200+ brands". If it were important it would be in
  the headline.
- Do not reproduce the default template order (hero, logo strip, three features,
  testimonial, three pricing tiers, FAQ, repeated CTA). Build only the sections this
  product actually needs, in the order a real user needs them.
- Feature grids do not have to be three columns of equal-length cards. Let real content
  set the shape. Uneven is fine and reads as human.
- Not everything is centred. Not everything is a card. Not every corner is rounded.
- One spacing scale. Vertical rhythm should be visibly consistent.

## 8. Placeholder content

- Mockup content is fine. Do not leave sections empty waiting for real copy, and never
  ship an HTML comment that says content goes here.
- What gives a page away is not that content is placeholder, it is that the placeholder
  is generic. Make it specific: named companies rather than "Company A", a number that
  is oddly precise rather than a round 10,000+.
- Placeholder copy still obeys section 4. No hype adjectives, no em dashes, no emoji.
- Write real empty states, error states and loading states. Their absence is what makes
  a build feel unfinished.

## 9. Code craft

- Semantic HTML: `header`, `nav`, `main`, `section`, `button`, `a`. A clickable `div`
  is a bug.
- Real, visible `:focus-visible` styles. Keyboard order must match visual order.
- Every image has meaningful `alt`. Decorative images get `alt=""`.
- Colour contrast at least 4.5:1 for body text, 3:1 for large text.
- Reuse components instead of pasting a block with different text. If the same markup
  appears three times, extract it.
- Use the tokens in `site/assets/tokens.css`, not one-off arbitrary values per element.
- No dead code, no commented-out blocks, no unused imports, no placeholder TODOs in a
  delivered file.

---

## Before you say it is finished

Run `tools/design-check.sh`. Then go through every line by eye. Fix what fails.

1. Any blue to purple or indigo to violet gradient left, anywhere?
2. Any gradient text?
3. Does anything that is not floating still have a shadow?
4. Any sparkle glyph, anywhere?
5. Any emoji used as interface?
6. Does any icon sit inside a tinted square, circle or box?
7. Any em dash in the copy?
8. Any hits from the banned word list?
9. Does each feature or category have its own colour?
10. Does any button contain a moving arrow?
11. Does anything glow, lift or scale on hover?
12. Is there a badge above the hero that says nothing?
13. Is the hero headline above 56px, or any section over 96px of vertical padding?
14. Does any element look oversized next to the text beside it?
15. Does the Arabic view hold the same scale and spacing as the English one?

If a reviewer could tell this was generated in under five seconds, find the specific
thing that gave it away and fix that.
