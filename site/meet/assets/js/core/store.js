/**
 * IndexedDB persistence for NutraMEA Meet.
 *
 * Three stores:
 *   sessions — one row per meeting (room, timings, recording state, notes)
 *   chunks   — recorder output, one row per MediaRecorder slice
 *   notes    — transcript segments, flushed periodically
 *
 * `chunks` is the important one. A 1-hour recording is ~540 MB; holding that
 * in a JavaScript array is what makes long browser recordings crash. Every
 * slice is written here the moment it arrives and dropped from memory, which
 * also means an interrupted call can be recovered on the next page load.
 */

const DB_NAME = 'nutramea-meet';
const DB_VERSION = 1;

export const STORE_SESSIONS = 'sessions';
export const STORE_CHUNKS = 'chunks';
export const STORE_NOTES = 'notes';

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Resolves only once the transaction itself commits, not merely the request. */
function promisifyTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new DOMException('Aborted', 'AbortError'));
  });
}

export function isSupported() {
  return typeof indexedDB !== 'undefined';
}

export async function openDatabase(name = DB_NAME, version = DB_VERSION) {
  if (!isSupported()) throw new Error('IndexedDB is unavailable in this browser.');
  const request = indexedDB.open(name, version);
  request.onupgradeneeded = (event) => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
      db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
      // Compound key keeps each session's slices contiguous and in order, so
      // reassembly is a single ordered range scan with no sorting.
      const store = db.createObjectStore(STORE_CHUNKS, { keyPath: ['sessionId', 'seq'] });
      store.createIndex('bySession', 'sessionId', { unique: false });
    }
    if (!db.objectStoreNames.contains(STORE_NOTES)) {
      const store = db.createObjectStore(STORE_NOTES, { keyPath: ['sessionId', 'seq'] });
      store.createIndex('bySession', 'sessionId', { unique: false });
    }
    if (event.oldVersion > 0) {
      // Future migrations hang here; v1 needs none.
    }
  };
  return promisifyRequest(request);
}

/**
 * The key range covering exactly one session in a compound-key store.
 * Exported because it is easy to get subtly wrong and is worth testing.
 */
export function sessionKeyRange(sessionId) {
  // Keys are [sessionId, seq] with seq a non-negative integer, so the bounds
  // are the lowest and highest possible seq for this session id.
  return IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]);
}

export class MeetStore {
  constructor(db) {
    this.db = db;
  }

  static async open() {
    return new MeetStore(await openDatabase());
  }

