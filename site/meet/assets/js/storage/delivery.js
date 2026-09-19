/**
 * Getting a finished recording to the person who needs it.
 *
 * Three destinations, in descending order of "already done":
 *   1. Already on disk — the File System Access sink wrote it there live, so
 *      there is nothing left to do but say where it is.
 *   2. Download — always available, zero configuration.
 *   3. Google Drive — the member's own free storage, producing a shareable
 *      link so the recording can be reached from anywhere.
 */

import { downloadBlob, formatBytes } from '../core/util.js';
import { DriveStorage, isConfigured as driveConfigured } from './drive.js';

/**
 * Materialises a recording result as a Blob.
 *
 * For the disk sink the bytes are already in a file, so we re-open the handle
 * rather than having kept a copy in memory — that is the whole point of that
 * sink. `getFile()` returns a File, which is a lazy view over the data on disk,
 * so this does not pull hundreds of megabytes into RAM.
 */
export async function resolveBlob(result) {
  if (!result) return null;
  if (result.blob) return result.blob;
  if (result.fileHandle?.getFile) {
    try {
      return await result.fileHandle.getFile();
    } catch (error) {
      throw new Error(`The recording file could not be reopened: ${error.message}`);
    }
  }
  return null;
}

export class DeliveryService {
  constructor({ config, logger, bus }) {
    this.config = config;
    this.log = logger.child('delivery');
    this.bus = bus;
    this.drive = new DriveStorage({ config, logger, bus });
  }

  get driveAvailable() {
    return driveConfigured(this.config);
  }

  /** Human-readable statement of where the recording currently is. */
  describe(result) {
    if (!result) return 'No recording.';
    if (result.kind === 'file') {
      return `Saved to your computer as ${result.filename} (${formatBytes(result.bytes)}).`;
    }
    return `Held in this browser (${formatBytes(result.bytes)}). Download it or send it to Drive before clearing site data.`;
  }

  async download(result, filename) {
    const blob = await resolveBlob(result);
    if (!blob) {
      // The disk sink already wrote the file; re-downloading would duplicate it.
      throw new Error('This recording was written straight to your computer — it is already saved.');
    }
    downloadBlob(blob, filename);
    this.log.info('recording downloaded', { filename, bytes: blob.size });
    return { filename, bytes: blob.size };
  }

  async uploadToDrive(result, { name, onProgress = null, signal = null } = {}) {
    const blob = await resolveBlob(result);
    if (!blob) throw new Error('The recording could not be read back for upload.');
    return this.drive.upload(blob, {
      name,
      mimeType: result.mimeType || blob.type || 'video/webm',
      onProgress,
      signal,
    });
  }

  /** Uploads the notes/transcript/subtitles beside the video. */
  async uploadSidecars(files) {
    const results = [];
    for (const file of files) {
      try {
        // eslint-disable-next-line no-await-in-loop -- keeps Drive rate limits happy
        const uploaded = await this.drive.uploadText(file.text, {
          name: file.name,
          mimeType: file.mimeType,
        });
        results.push({ name: file.name, ...uploaded });
      } catch (error) {
        this.log.warn('sidecar upload failed', { name: file.name, error });
        results.push({ name: file.name, error: error.message });
      }
    }
    return results;
  }
}

export default DeliveryService;
