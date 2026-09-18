# nutrameaint.com

B2B intelligence platform for the nutraceutical trade in the Middle East, plus the
NutraMEA podcast. The public site deploys from `site/` to GitHub Pages on push to `main`.
The production WordPress theme is `nutramea-theme`; `wordpress/nutramea-design.php` is
the generated bridge to it.

## Styling

`DESIGN_RULES.md` governs every visual change in this repo and in the WordPress theme.
Read it before writing markup or CSS. It is a set of constraints, not preferences:
where it conflicts with a default, the rule wins.

Design tokens live in `site/assets/tokens.css` and are the only place colour, radius
and type scale are defined. Do not redeclare them per page or paste hex values inline.

Run `npm run check` before calling a change finished. It rebuilds the pages and runs
`tools/design-check.sh`. CI runs the same thing on every push and pull request, and also
fails if the committed output is stale.

## Pages are generated

Edit `src/`, never `site/*.html`. Those files are build output and are overwritten.

- `src/layout.html` is the one shell every page uses: header, nav, language switcher,
  footer, script tags.
- `src/strings.json` holds the chrome text and nav for each locale (`en`, `ar`, `zh`).
- `src/pages/<locale>/<name>.html` is one page: a JSON front matter block, then `---`,
  then the body. `index` renders to `/`, anything else to `/<name>/`.
- `src/partials/<name>.html` is included with `{{> name}}`. `{{base}}` resolves to the
  relative path back to the site root, so links work at any depth.
- `npm run build` writes `site/` and `wordpress/nutramea-design.php`. Output is committed
  so GitHub Pages serves it without a build step, and CI checks it is current.

`site/assets/` is hand written and is not generated. The build leaves it alone.

## Podcast episodes

`src/podcast.json` drives the podcast page. Adding an episode is one entry in `episodes`:
`number`, `date`, `title`, `guest`, `summary`, `youtube` (the 11 character video id, not a
URL) and optional `links` per platform. An empty `episodes` array renders the empty state.

`platforms` holds the show URLs. A platform with an empty string is left out of the page
rather than linked, because a link that 404s is worse than no link.

Players load nothing from YouTube until someone presses play, and use the no cookie
domain. The privacy page says so, so keep the two in step.

## WordPress

`wordpress/nutramea-design.php` is generated. It carries the stylesheets inline and
registers `POST /wp-json/nutramea/v1/subscribe`, which the brief form uses. Installation
is one paste into the theme's `functions.php`, described in `wordpress/README.md`. Never
edit that PHP by hand, in the repo or in WordPress. Change the stylesheets or
`src/wordpress/nutramea-design.php.tpl` and rebuild.