  #tx(storeNames, mode) {
    return this.db.transaction(storeNames, mode);
  }

  /* ------------------------------------------------------------- sessions */

  async putSession(session) {
    const tx = this.#tx(STORE_SESSIONS, 'readwrite');
    tx.objectStore(STORE_SESSIONS).put(session);
    await promisifyTransaction(tx);
    return session;
  }

  async getSession(id) {
    const tx = this.#tx(STORE_SESSIONS, 'readonly');
    return promisifyRequest(tx.objectStore(STORE_SESSIONS).get(id));
  }

  async listSessions() {
    const tx = this.#tx(STORE_SESSIONS, 'readonly');
    const all = await promisifyRequest(tx.objectStore(STORE_SESSIONS).getAll());
    return all.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }

  async patchSession(id, patch) {
    const tx = this.#tx(STORE_SESSIONS, 'readwrite');
    const store = tx.objectStore(STORE_SESSIONS);
    const existing = await promisifyRequest(store.get(id));
    if (!existing) {
      await promisifyTransaction(tx);
      return null;
    }
    const next = { ...existing, ...patch };
    store.put(next);
    await promisifyTransaction(tx);
    return next;
  }

  /* --------------------------------------------------------------- chunks */

  /**
   * Persists one recorder slice. Awaits transaction commit so the caller can
   * apply backpressure — without it a slow disk would queue slices in memory
   * and reintroduce the very problem this store exists to avoid.
   */
  async putChunk(sessionId, seq, blob) {
    const tx = this.#tx(STORE_CHUNKS, 'readwrite');
    tx.objectStore(STORE_CHUNKS).put({ sessionId, seq, blob, size: blob.size, t: Date.now() });
    await promisifyTransaction(tx);
  }

  async countChunks(sessionId) {
    const tx = this.#tx(STORE_CHUNKS, 'readonly');
    return promisifyRequest(tx.objectStore(STORE_CHUNKS).count(sessionKeyRange(sessionId)));
  }

  /** Reassembles a session's slices, in order, into a single Blob. */
  async assembleChunks(sessionId, mimeType) {
    const tx = this.#tx(STORE_CHUNKS, 'readonly');
    const rows = await promisifyRequest(tx.objectStore(STORE_CHUNKS).getAll(sessionKeyRange(sessionId)));
    rows.sort((a, b) => a.seq - b.seq);
    return new Blob(rows.map((row) => row.blob), { type: mimeType || 'video/webm' });
  }

  async totalChunkBytes(sessionId) {
    const tx = this.#tx(STORE_CHUNKS, 'readonly');
    const rows = await promisifyRequest(tx.objectStore(STORE_CHUNKS).getAll(sessionKeyRange(sessionId)));
    return rows.reduce((sum, row) => sum + (row.size || 0), 0);
  }

  async deleteChunks(sessionId) {
    const tx = this.#tx(STORE_CHUNKS, 'readwrite');
    tx.objectStore(STORE_CHUNKS).delete(sessionKeyRange(sessionId));
    await promisifyTransaction(tx);
  }

  /* ---------------------------------------------------------------- notes */

  async putNotes(sessionId, seq, segments) {
    const tx = this.#tx(STORE_NOTES, 'readwrite');
    tx.objectStore(STORE_NOTES).put({ sessionId, seq, segments, t: Date.now() });
    await promisifyTransaction(tx);
  }

  async loadNotes(sessionId) {
    const tx = this.#tx(STORE_NOTES, 'readonly');
    const rows = await promisifyRequest(tx.objectStore(STORE_NOTES).getAll(sessionKeyRange(sessionId)));
    rows.sort((a, b) => a.seq - b.seq);
    return rows.flatMap((row) => row.segments || []);
  }

  /* ------------------------------------------------------------- lifecycle */

  /** Sessions that were recording when the tab died, and still have data. */
  async findRecoverable() {
    const sessions = await this.listSessions();
    const out = [];
    for (const session of sessions) {
      if (session.recordingState !== 'recording' && session.recordingState !== 'interrupted') continue;
      const bytes = await this.totalChunkBytes(session.id);
      if (bytes > 0) out.push({ ...session, recoveredBytes: bytes });
    }
    return out;
  }

  async purgeSession(sessionId) {
    await this.deleteChunks(sessionId);
    const tx = this.#tx([STORE_SESSIONS, STORE_NOTES], 'readwrite');
    tx.objectStore(STORE_SESSIONS).delete(sessionId);
    tx.objectStore(STORE_NOTES).delete(sessionKeyRange(sessionId));
    await promisifyTransaction(tx);
  }

  /** Drops finished sessions older than `maxAgeMs` so storage stays bounded. */
  async purgeOlderThan(maxAgeMs) {
    const cutoff = Date.now() - maxAgeMs;
    const sessions = await this.listSessions();
    const purged = [];
    for (const session of sessions) {
      const stamp = session.endedAt || session.startedAt || 0;
      if (stamp && stamp < cutoff && session.recordingState !== 'recording') {
        await this.purgeSession(session.id);
        purged.push(session.id);
      }
    }
    return purged;
  }

  close() {
    this.db.close();
  }
}

/**
 * Best-effort persistent storage grant. Without it the browser may evict an
 * in-progress recording under disk pressure.
 */
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return { supported: false, persisted: false };
  try {
    const already = await navigator.storage.persisted();
    const persisted = already || (await navigator.storage.persist());
    return { supported: true, persisted };
  } catch {
    return { supported: true, persisted: false };
  }
}

/** Remaining quota, used to warn before a long recording runs out of room. */
export async function estimateQuota() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    return { quota, usage, available: Math.max(0, quota - usage) };
  } catch {
    return null;
  }
}

export default MeetStore;
