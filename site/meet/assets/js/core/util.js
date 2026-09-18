/** Small dependency-free helpers shared across NutraMEA Meet. */

/** `12345678` → `"3:25:45"` / `"05:45"`. Used for transcript + recorder clocks. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** WebVTT cue timestamp: always `HH:MM:SS.mmm`. */
export function formatVttTime(ms) {
  const clamped = Math.max(0, Math.floor(Number(ms) || 0));
  const h = Math.floor(clamped / 3600000);
  const m = Math.floor((clamped % 3600000) / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  const msPart = clamped % 1000;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(msPart, 3)}`;
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

/**
 * Room names travel through URLs and Jitsi's XMPP layer, which is unhappy with
 * spaces, punctuation and non-ASCII. Normalise hard, but never return empty.
 */
export function slugifyRoom(input) {
  const base = String(input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'room';
}

/** Cryptographically random, human-typable room id: `nutramea-4f2k-9dqx`. */
export function randomRoomName(prefix = 'nutramea') {
  // Ambiguous glyphs (0/O, 1/l/I) removed so rooms survive being read aloud.
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(8);
  cryptoSource().getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    if (i === 4) out += '-';
    out += alphabet[bytes[i] % alphabet.length];
  }
  return `${slugifyRoom(prefix)}-${out}`;
}

export function uid(prefix = 'id') {
  const bytes = new Uint8Array(8);
  cryptoSource().getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

function cryptoSource() {
  if (typeof globalThis.crypto?.getRandomValues === 'function') return globalThis.crypto;
  throw new Error('Secure crypto unavailable — NutraMEA Meet requires HTTPS.');
}

export function debounce(fn, waitMs) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

/**
 * Rate-limits `fn` to once per `waitMs`, always running a trailing call so the
 * final state is never dropped. Used for progress bars during long uploads.
 */
export function throttle(fn, waitMs) {
  let last = 0;
  let timer = null;
  let pending = null;
  const run = (args) => {
    last = Date.now();
    pending = null;
    fn(...args);
  };
  return (...args) => {
    const now = Date.now();
    const remaining = waitMs - (now - last);
    pending = args;
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      run(args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        if (pending) run(pending);
      }, remaining);
    }
  };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry with exponential backoff and full jitter.
 * `shouldRetry` lets callers stop early on permanent failures (4xx, aborts).
 */
export async function retry(fn, {
  attempts = 5,
  baseMs = 500,
  maxMs = 16000,
  shouldRetry = () => true,
  onRetry = null,
  signal = null,
} = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const isLast = attempt === attempts - 1;
      if (isLast || !shouldRetry(error, attempt)) throw error;
      const ceiling = Math.min(maxMs, baseMs * 2 ** attempt);
      // Full jitter avoids thundering-herd retries when a room reconnects.
      const delay = Math.random() * ceiling;
      if (onRetry) onRetry(error, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastError;
}

/** Escapes text destined for `innerHTML`. Prefer textContent where possible. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Estimated bytes for a recording of `ms` at the configured bitrates.
 * Drives the "this call will use ~540 MB" hint before the user hits record.
 */
export function estimateRecordingBytes(ms, videoBps, audioBps) {
  const seconds = Math.max(0, Number(ms) || 0) / 1000;
  const bits = seconds * ((Number(videoBps) || 0) + (Number(audioBps) || 0));
  // WebM container overhead is ~1.5% for 5s clusters.
  return Math.round((bits / 8) * 1.015);
}

/** Triggers a browser download without leaking the object URL. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke late: Safari aborts the download if the URL dies too early.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** `2026-09-18_14-05` — filename-safe, sorts chronologically. */
export function timestampSlug(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    '-', pad(date.getMonth() + 1),
    '-', pad(date.getDate()),
    '_', pad(date.getHours()),
    '-', pad(date.getMinutes()),
  ].join('');
}
