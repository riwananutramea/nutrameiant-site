/**
 * NutraMEA Meet — runtime configuration.
 *
 * Overridable without editing this file:
 *   1. `window.NUTRAMEA_MEET_CONFIG` (injected by WordPress via wp_localize_script)
 *   2. URL query parameters (testing: ?provider=jitsi&audioOnly=1)
 *
 * Cost model: every default here is zero-cost and cannot generate a bill.
 *   - Transport defaults to the public Jitsi deployment: no account, no API
 *     key, no per-minute charge, no duration cap.
 *   - Recording happens in the organiser's browser and is written straight to
 *     their disk. No provider recording endpoint is ever called.
 */

const DEFAULTS = {
  /* --------------------------------------------------------------- transport */
  // 'jitsi' — free forever, no key, no account, unlimited minutes. Default so
  //           a call can happen today without any provider onboarding.
  // 'daily' — used only when `daily.roomUrl` is supplied by the server. Daily's
  //           free tier covers the call itself; we never touch its paid
  //           recording API.
  provider: 'jitsi',

  jitsi: {
    // Swap for '8x8.vc' (JaaS) or a self-hosted 'meet.nutrameaint.com' later
    // without touching any other line of code.
    domain: 'meet.jit.si',
    tenant: '',
    jwt: '',
    // Namespacing stops NutraMEA rooms colliding with unrelated public rooms
    // on the shared meet.jit.si name space.
    roomPrefix: 'NutraMEAInt',
  },

  daily: {
    roomUrl: '',
    token: '',
  },

  /* --------------------------------------------------------------- branding */
  brandName: 'NutraMEA Intelligence',
  brandShort: 'NutraMEA Int.',
  /**
   * True when the app runs inside another NutraMEA page (My Account).
   *
   * The surrounding page already carries the logo, the site name and the
   * section heading, so repeating them inside the frame is pure duplication —
   * the same brand stated three times in 200 pixels. In embedded mode the app
   * drops its own chrome and keeps only what is functional.
   */
  embedded: false,

  /* ---------------------------------------------------------------- quality */
  // Sender resolution. 720p is the sweet spot: visibly crisp, and light enough
  // that an hour-long call will not thermal-throttle a laptop.
  quality: 720,
  // How many remote videos are received at full quality. Unbounded ("-1") is
  // the single biggest cause of lag on larger calls.
  channelLastN: 12,
  startWithAudioMuted: false,
  startWithVideoMuted: false,
  prejoinEnabled: true,

  /**
   * Resilience on weak/unstable connections.
   *
   * The requirement is that VOICE survives when the link degrades. Video is
   * always the first thing sacrificed — it is ~95% of the bitrate.
   */
  resilience: {
    // Keep audio flowing at a fixed floor even when video is starved.
    audioPriority: true,
    // Opus at 24 kbps mono is fully intelligible speech and survives links
    // that cannot carry video at all.
    audioBitrateFloor: 24000,
    // Drop video automatically after this many consecutive seconds of
    // "poor" connection quality, then restore it when the link recovers.
    autoAudioOnlyAfterPoorMs: 15000,
    autoRestoreVideoAfterGoodMs: 20000,
    // Let the user force audio-only from the lobby (weak-signal entry).
    allowAudioOnlyEntry: true,
  },

  /* -------------------------------------------------------------- recording */
  recording: {
    // 'auto' → stream straight to a file on disk when the File System Access
    // API exists; otherwise buffer crash-safely in IndexedDB.
    sink: 'auto',
    // ms between MediaRecorder chunks. Short slices bound how much is lost to
    // a crash; 2s matches the design validated against a 60-minute session.
    timesliceMs: 2000,
    videoBitsPerSecond: 1_200_000, // ~540 MB/hour at 720p
    audioBitsPerSecond: 128_000,
    // Hard ceiling so a forgotten tab cannot fill the disk. Comfortably above
    // the 1-hour target.
    maxDurationMs: 2 * 60 * 60 * 1000,
    warnAtBytes: 1_500_000_000,
    // Require every participant to consent before recording can start.
    requireConsent: true,
    // Block tab close / navigation while recording is live.
    guardUnload: true,
  },

  /* -------------------------------------------------------------- notetaker */
  // Strictly optional and fully isolated: if transcription fails for any
  // reason, the call and the recording are unaffected.
  notes: {
    enabled: true,
    // 'webspeech' — free, instant, no download, organiser's microphone.
    // 'whisper'   — free, offline, whole-room, ~75 MB model downloaded once.
    engine: 'webspeech',
    lang: 'en-US',
    whisperModel: 'Xenova/whisper-base.en',
    summariseEveryMs: 20000,
    // Max transcript rows kept in the DOM. The full transcript always lives in
    // memory — this only bounds rendering cost over a long call.
    renderWindow: 300,
  },

  /* ---------------------------------------------------------------- storage */
  storage: {
    // Google OAuth client ID. When empty, the Drive button is hidden and the
    // recording is delivered as a direct download instead. Drive uses the
    // member's own free 15 GB — no NutraMEA storage cost.
    googleClientId: '',
    // drive.file = access limited to files this app itself creates. The
    // minimum possible scope; it can never read the rest of a user's Drive.
    googleScope: 'https://www.googleapis.com/auth/drive.file',
    driveFolderName: 'NutraMEA Meetings',
    // Drive requires resumable chunks to be a multiple of 256 KiB.
    uploadChunkBytes: 8 * 1024 * 1024,
    shareAnyoneWithLink: true,
  },

  /* ------------------------------------------------------------------ debug */
  debug: false,
};

