# nutrameaint.com

B2B intelligence platform for the nutraceutical trade in the Middle East, plus the
NutraMEA podcast. Public site deploys from `site/` to GitHub Pages on push to `main`.
The production WordPress theme is `nutramea-theme`; changes made here are ported there
by hand.

## Styling

`DESIGN_RULES.md` governs every visual change in this repo and in the WordPress theme.
Read it before writing markup or CSS. It is a set of constraints, not preferences:
where it conflicts with a default, the rule wins.

Design tokens live in `site/assets/tokens.css` and are the only place colour, radius
and type scale are defined. Do not redeclare them per page or paste hex values inline.

Run `tools/design-check.sh` before calling a change finished. CI runs it on every push
and pull request.

## Layout

- `site/` is the deployed root. Asset paths are relative to it.
- `site/assets/` holds shared CSS and JS.
- `tools/` holds repo scripts.
