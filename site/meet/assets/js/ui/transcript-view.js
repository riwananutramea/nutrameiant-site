/**
 * Live transcript renderer.
 *
 * An hour of conversation is roughly 8,000 lines. Appending each one to the DOM
 * and leaving it there makes the page progressively slower until, somewhere in
 * the second half of the meeting, scrolling visibly stutters — the exact lag
 * this build has to avoid.
 *
 * So: the DOM holds a bounded window of recent lines while the full transcript
 * lives in the Transcriber. Exports read from the data, never from the DOM.
 *
 * The interim (still-being-recognised) line is a single node mutated in place.
 * Recreating it on every partial result would mean hundreds of node
 * insertions per minute.
 */

import { formatDuration } from '../core/util.js';

export class TranscriptView {
  constructor({ container, windowSize = 300 }) {
    this.container = container;
    this.windowSize = windowSize;
    this.list = document.createElement('div');
    this.list.className = 'transcript__list';
    this.interim = document.createElement('div');
    this.interim.className = 'transcript__line transcript__line--interim';
    this.interim.hidden = true;

    this.empty = document.createElement('p');
    this.empty.className = 'transcript__empty';
    this.empty.textContent = 'Live notes will appear here once someone speaks.';

    this.container.append(this.empty, this.list, this.interim);

    this.autoScroll = true;
    this.hiddenCount = 0;
    this.notice = null;

    // Reading back through the transcript must not be yanked to the bottom by
    // the next thing someone says.
    this.container.addEventListener('scroll', () => {
      const distanceFromBottom = this.container.scrollHeight
        - this.container.scrollTop - this.container.clientHeight;
      this.autoScroll = distanceFromBottom < 60;
    }, { passive: true });
  }

  append(segment) {
    this.empty.hidden = true;
    const line = this.#buildLine(segment);
    this.list.appendChild(line);
    this.#trim();
    this.#scrollIfPinned();
  }

  #buildLine(segment) {
    const line = document.createElement('div');
    line.className = 'transcript__line';

    const meta = document.createElement('div');
    meta.className = 'transcript__meta';

    const speaker = document.createElement('span');
    speaker.className = 'transcript__speaker';
    // textContent throughout: transcript text is user-supplied and must never
    // be parsed as markup.
    speaker.textContent = segment.speaker || 'Participant';

    const time = document.createElement('time');
    time.className = 'transcript__time';
    time.textContent = formatDuration(segment.t0 || 0);

    meta.append(speaker, time);

    const text = document.createElement('p');
    text.className = 'transcript__text';
    text.textContent = segment.text;

    line.append(meta, text);
    return line;
  }

  /** Drops the oldest nodes once the window is full. */
  #trim() {
    let overflow = this.list.childElementCount - this.windowSize;
    if (overflow <= 0) return;
    while (overflow > 0 && this.list.firstElementChild) {
      this.list.firstElementChild.remove();
      this.hiddenCount += 1;
      overflow -= 1;
    }
    this.#renderNotice();
  }

  #renderNotice() {
    if (!this.notice) {
      this.notice = document.createElement('p');
      this.notice.className = 'transcript__notice';
      this.list.parentElement.insertBefore(this.notice, this.list);
    }
    this.notice.textContent =
      `${this.hiddenCount} earlier ${this.hiddenCount === 1 ? 'line is' : 'lines are'} kept in the full transcript — export to see everything.`;
  }

  setInterim(text) {
    if (!text) {
      this.interim.hidden = true;
      this.interim.textContent = '';
      return;
    }
    this.empty.hidden = true;
    this.interim.hidden = false;
    this.interim.textContent = text;
    this.#scrollIfPinned();
  }

  #scrollIfPinned() {
    if (!this.autoScroll) return;
    // Next frame: scrollHeight is not final until the new node has been laid out.
    requestAnimationFrame(() => {
      this.container.scrollTop = this.container.scrollHeight;
    });
  }

  /** Re-renders from data — used when restoring a recovered session. */
  reset(segments = []) {
    this.list.replaceChildren();
    this.hiddenCount = 0;
    if (this.notice) {
      this.notice.remove();
      this.notice = null;
    }
    const tail = segments.slice(-this.windowSize);
    this.hiddenCount = Math.max(0, segments.length - tail.length);
    const fragment = document.createDocumentFragment();
    for (const segment of tail) fragment.appendChild(this.#buildLine(segment));
    this.list.appendChild(fragment);
    if (this.hiddenCount > 0) this.#renderNotice();
    this.empty.hidden = segments.length > 0;
    this.autoScroll = true;
    this.#scrollIfPinned();
  }
}

export default TranscriptView;