/** Keys overridable from the query string, with their coercion. */
const QUERY_OVERRIDES = {
  provider: String,
  room: String,
  name: String,
  lang: String,
  quality: Number,
  embedded: (v) => v !== '0' && v !== 'false',
  audioOnly: (v) => v !== '0' && v !== 'false',
  debug: (v) => v !== '0' && v !== 'false',
};

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

/** Deep merge that never mutates its inputs and never walks the prototype. */
export function mergeConfig(base, override) {
  if (!isPlainObject(override)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const key of Object.keys(override)) {
    // Guard against prototype pollution from server-injected config.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const next = override[key];
    if (isPlainObject(next) && isPlainObject(out[key])) {
      out[key] = mergeConfig(out[key], next);
    } else if (next !== undefined) {
      out[key] = next;
    }
  }
  return out;
}

/** Reads the whitelisted query-string overrides out of a search string. */
export function readQueryOverrides(search, spec = QUERY_OVERRIDES) {
  const params = new URLSearchParams(search || '');
  const out = {};
  for (const [key, coerce] of Object.entries(spec)) {
    if (!params.has(key)) continue;
    const value = coerce(params.get(key));
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Transports the app is allowed to load its SDK from.
 *
 * This list exists because the SDK is fetched as a <script> from the
 * configured domain. Anything that can set that domain can execute code on
 * this site's origin, so it cannot come from an untrusted source.
 */
export const TRUSTED_DOMAINS = Object.freeze([
  'meet.jit.si',
  '8x8.vc',
]);

const SHORT_TEXT = (v) => typeof v === 'string' && v.length > 0 && v.length <= 120;
const BOOLEAN = (v) => typeof v === 'boolean';
const SLUG = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v);

/**
 * The ONLY keys the `cfg` query parameter may set, each with a validator.
 *
 * `cfg` is attacker-controllable: the app's index.html is a static file, so
 * anyone can send a member a link to it carrying any `cfg` they like. An
 * allowlist is therefore the contract — unknown keys are dropped, and a value
 * that fails its validator is dropped rather than coerced, so a malformed
 * entry can never fall through to a weaker default.
 */
const PACKED_SCHEMA = Object.freeze({
  provider: (v) => v === 'jitsi' || v === 'daily',
  brandName: SHORT_TEXT,
  brandShort: SHORT_TEXT,
  embedded: BOOLEAN,
  quality: (v) => [180, 360, 720, 1080].includes(Number(v)),
  channelLastN: (v) => Number.isInteger(v) && v >= 1 && v <= 50,
  'jitsi.domain': (v) => isTrustedDomain(v),
  'jitsi.roomPrefix': SLUG,
  'jitsi.tenant': (v) => v === '' || SLUG(v),
  'notes.enabled': BOOLEAN,
  'notes.engine': (v) => v === 'webspeech' || v === 'whisper',
  'notes.lang': (v) => typeof v === 'string' && /^[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v),
});

/*
 * Deliberately absent from the schema above: everything under `storage`.
 *
 * Validating the SHAPE of a Google client ID is not enough — an attacker can
 * register a real OAuth application and get a genuinely well-formed ID. A
 * crafted link could then raise a real Google consent screen, launched from
 * this site, for an application they control. Drive settings therefore come
 * only from the trusted channel below, never from the URL.
 */

/** A hostname the SDK may be loaded from. */
export function isTrustedDomain(value, extra = []) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 253) return false;
  // Hostname only: no scheme, port, path, credentials or whitespace. Without
  // this, "meet.jit.si.evil.com" or "evil.com/#meet.jit.si" could slip past.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(value)) return false;
  const host = value.toLowerCase();
  return TRUSTED_DOMAINS.includes(host) || extra.map((d) => String(d).toLowerCase()).includes(host);
}

