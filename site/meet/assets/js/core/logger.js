/**
 * Structured logging with an in-memory ring buffer.
 *
 * The buffer is what makes a failed call diagnosable after the fact: the user
 * can export a diagnostics bundle instead of trying to describe what happened.
 * It is bounded so an hour-long session cannot grow it without limit.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_ENTRIES = 500;

export class Logger {
  constructor({ scope = 'meet', level = 'info', buffer = null } = {}) {
    this.scope = scope;
    this.level = level;
    // Child loggers share the parent's buffer so one export covers everything.
    this.buffer = buffer || [];
  }

  child(scope) {
    return new Logger({ scope: `${this.scope}:${scope}`, level: this.level, buffer: this.buffer });
  }

  setLevel(level) {
    if (level in LEVELS) this.level = level;
  }

  #write(level, message, data) {
    const entry = {
      t: Date.now(),
      level,
      scope: this.scope,
      message: String(message),
      data: serialiseData(data),
    };
    this.buffer.push(entry);
    if (this.buffer.length > MAX_ENTRIES) this.buffer.splice(0, this.buffer.length - MAX_ENTRIES);
    if (LEVELS[level] < LEVELS[this.level]) return entry;
    const method = level === 'debug' ? 'log' : level;
    const args = [`[${this.scope}] ${message}`];
    if (data !== undefined) args.push(data);
    // eslint-disable-next-line no-console
    (console[method] || console.log).apply(console, args);
    return entry;
  }

  debug(message, data) { return this.#write('debug', message, data); }
  info(message, data) { return this.#write('info', message, data); }
  warn(message, data) { return this.#write('warn', message, data); }
  error(message, data) { return this.#write('error', message, data); }

  /** Everything needed to debug a bad call, with no meeting content in it. */
  diagnostics(extra = {}) {
    return {
      generatedAt: new Date().toISOString(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
      ...extra,
      entries: this.buffer.slice(),
    };
  }
}

/** Errors do not survive `JSON.stringify` — unwrap them before buffering. */
function serialiseData(data) {
  if (data === undefined) return undefined;
  if (data instanceof Error) {
    return { name: data.name, message: data.message, stack: data.stack };
  }
  if (data && typeof data === 'object') {
    try {
      // Round-trip to strip DOM nodes, MediaStreams and other unserialisables.
      return JSON.parse(JSON.stringify(data, replaceUnserialisable()));
    } catch {
      return { note: 'unserialisable', type: Object.prototype.toString.call(data) };
    }
  }
  return data;
}

function replaceUnserialisable() {
  const seen = new WeakSet();
  return (_key, value) => {
    if (typeof value === 'function') return '[function]';
    if (typeof value === 'bigint') return value.toString();
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[circular]';
      seen.add(value);
    }
    return value;
  };
}

export const logger = new Logger({ scope: 'nutramea', level: 'info' });

/** Routes uncaught errors and rejections into the same buffer. */
export function installGlobalErrorCapture(target = logger) {
  if (typeof window === 'undefined') return () => {};
  const onError = (event) => {
    target.error('uncaught error', {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      stack: event.error?.stack,
    });
  };
  const onRejection = (event) => {
    const reason = event.reason;
    target.error('unhandled rejection', reason instanceof Error ? reason : { reason: String(reason) });
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

export default logger;
