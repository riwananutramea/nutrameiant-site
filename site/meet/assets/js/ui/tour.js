/**
 * Guided tour — spotlight coach marks.
 *
 * Two short walkthroughs rather than one long one: the lobby tour runs on a
 * first visit, the call tour the first time someone is actually in a meeting.
 * Explaining the Record button while the user is still typing their name is
 * advice arriving at the wrong moment.
 *
 * The spotlight is a positioned ring carrying an oversized box-shadow, which
 * dims everything outside it. That keeps the highlighted control genuinely
 * visible and interactive rather than hidden behind a flat scrim.
 */

import { iconMarkup } from './icons.js';

const STORAGE_PREFIX = 'nutramea.tour.';
const GAP = 12;          // spotlight padding around the target
const ARROW = 9;

export const lobbyTour = [
  {
    target: '#room-name',
    title: 'This is your private room',
    body: 'Your personal room name is already filled in and is impossible to guess. Anyone who has it can join, so treat it like a password.',
    placement: 'bottom',
  },
  {
    target: '#audio-only',
    title: 'Travelling, or on hotel wifi?',
    body: 'Join audio-only and your voice gets the whole connection. You can turn video back on at any point during the call.',
    placement: 'bottom',
  },
  {
    target: '#notes-engine',
    title: 'Choose what the notes hear',
    body: 'Your microphone only is instant. To capture the person you are meeting as well, pick "Everyone in the room" — it needs recording switched on.',
    placement: 'top',
  },
  {
    target: '#join-button',
    title: 'That is everything',
    body: 'Join first, then send the invite from inside the call. Nothing here costs anything, and there is no time limit.',
    placement: 'top',
  },
];

export const callTour = [
  {
    target: '#copy-link',
    title: 'Bring the other person in',
    body: 'Copy the invite and send it however you normally would. They can join from any browser, on any device.',
    placement: 'top',
  },
  {
    target: '#record-button',
    title: 'Recording — read this one',
    body: 'Chrome will ask what to share. Choose the "This tab" tab, then tick "Also share tab audio". That tick is what records the other person\'s voice; without it you will only hear yourself.',
    placement: 'top',
    emphasis: true,
  },
  {
    target: '#toggle-notes-panel',
    title: 'Notes write themselves',
    body: 'The transcript builds as you talk. When you leave, you get a summary, decisions and action items with owners and due dates.',
    placement: 'top',
  },
  {
    target: '#leave-button',
    title: 'Leaving saves everything',
    body: 'Leave ends the call and finishes the recording cleanly. Your downloads and notes are on the next screen.',
    placement: 'top',
  },
];

export class Tour {
  constructor({ logger = null } = {}) {
    this.log = logger;
    this.steps = [];
    this.index = 0;
    this.active = false;
    this.root = null;
    this.onFinish = null;
    this.reposition = this.reposition.bind(this);
    this.onKeydown = this.onKeydown.bind(this);
  }

  static seen(key) {
    try {
      return localStorage.getItem(STORAGE_PREFIX + key) === 'done';
    } catch {
      // Private mode: show the tour rather than crash. Worst case it repeats.
      return false;
    }
  }

