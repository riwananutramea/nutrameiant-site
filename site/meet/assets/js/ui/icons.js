/**
 * Icon set.
 *
 * Drawn on a single 24px grid with one stroke weight and one corner treatment,
 * so the toolbar reads as one family rather than a pile of borrowed glyphs.
 * Emoji and text glyphs are deliberately avoided: they render differently on
 * every platform, cannot inherit colour reliably, and give interfaces that
 * unmistakable assembled-from-defaults look.
 *
 * Paths are stroked, never filled, except where a shape is semantically solid
 * (the record dot, the stop square).
 */

const PATHS = {
  /* --- call controls ---------------------------------------------------- */
  mic: '<path d="M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3Z"/><path d="M5.5 10.5v.75a6.5 6.5 0 0 0 13 0v-.75"/><path d="M12 17.75V20.5"/>',
  micOff: '<path d="M15 6.25v-.75a3 3 0 0 0-5.7-1.3"/><path d="M9 9.5v2a3 3 0 0 0 4.8 2.4"/><path d="M5.5 10.5v.75a6.5 6.5 0 0 0 9.9 5.55"/><path d="M18.5 10.5v.75a6.4 6.4 0 0 1-.3 1.95"/><path d="M12 17.75V20.5"/><path d="M4 4l16 16"/>',
  video: '<rect x="3" y="6" width="12" height="12" rx="2.5"/><path d="M15 10.5l4.2-2.6a.8.8 0 0 1 1.3.7v6.8a.8.8 0 0 1-1.3.7L15 13.5Z"/>',
  videoOff: '<path d="M15 10.5l4.2-2.6a.8.8 0 0 1 1.3.7v6.8a.8.8 0 0 1-.6.77"/><path d="M13.6 6H5.5A2.5 2.5 0 0 0 3 8.5v7A2.5 2.5 0 0 0 5.5 18h9a2.5 2.5 0 0 0 2.5-2.5v-1.6"/><path d="M4 4l16 16"/>',
  screen: '<rect x="2.5" y="4.5" width="19" height="12.5" rx="2"/><path d="M9 20.5h6"/><path d="M12 17v3.5"/>',
  leave: '<path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2"/><path d="M10.5 12h10"/><path d="M18 9l3 3-3 3"/>',

  /* --- recording -------------------------------------------------------- */
  // Solid: a record indicator that is merely outlined reads as "off".
  record: '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',

  /* --- panel and utility ------------------------------------------------ */
  notes: '<path d="M6 3.5h9.2a2 2 0 0 1 1.42.59l2.3 2.3a2 2 0 0 1 .58 1.41V20a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V5A1.5 1.5 0 0 1 6 3.5Z"/><path d="M8.5 10.5h7"/><path d="M8.5 14h7"/><path d="M8.5 17.5h4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3A4 4 0 0 0 11 18.66l1.2-1.2"/>',
  users: '<path d="M15.5 19.5v-1.75a3.75 3.75 0 0 0-3.75-3.75h-4A3.75 3.75 0 0 0 4 17.75v1.75"/><circle cx="9.75" cy="7.75" r="3.25"/><path d="M20 19.5v-1.75a3.75 3.75 0 0 0-2.8-3.63"/><path d="M15.2 4.72a3.25 3.25 0 0 1 0 6.06"/>',
  download: '<path d="M12 3.5v11"/><path d="M8 11l4 4 4-4"/><path d="M4.5 16.5v2A2 2 0 0 0 6.5 20.5h11a2 2 0 0 0 2-2v-2"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.36-8.99A6 6 0 0 1 18 10.6a4 4 0 0 1-.5 7.9Z"/><path d="M12 12v6"/><path d="M9.5 14.5L12 12l2.5 2.5"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M5.5 15.5A2 2 0 0 1 3.5 13.5v-8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 4v4.5h-4.5"/>',

  /* --- status ----------------------------------------------------------- */
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  alert: '<path d="M12 8v5"/><path d="M12 16.5v.01"/><circle cx="12" cy="12" r="9"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.5v.01"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  chevronRight: '<path d="M9.5 5.5l6.5 6.5-6.5 6.5"/>',
  chevronLeft: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  // Ascending bars: the only icon where fill encodes state, set per-bar in CSS.
  signal: '<path d="M4.5 16.5v3"/><path d="M9.5 12.5v7"/><path d="M14.5 8.5v11"/><path d="M19.5 4.5v15"/>',
  shield: '<path d="M12 3.5l7 2.6v5.3c0 4.2-2.9 7.6-7 8.6-4.1-1-7-4.4-7-8.6V6.1Z"/><path d="M9.2 12.1l2 2 3.6-3.9"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2l-1.5 4.1-4.1 1.5 1.5-4.1Z"/>',
};

/**
 * Returns an icon as an SVG string.
 *
 * `currentColor` throughout, so an icon always matches the text beside it and
 * can never end up an unreadable colour against its own background.
 */
export function iconMarkup(name, { size = 20, strokeWidth = 1.6 } = {}) {
  const body = PATHS[name];
  if (!body) return '';
  return `<svg class="icon icon--${name}" viewBox="0 0 24 24" width="${size}" height="${size}" `
    + `fill="none" stroke="currentColor" stroke-width="${strokeWidth}" `
    + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Returns an icon as a detached SVG element. */
export function iconElement(name, options) {
  const template = document.createElement('template');
  template.innerHTML = iconMarkup(name, options).trim();
  return template.content.firstElementChild;
}

/**
 * Prefixes a button with an icon, keeping its text as the accessible label.
 * The label is never replaced by the icon — an icon-only control that the user
 * has to decode is a failure of the interface, not a saving of space.
 */
export function decorateButton(button, name, options) {
  if (!button || button.querySelector('.icon')) return button;
  const svg = iconElement(name, options);
  if (!svg) return button;
  const label = document.createElement('span');
  label.className = 'button__label';
  label.textContent = button.textContent.trim();
  button.replaceChildren(svg, label);
  return button;
}

export function setButtonLabel(button, text) {
  const label = button?.querySelector('.button__label');
  if (label) label.textContent = text;
  else if (button) button.textContent = text;
}

/** Swaps a button's icon in place, preserving its label. */
export function swapButtonIcon(button, name, options) {
  const existing = button?.querySelector('.icon');
  if (!existing) return;
  const next = iconElement(name, options);
  if (next) existing.replaceWith(next);
}

export const ICON_NAMES = Object.keys(PATHS);
export default iconMarkup;
