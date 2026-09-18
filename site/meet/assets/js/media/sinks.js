/**
 * Where recorder output goes.
 *
 * A 60-minute 720p recording is roughly 540 MB. Accumulating that in a
 * JavaScript array is the single most common reason browser recordings die
 * partway through a long call — the tab is killed for memory long before the
 * user stops recording. Both sinks here therefore stream: a slice is handed
 * over and immediately forgotten.
 *
 *   FileSystemSink — writes straight to a file the user picked on disk.
 *                    Constant memory, and the file survives a browser crash.
 *                    Preferred wherever the File System Access API exists.
 *
 *   IndexedDbSink  — writes each slice as its own row. Slightly more overhead,
 *                    works everywhere, and allows recovery after a crash.
 */

export function supportsFileSystemSink() {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

/**
 * Serialises writes into a single promise chain.
 *
 * Overlapping writes to a FileSystemWritableFileStream throw, and awaiting
 * each write is also how backpressure reaches the recorder: if the disk cannot
 * keep up we find out here rather than by silently growing a queue.
 */
class WriteQueue {
  constructor() {
    this.tail = Promise.resolve();
    this.failed = null;
  }

  push(task) {
    const next = this.tail.then(() => {
      if (this.failed) throw this.failed;
      return task();
    });
    // Record the first failure; later writes short-circuit to it.
    this.tail = next.catch((error) => {
      if (!this.failed) this.failed = error;
    });
    return next;
  }

  drain() {
    return this.tail.then(() => {
      if (this.failed) throw this.failed;
    });
  }
}

export class FileSystemSink {
  constructor(fileHandle, writable, filename) {
    this.kind = 'file';
    this.fileHandle = fileHandle;
    this.writable = writable;
    this.filename = filename;
    this.bytesWritten = 0;
    this.queue = new WriteQueue();
    this.closed = false;
  }

  /**
   * Must be called inside a user gesture — the file picker demands one.
   * Returns null when the user cancels, which is a normal outcome, not an error.
   */
  static async create(filename) {
    if (!supportsFileSystemSink()) return null;
    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: 'NutraMEA meeting recording',
          accept: { 'video/webm': ['.webm'] },
        }],
      });
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      throw error;
    }
    const writable = await handle.createWritable();
    return new FileSystemSink(handle, writable, filename);
  }

  async write(blob) {
    if (this.closed) throw new Error('Sink is closed.');
    return this.queue.push(async () => {
      await this.writable.write(blob);
      this.bytesWritten += blob.size;
    });
  }

  async finalize() {
    if (this.closed) return this.result();
    await this.queue.drain();
    await this.writable.close();
    this.closed = true;
    return this.result();
  }

  result() {
    return {
      kind: 'file',
      filename: this.filename,
      bytes: this.bytesWritten,
      fileHandle: this.fileHandle,
      // The bytes are already on the user's disk; there is no Blob to hand back
      // and deliberately so — materialising one would undo the whole point.
      blob: null,
    };
  }

  async abort() {
    if (this.closed) return;
    this.closed = true;
    try {
      // Keep whatever was written: a partial recording of a call that crashed
      // is far more valuable than no recording.
      await this.writable.close();
    } catch {
      /* stream already torn down */
    }
  }
}

export class IndexedDbSink {
  constructor(store, sessionId, mimeType) {
    this.kind = 'indexeddb';
    this.store = store;
    this.sessionId = sessionId;
    this.mimeType = mimeType;
    this.seq = 0;
    this.bytesWritten = 0;
    this.queue = new WriteQueue();
    this.closed = false;
  }

  static async create(store, sessionId, mimeType) {
    return new IndexedDbSink(store, sessionId, mimeType);
  }

  async write(blob) {
    if (this.closed) throw new Error('Sink is closed.');
    const seq = this.seq;
    this.seq += 1;
    return this.queue.push(async () => {
      await this.store.putChunk(this.sessionId, seq, blob);
      this.bytesWritten += blob.size;
    });
  }

  async finalize() {
    if (!this.closed) {
      await this.queue.drain();
      this.closed = true;
    }
    const blob = await this.store.assembleChunks(this.sessionId, this.mimeType);
    return {
      kind: 'indexeddb',
      filename: null,
      bytes: blob.size,
      fileHandle: null,
      blob,
    };
  }

  async abort() {
    this.closed = true;
    try {
      await this.queue.drain();
    } catch {
      /* the slices already persisted remain recoverable */
    }
  }
}

/**
 * Picks a sink according to configuration and capability.
 *
 * `preference`: 'auto' | 'file' | 'indexeddb'. 'auto' prefers the disk stream
 * and silently falls back — including when the user cancels the file picker,
 * because losing the recording entirely over a mis-click would be indefensible.
 */
export async function createSink({ preference = 'auto', filename, store, sessionId, mimeType, logger }) {
  const wantsFile = preference === 'file' || (preference === 'auto' && supportsFileSystemSink());

  if (wantsFile) {
    try {
      const sink = await FileSystemSink.create(filename);
      if (sink) {
        logger?.info('recording direct to disk', { filename });
        return sink;
      }
      logger?.info('file picker dismissed — buffering in browser storage instead');
    } catch (error) {
      logger?.warn('disk sink unavailable, falling back to browser storage', error);
      if (preference === 'file') throw error;
    }
  }

  logger?.info('recording to browser storage', { sessionId });
  return IndexedDbSink.create(store, sessionId, mimeType);
}