  static markSeen(key) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, 'done');
    } catch {
      /* nothing to do — the tour simply runs again next time */
    }
  }

  static reset() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key);
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Runs a tour, skipping any step whose target is missing so a hidden
   * control can never strand the user on an empty spotlight.
   */
  start(steps, { key = null, force = false } = {}) {
    if (this.active) this.finish({ silent: true });
    if (key && !force && Tour.seen(key)) return false;

    this.steps = steps.filter((step) => document.querySelector(step.target));
    if (this.steps.length === 0) return false;

    this.key = key;
    this.index = 0;
    this.active = true;
    this.#build();
    this.#render();

    window.addEventListener('resize', this.reposition, { passive: true });
    window.addEventListener('scroll', this.reposition, { passive: true, capture: true });
    document.addEventListener('keydown', this.onKeydown);
    document.body.classList.add('tour-active');
    return true;
  }

  #build() {
    const root = document.createElement('div');
    root.className = 'tour';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'false');
    root.setAttribute('aria-label', 'Guided tour');

    root.innerHTML = `
      <div class="tour__spotlight" aria-hidden="true"></div>
      <div class="tour__card" role="document">
        <div class="tour__arrow" aria-hidden="true"></div>
        <div class="tour__head">
          <span class="tour__step"></span>
          <button type="button" class="tour__skip">Skip</button>
        </div>
        <h3 class="tour__title"></h3>
        <p class="tour__body"></p>
        <div class="tour__foot">
          <div class="tour__dots" aria-hidden="true"></div>
          <div class="tour__nav">
            <button type="button" class="tour__back">${iconMarkup('chevronLeft', { size: 16 })}<span>Back</span></button>
            <button type="button" class="tour__next"><span>Next</span>${iconMarkup('chevronRight', { size: 16 })}</button>
          </div>
        </div>
      </div>`;

    document.body.appendChild(root);
    this.root = root;
    this.spotlight = root.querySelector('.tour__spotlight');
    this.card = root.querySelector('.tour__card');
    this.arrow = root.querySelector('.tour__arrow');

    root.querySelector('.tour__skip').addEventListener('click', () => this.finish());
    root.querySelector('.tour__back').addEventListener('click', () => this.go(-1));
    root.querySelector('.tour__next').addEventListener('click', () => this.go(1));
  }

  onKeydown(event) {
    if (!this.active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.finish();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.go(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.go(-1);
    }
  }

  go(delta) {
    const next = this.index + delta;
    if (next < 0) return;
    if (next >= this.steps.length) {
      this.finish();
      return;
    }
    this.index = next;
    this.#render();
  }

  #render() {
    const step = this.steps[this.index];
    const root = this.root;

    root.querySelector('.tour__step').textContent = `${this.index + 1} of ${this.steps.length}`;
    root.querySelector('.tour__title').textContent = step.title;
    root.querySelector('.tour__body').textContent = step.body;
    root.classList.toggle('tour--emphasis', Boolean(step.emphasis));

    const back = root.querySelector('.tour__back');
    back.hidden = this.index === 0;
    const next = root.querySelector('.tour__next');
    next.querySelector('span').textContent = this.index === this.steps.length - 1 ? 'Got it' : 'Next';

    const dots = root.querySelector('.tour__dots');
    dots.replaceChildren();
    this.steps.forEach((_, i) => {
      const dot = document.createElement('span');
      dot.className = i === this.index ? 'tour__dot tour__dot--on' : 'tour__dot';
      dots.appendChild(dot);
    });

    this.reposition();
    // Focus the primary action so the tour is fully keyboard-operable.
    requestAnimationFrame(() => next.focus({ preventScroll: true }));
  }

  reposition() {
    if (!this.active) return;
    const step = this.steps[this.index];
    const target = document.querySelector(step.target);
    if (!target) {
      this.go(1);
      return;
    }

    const rect = target.getBoundingClientRect();
    // A target scrolled out of view cannot be explained — bring it back first.
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => this.reposition(), 260);
      return;
    }

    Object.assign(this.spotlight.style, {
      left: `${rect.left - GAP}px`,
      top: `${rect.top - GAP}px`,
      width: `${rect.width + GAP * 2}px`,
      height: `${rect.height + GAP * 2}px`,
    });

    this.#placeCard(rect, step.placement || 'bottom');
  }

  /**
   * Places the card, flipping to the opposite side when it would overflow.
   * On narrow screens it is docked to the bottom instead: a floating tooltip
   * beside a 340px-wide target has nowhere to go.
   */
  #placeCard(rect, preferred) {
    const card = this.card;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const narrow = viewportW < 620;

    card.classList.toggle('tour__card--docked', narrow);
    if (narrow) {
      card.style.left = '';
      card.style.top = '';
      this.arrow.style.display = 'none';
      return;
    }

    this.arrow.style.display = '';
    const cardRect = card.getBoundingClientRect();
    const width = cardRect.width;
    const height = cardRect.height;

    let placement = preferred;
    const spaceBelow = viewportH - rect.bottom;
    const spaceAbove = rect.top;
    if (placement === 'bottom' && spaceBelow < height + GAP + ARROW) placement = 'top';
    if (placement === 'top' && spaceAbove < height + GAP + ARROW) placement = 'bottom';

    let top = placement === 'top'
      ? rect.top - height - GAP - ARROW
      : rect.bottom + GAP + ARROW;
    let left = rect.left + rect.width / 2 - width / 2;

    // Keep the card fully on screen; the arrow tracks the target separately so
    // it still points at the right control after clamping.
    const margin = 16;
    left = Math.max(margin, Math.min(left, viewportW - width - margin));
    top = Math.max(margin, Math.min(top, viewportH - height - margin));

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;

    const arrowLeft = Math.max(
      ARROW * 2,
      Math.min(rect.left + rect.width / 2 - left, width - ARROW * 2),
    );
    this.arrow.style.left = `${arrowLeft}px`;
    this.arrow.dataset.placement = placement;
  }

  finish({ silent = false } = {}) {
    if (!this.active) return;
    this.active = false;
    if (this.key) Tour.markSeen(this.key);

    window.removeEventListener('resize', this.reposition);
    window.removeEventListener('scroll', this.reposition, { capture: true });
    document.removeEventListener('keydown', this.onKeydown);
    document.body.classList.remove('tour-active');

    const root = this.root;
    this.root = null;
    if (root) {
      root.classList.add('tour--closing');
      // Let the fade finish before removing, unless motion is reduced.
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => root.remove(), reduced ? 0 : 200);
    }
    if (!silent) this.onFinish?.();
  }
}

export default Tour;
