# Mobile UI Enhancement

**Goal**: Improve the mobile experience of the NutraMEA weekly‑brief UI. The header and overall layout should be clean, touch‑friendly, and fast loading on mobile devices while preserving the brand identity.

## User Review Required

> [!IMPORTANT]
> Please review the design direction and palette choices below. Your selections will guide the implementation.

### Header & Layout Direction

- **Option 1 (Recommended)** – Simplified header with logo and a hamburger menu, minimal background effects for fast load.
- **Option 2** – Retain current header elements (logo, language switcher) but improve spacing and touch targets.
- **Option 3** – Add a sticky bottom navigation bar for easy access to key sections.

### Color Palette

- **Option A (Recommended)** – Keep existing dark theme with accent green.
- **Option B** – Switch to a light theme with dark text.
- **Option C** – Custom brand colors (specify after selection).

### Performance Optimizations

- **Option X (Recommended)** – Apply all optimizations: lazy‑load images, CSS/JS minification, reduce background gradients, defer script execution.
- **Option Y** – Only CSS/JS minification.
- **Option Z** – No additional optimizations.

## Open Questions

1. Which header/layout option do you prefer?
2. Which color palette should be used?
3. Which performance‑optimisation level do you want?

## Proposed Changes

### 1️⃣ HTML
- Add a `<header>` element containing the logo and a hamburger button.
- Insert a hidden `<nav>` panel that slides in on tap, housing navigation links (e.g., Home, About, Contact).
- Update language‑switcher placement inside the new header.
- Add `loading="lazy"` to any `<img>` tags (if present).
- Move inline `<script>` to the end of `<body>` with `defer` attribute.

### 2️⃣ CSS (in `style` block or separate file)
- Introduce mobile‑first styles; use `@media (max-width: 620px)` as primary breakpoint.
- Reduce or remove the heavy background‑mesh gradient on mobile.
- Increase tappable area for buttons/inputs (`min-height: 48px`, `padding` adjustments).
- Add hamburger‑menu animation (CSS only) and hide original progress indicator if not needed.
- Provide dark‑mode and optional light‑mode variables based on user palette choice.
- Include `prefers-reduced-motion` rules to skip non‑essential animations.

### 3️⃣ JavaScript (`nutramea.js`)
- Refactor to support opening/closing the hamburger menu.
- Wrap existing wizard logic in `DOMContentLoaded` listener.
- Remove console logs and dead code.
- Ensure the script is loaded with `defer` to avoid blocking rendering.

### 4️⃣ Performance
- Minify the combined CSS and JS (use a build step or online minifier).
- Add `<link rel="preload" href="https://fonts.googleapis.com/..." as="style" onload="this.rel='stylesheet'">` for the Inter font.
- Set `font-display: swap;` for custom fonts.
- Optionally serve a reduced‑size CSS file to mobile via a media query (`media="(max-width: 620px)"`).

## Verification Plan

### Automated Tests
- Run a headless Chrome check (`chrome-devtools` skill) to verify no console errors on mobile viewport (`--window-size=375,667`).
- Use Lighthouse (or `chrome-devtools` LCP audit) to confirm Largest Contentful Paint under 2 s on mobile.

### Manual Verification
- Open the page on a real device or emulator.
- Check header layout, hamburger menu interaction, touch target sizes, and overall visual fidelity.
- Confirm language switcher still works.
- Verify that images (if any) lazy‑load and that background gradients are not visually heavy.

> **Next Step**: Await your selections for the three open questions before proceeding.

---

*Implementation plan created. Please respond with your choices.*
