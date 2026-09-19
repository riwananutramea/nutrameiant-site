/**
 * Google Drive delivery — the "free cloud storage with a direct link" path.
 *
 * The file goes into the member's OWN Drive, using their own free 15 GB. That
 * means no storage bill for NutraMEA, no egress bill, and the member keeps
 * ownership of their meeting. The scope requested is `drive.file`, the
 * narrowest one Google offers: this app can only ever see files it created
 * itself, never the rest of the user's Drive.
 *
 * Uploads are resumable and chunked because a 60-minute recording is several
 * hundred megabytes and a single PUT over hotel wifi will not survive.
 */

import { loadScript } from '../media/loader.js';
import { retry } from '../core/util.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true';
const FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';

/** Drive requires every chunk except the last to be a multiple of 256 KiB. */
export const CHUNK_GRANULARITY = 256 * 1024;

export function normaliseChunkSize(bytes) {
  const requested = Number(bytes) || 8 * 1024 * 1024;
  const rounded = Math.round(requested / CHUNK_GRANULARITY) * CHUNK_GRANULARITY;
  return Math.max(CHUNK_GRANULARITY, rounded);
}

/** `bytes 0-262143/1048576` — inclusive end offset, as the API expects. */
export function contentRange(start, endExclusive, total) {
  return `bytes ${start}-${endExclusive - 1}/${total}`;
}

/**
 * A 308 response reports progress in `Range: bytes=0-262143`, meaning bytes up
 * to and including 262143 are stored, so the next byte to send is 262144.
 * A missing header means nothing has been stored yet.
 */
export function parseResumeOffset(rangeHeader) {
  if (!rangeHeader) return 0;
  const match = /bytes=(\d+)-(\d+)/.exec(rangeHeader);
  if (!match) return 0;
  return Number(match[2]) + 1;
}

export function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

export function isConfigured(config) {
  return Boolean(config?.storage?.googleClientId);
}

export class DriveStorage {
  constructor({ config, logger, bus }) {
    this.config = config;
    this.settings = config.storage || {};
    this.log = logger.child('drive');
    this.bus = bus;
    this.tokenClient = null;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.folderId = null;
  }

  get isConfigured() {
    return isConfigured(this.config);
  }