function readPath(object, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), object);
}

function writePath(object, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let node = object;
  for (const key of keys) {
    if (!isPlainObject(node[key])) node[key] = {};
    node = node[key];
  }
  node[last] = value;
}

/**
 * Reduces a decoded `cfg` to the keys it is allowed to set, dropping anything
 * that fails validation.
 *
 * `trustedDomains` lets a server-injected deployment (a self-hosted
 * meet.nutrameaint.com, say) stay usable without widening the static list:
 * that value came from the server, not the query string.
 */
export function sanitisePackedConfig(packed, { trustedDomains = [] } = {}) {
  const out = {};
  if (!isPlainObject(packed)) return out;
  for (const [path, isValid] of Object.entries(PACKED_SCHEMA)) {
    const value = readPath(packed, path);
    if (value === undefined) continue;
    const ok = path === 'jitsi.domain' ? isTrustedDomain(value, trustedDomains) : isValid(value);
    if (ok) writePath(out, path, value);
  }
  return out;
}

/**
 * Decodes the `cfg` query parameter: base64url-encoded JSON.
 *
 * This is how WordPress hands presentation settings to the app when it is
 * embedded in an iframe, where a `window.NUTRAMEA_MEET_CONFIG` global from the
 * parent page is not visible.
 *
 * Treat everything it returns as hostile — see sanitisePackedConfig().
 */
export function decodePackedConfig(value) {
  if (!value) return null;
  try {
    const base64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = decodeURIComponent(
      Array.from(atob(padded), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
    );
    const parsed = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    // A malformed parameter must never stop the page loading.
    return null;
  }
}

/**
 * The trusted configuration channel.
 *
 * The server renders `window.NUTRAMEA_MEET_CONFIG` inline on the page that
 * frames this app. Because that page and this one are same-origin, the global
 * is readable through `window.parent` — which makes it a channel an attacker
 * cannot write to, unlike the URL.
 *
 * Standalone (not framed), `window.parent === window`, so this simply reads
 * the app's own global. Cross-origin access throws by design, and a thrown
 * SecurityError here means the framing page is not ours — so we trust nothing
 * from it.
 */
export function readTrustedConfig(view = typeof window !== 'undefined' ? window : undefined) {
  if (!view) return null;
  if (isPlainObject(view.NUTRAMEA_MEET_CONFIG)) return view.NUTRAMEA_MEET_CONFIG;
  try {
    const parent = view.parent;
    if (parent && parent !== view && isPlainObject(parent.NUTRAMEA_MEET_CONFIG)) {
      return parent.NUTRAMEA_MEET_CONFIG;
    }
  } catch {
    // Cross-origin framing: not our page, so nothing here is trustworthy.
    return null;
  }
  return null;
}

export function buildConfig({ injected = null, search = '' } = {}) {
  // `injected` comes from the server through a channel the URL cannot reach,
  // and is trusted. `cfg` arrives in the URL and is not, so it is filtered
  // through an allowlist first.
  let config = mergeConfig(DEFAULTS, injected || {});

  const serverDomain = readPath(injected || {}, 'jitsi.domain');
  const packed = sanitisePackedConfig(
    decodePackedConfig(new URLSearchParams(search || '').get('cfg')),
    { trustedDomains: serverDomain ? [serverDomain] : [] },
  );
  config = mergeConfig(config, packed);

  const query = readQueryOverrides(search);
  // `room`, `name` and `audioOnly` are session state, not configuration.
  const { room, name, audioOnly, ...rest } = query;
  config = mergeConfig(config, rest);
  config.session = {
    room: room || '',
    displayName: name || '',
    audioOnly: Boolean(audioOnly),
  };
  return config;
}

export const config = buildConfig({
  injected: readTrustedConfig(),
  search: typeof window !== 'undefined' ? window.location.search : '',
});

export default config;