  async #ensureTokenClient() {
    if (this.tokenClient) return;
    if (!this.isConfigured) {
      throw new Error('Google Drive is not configured for this site. Use Download instead, or add a Google client ID in the meeting settings.');
    }
    await loadScript(GIS_SRC, { timeoutMs: 15000 });
    if (!window.google?.accounts?.oauth2) {
      throw new Error('Google sign-in did not load. It may be blocked by an extension or network policy.');
    }
    this.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: this.settings.googleClientId,
      scope: this.settings.googleScope || 'https://www.googleapis.com/auth/drive.file',
      callback: () => {}, // replaced per request below
    });
  }

  /** Interactive on first use, silent afterwards until the token expires. */
  async authorise({ interactive = true } = {}) {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) return this.accessToken;
    await this.#ensureTokenClient();

    return new Promise((resolve, reject) => {
      this.tokenClient.callback = (response) => {
        if (response.error) {
          reject(new Error(
            response.error === 'access_denied'
              ? 'Google Drive access was declined. The recording is still on this computer — use Download.'
              : `Google sign-in failed: ${response.error}`,
          ));
          return;
        }
        this.accessToken = response.access_token;
        // `expires_in` is seconds; default to Google's usual hour.
        this.tokenExpiresAt = Date.now() + (Number(response.expires_in || 3600) * 1000);
        resolve(this.accessToken);
      };
      try {
        this.tokenClient.requestAccessToken({ prompt: interactive ? '' : 'none' });
      } catch (error) {
        reject(error);
      }
    });
  }

  async #fetchJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const error = new Error(`Drive API ${response.status}: ${body.slice(0, 300)}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  /** Finds or creates the NutraMEA Meetings folder so recordings stay together. */
  async ensureFolder() {
    if (this.folderId) return this.folderId;
    const name = this.settings.driveFolderName || 'NutraMEA Meetings';
    // Only folders this app created are visible under the drive.file scope,
    // which is exactly what we want: our folder, nobody else's.
    const query = encodeURIComponent(
      `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false`,
    );
    try {
      const found = await this.#fetchJson(`${FILES_ENDPOINT}?q=${query}&fields=files(id,name)&pageSize=1`);
      if (found.files?.length) {
        this.folderId = found.files[0].id;
        return this.folderId;
      }
    } catch (error) {
      this.log.warn('folder lookup failed, will create', error);
    }
    const created = await this.#fetchJson(`${FILES_ENDPOINT}?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
    });
    this.folderId = created.id;
    return this.folderId;
  }

  /** Opens a resumable session and returns the session URL. */
  async #createSession({ name, mimeType, size, parents }) {
    const response = await fetch(UPLOAD_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify({ name, mimeType, ...(parents ? { parents } : {}) }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Could not start the Drive upload (${response.status}): ${body.slice(0, 200)}`);
    }
    const location = response.headers.get('Location');
    if (!location) throw new Error('Drive did not return an upload session URL.');
    return location;
  }

  /**
   * Uploads a Blob/File in chunks.
   *
   * `blob.slice()` is a view, not a copy, so peak memory stays at one chunk
   * regardless of whether the recording is 50 MB or 2 GB.
   */
  async upload(blob, { name, mimeType, onProgress = null, signal = null } = {}) {
    await this.authorise();
    const parents = await this.ensureFolder().then((id) => (id ? [id] : null)).catch(() => null);

    const total = blob.size;
    const chunkSize = normaliseChunkSize(this.settings.uploadChunkBytes);
    const sessionUrl = await this.#createSession({ name, mimeType, size: total, parents });
    this.log.info('drive upload session opened', { name, total, chunkSize });

    let offset = 0;
    let fileId = null;

    while (offset < total) {
      if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
      const end = Math.min(offset + chunkSize, total);
      const chunk = blob.slice(offset, end);

      // eslint-disable-next-line no-await-in-loop -- chunks are strictly ordered
      const outcome = await retry(async () => {
        const response = await fetch(sessionUrl, {
          method: 'PUT',
          headers: { 'Content-Range': contentRange(offset, end, total) },
          body: chunk,
          signal,
        });

        if (response.status === 308) {
          return { done: false, nextOffset: parseResumeOffset(response.headers.get('Range')) || end };
        }
        if (response.ok) {
          const body = await response.json().catch(() => ({}));
          return { done: true, id: body.id };
        }
        const body = await response.text().catch(() => '');
        const error = new Error(`Drive upload failed (${response.status}): ${body.slice(0, 200)}`);
        error.status = response.status;
        throw error;
      }, {
        attempts: 5,
        baseMs: 800,
        // 4xx other than 429 means the request itself is wrong; retrying is futile.
        shouldRetry: (error) => !error.status || isRetryableStatus(error.status),
        onRetry: (error, attempt) => this.log.warn('retrying chunk', { attempt, message: error.message }),
        signal,
      });

      if (outcome.done) {
        fileId = outcome.id;
        offset = total;
      } else {
        offset = outcome.nextOffset;
      }
      onProgress?.({ uploaded: Math.min(offset, total), total });
    }

    if (!fileId) throw new Error('The Drive upload finished without returning a file id.');

    let link = `https://drive.google.com/file/d/${fileId}/view`;
    if (this.settings.shareAnyoneWithLink) {
      try {
        await this.#share(fileId);
      } catch (error) {
        // The file is safely uploaded; only the sharing step failed.
        this.log.warn('could not set link sharing', error);
        this.bus.emit('storage:warning', {
          message: 'The recording uploaded, but link sharing could not be enabled automatically. Open it in Drive and share it manually.',
        });
      }
      try {
        const meta = await this.#fetchJson(`${FILES_ENDPOINT}/${fileId}?fields=webViewLink`);
        if (meta.webViewLink) link = meta.webViewLink;
      } catch {
        /* the constructed link is a fine fallback */
      }
    }

    this.log.info('drive upload complete', { fileId });
    return { fileId, link, bytes: total };
  }

  async #share(fileId) {
    await this.#fetchJson(`${FILES_ENDPOINT}/${fileId}/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
  }

  /** Small sidecar files (notes, transcript, subtitles) beside the recording. */
  async uploadText(text, { name, mimeType = 'text/plain' }) {
    await this.authorise();
    const parents = await this.ensureFolder().then((id) => (id ? [id] : null)).catch(() => null);
    const blob = new Blob([text], { type: mimeType });
    return this.upload(blob, { name, mimeType });
  }
}

export default DriveStorage;
