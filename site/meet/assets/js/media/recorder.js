/**
 * Browser-native meeting recorder.
 *
 * Deliberately uses no provider recording API. Every hosted option (Daily's
 * cloud *and* local recording modes, Jitsi's Jibri, Zoom's cloud) is either
 * metered or requires a paid plan. This records the tab locally instead, which
 * is free permanently and keeps the file in the organiser's own hands.
 *
 * How it works:
 *   1. `getDisplayMedia` captures this tab — including the cross-origin call
 *      iframe, because tab capture takes rendered pixels — plus the tab's
 *      audio output, which is every remote participant's voice.
 *   2. The organiser's microphone is mixed in separately. It is NOT part of the
 *      tab's audio, since you never hear yourself played back; without this
 *      step the organiser is silent in their own recording.
 *   3. `MediaRecorder` emits a slice every couple of seconds, and each slice is
 *      streamed to disk and dropped. Memory stays flat for the whole hour.
 */

import { createSink, supportsFileSystemSink } from './sinks.js';
import { estimateRecordingBytes, formatBytes } from '../core/util.js';

/**
 * Codec preference, best first.
 *
 * VP9 gives noticeably better quality per bit than VP8 at the same bitrate,
 * which matters for readable screen-shared text. H.264 is the Safari path.
 */
export const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=h264,opus',
  'video/webm',
  'video/mp4',
];

/** First supported container/codec pair, or null if recording is impossible. */
export function pickMimeType(candidates = MIME_CANDIDATES, isSupported = null) {
  const check = isSupported
    || (typeof MediaRecorder !== 'undefined'
      ? (type) => MediaRecorder.isTypeSupported(type)
      : () => false);
  for (const candidate of candidates) {
    try {
      if (check(candidate)) return candidate;
    } catch {
      /* probing must never throw out of here */
    }
  }
  return null;
}

export function fileExtensionFor(mimeType) {
  return String(mimeType || '').includes('mp4') ? 'mp4' : 'webm';
}

/**
 * Tab-capture request options.
 *
 * Exported so the pre-flight check can capture through exactly the same call
 * the real recorder uses. A setup test that exercises a different code path
 * proves nothing about the recording that matters.
 */
export const DISPLAY_CAPTURE_OPTIONS = {
  video: {
    displaySurface: 'browser',
    frameRate: { ideal: 30, max: 30 },
  },
  // The tab's audio is already processed by the call client; re-processing it
  // here would double up and sound worse.
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
  // Chromium hints that steer the picker toward "this tab".
  preferCurrentTab: true,
  selfBrowserSurface: 'include',
  systemAudio: 'include',
  surfaceSwitching: 'exclude',
};

export function isRecordingSupported() {
  return typeof MediaRecorder !== 'undefined'
    && typeof navigator?.mediaDevices?.getDisplayMedia === 'function'
    && pickMimeType() !== null;
}

export const RecorderState = {
  IDLE: 'idle',
  STARTING: 'starting',
  RECORDING: 'recording',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  ERROR: 'error',
};

export class MeetingRecorder {
  constructor({ config, logger, bus, store }) {
    this.config = config;
    this.settings = config.recording || {};
    this.log = logger.child('recorder');
    this.bus = bus;
    this.store = store;

    this.state = RecorderState.IDLE;
    this.sessionId = null;
    this.sink = null;
    this.mimeType = null;
    this.recorder = null;
    this.displayStream = null;
    this.micStream = null;
    this.audioContext = null;
    this.mixDestination = null;
    this.recordStream = null;
    this.startedAt = 0;
    this.bytes = 0;
    this.wakeLock = null;
    this.timers = { progress: null, maxDuration: null };
    this.unloadHandler = null;
    this.visibilityHandler = null;
    this.warnedAtBytes = false;
    this.stopPromise = null;
  }

  get isRecording() {
    return this.state === RecorderState.RECORDING;
  }

  /**
   * Tab audio + microphone, already mixed.
   *
   * This is the only stream in the app that contains every participant's
   * voice, so it is what whole-room transcription has to listen to.
   */
  get mixedAudioStream() {
    return this.mixDestination?.stream || null;
  }

  get elapsedMs() {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  /**
   * Begins recording. Must be invoked from a user gesture: both the screen
   * picker and the file picker require one.
   */
  async start({ sessionId, filename }) {
    if (this.state !== RecorderState.IDLE && this.state !== RecorderState.STOPPED) {
      throw new Error('A recording is already running.');
    }
    if (!isRecordingSupported()) {
      throw new Error('This browser cannot record. Use Chrome, Edge or another Chromium browser on a desktop.');
    }

    this.state = RecorderState.STARTING;
    this.sessionId = sessionId;
    this.bytes = 0;
    this.warnedAtBytes = false;

    try {
      this.mimeType = pickMimeType();
      await this.#captureTab();
      await this.#captureMicrophone();
      this.#buildMixedStream();
      await this.#openSink(filename);
      this.#startMediaRecorder();
      this.#installGuards();

      this.state = RecorderState.RECORDING;
      this.startedAt = Date.now();
      this.log.info('recording started', {
        mimeType: this.mimeType,
        sink: this.sink.kind,
        hasTabAudio: this.hasTabAudio,
        hasMic: this.hasMic,
      });
      this.bus.emit('recorder:started', this.status());
      return this.status();
    } catch (error) {
      this.state = RecorderState.ERROR;
      await this.#teardown();
      this.log.error('recording failed to start', error);
      throw error;
    }
  }

  async #captureTab() {
    try {
      this.displayStream = await navigator.mediaDevices.getDisplayMedia(DISPLAY_CAPTURE_OPTIONS);
    } catch (error) {
      if (error?.name === 'NotAllowedError') {
        throw new Error('Screen sharing permission was declined, so recording cannot start. Press Record again and choose "This tab".');
      }
      throw error;
    }

    const [videoTrack] = this.displayStream.getVideoTracks();
    if (!videoTrack) throw new Error('No video was captured. Press Record again and choose "This tab".');

    // Clicking the browser's own "Stop sharing" bar must end the recording
    // cleanly rather than leaving a recorder attached to a dead track.
    videoTrack.addEventListener('ended', () => {
      if (this.isRecording) {
        this.log.info('capture ended from browser UI — finishing recording');
        this.stop().catch((error) => this.log.error('stop after capture end failed', error));
      }
    });

    this.hasTabAudio = this.displayStream.getAudioTracks().length > 0;
    if (!this.hasTabAudio) {
      // Worth being loud about: the recording would contain only the
      // organiser's own voice, which is usually discovered far too late.
      const message = 'Tab audio was not shared, so other participants will not be heard in the recording. Stop and start again, ticking "Also share tab audio".';
      this.log.warn('no tab audio track');
      this.bus.emit('recorder:warning', { code: 'no-tab-audio', message });
    }
  }

  async #captureMicrophone() {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      this.hasMic = this.micStream.getAudioTracks().length > 0;
    } catch (error) {
      // Not fatal: remote voices still come through the tab audio.
      this.hasMic = false;
      this.log.warn('microphone unavailable for recording', error);
      this.bus.emit('recorder:warning', {
        code: 'no-mic',
        message: 'Your microphone could not be added to the recording. Other participants will still be recorded.',
      });
    }
  }

  /** Mixes tab audio and microphone into one track for the recorder. */
  #buildMixedStream() {
    const videoTrack = this.displayStream.getVideoTracks()[0];
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const sources = [];

    if (AudioCtx && (this.hasTabAudio || this.hasMic)) {
      this.audioContext = new AudioCtx();
      this.mixDestination = this.audioContext.createMediaStreamDestination();

      if (this.hasTabAudio) {
        const tabSource = this.audioContext.createMediaStreamSource(
          new MediaStream(this.displayStream.getAudioTracks()),
        );
        const gain = this.audioContext.createGain();
        gain.gain.value = 1.0;
        tabSource.connect(gain).connect(this.mixDestination);
        sources.push('tab');
      }
      if (this.hasMic) {
        const micSource = this.audioContext.createMediaStreamSource(this.micStream);
        const gain = this.audioContext.createGain();
        // Slightly below the tab mix: the local mic is close-miked and would
        // otherwise dominate the remote participants.
        gain.gain.value = 0.9;
        micSource.connect(gain).connect(this.mixDestination);
        sources.push('mic');
      }
      this.recordStream = new MediaStream([videoTrack, ...this.mixDestination.stream.getAudioTracks()]);
    } else {
      this.recordStream = new MediaStream([videoTrack, ...this.displayStream.getAudioTracks()]);
    }
    this.log.info('mixed recording stream built', { sources });
  }

  async #openSink(filename) {
    this.sink = await createSink({
      preference: this.settings.sink || 'auto',
      filename,
      store: this.store,
      sessionId: this.sessionId,
      mimeType: this.mimeType,
      logger: this.log,
    });
  }

  #startMediaRecorder() {
    this.recorder = new MediaRecorder(this.recordStream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: this.settings.videoBitsPerSecond || 1_200_000,
      audioBitsPerSecond: this.settings.audioBitsPerSecond || 128_000,
    });

    this.recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      // Hand the slice straight to the sink and let go of it. The sink's write
      // queue serialises and applies backpressure.
      this.sink.write(event.data).then(() => {
        this.bytes = this.sink.bytesWritten;
        this.#checkSizeWarning();
      }).catch((error) => {
        this.log.error('failed to persist a recording slice', error);
        this.bus.emit('recorder:error', {
          message: 'The recording could not be written to storage. It has been stopped so the part already captured is kept.',
          error,
        });
        this.stop().catch(() => {});
      });
    };

    this.recorder.onerror = (event) => {
      this.log.error('MediaRecorder error', event?.error || event);
      this.bus.emit('recorder:error', {
        message: 'The recorder stopped unexpectedly. Whatever was captured up to this point has been kept.',
        error: event?.error,
      });
      this.stop().catch(() => {});
    };

    this.recorder.start(this.settings.timesliceMs || 2000);
  }

  #installGuards() {
    this.#acquireWakeLock();

    this.visibilityHandler = () => {
      // Wake locks are released when a tab is hidden; take it back on return.
      if (document.visibilityState === 'visible' && this.isRecording) this.#acquireWakeLock();
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    if (this.settings.guardUnload !== false) {
      this.unloadHandler = (event) => {
        if (!this.isRecording) return undefined;
        event.preventDefault();
        // Modern browsers show their own wording; a non-empty value is what
        // actually triggers the prompt.
        event.returnValue = 'A recording is in progress. Leaving now will end it.';
        return event.returnValue;
      };
      window.addEventListener('beforeunload', this.unloadHandler);
    }

    this.timers.progress = setInterval(() => {
      if (!this.isRecording) return;
      this.bus.emit('recorder:progress', this.status());
    }, 1000);

    const maxMs = this.settings.maxDurationMs || 2 * 60 * 60 * 1000;
    this.timers.maxDuration = setTimeout(() => {
      if (!this.isRecording) return;
      this.log.warn('maximum recording duration reached — stopping');
      this.bus.emit('recorder:warning', {
        code: 'max-duration',
        message: 'The recording reached its maximum length and was saved automatically.',
      });
      this.stop().catch(() => {});
    }, maxMs);
  }

  async #acquireWakeLock() {
    if (!navigator.wakeLock?.request) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener?.('release', () => { this.wakeLock = null; });
    } catch (error) {
      // Non-fatal; the machine may simply sleep if left completely untouched.
      this.log.debug('wake lock unavailable', error);
    }
  }

  #checkSizeWarning() {
    const limit = this.settings.warnAtBytes;
    if (!limit || this.warnedAtBytes || this.bytes < limit) return;
    this.warnedAtBytes = true;
    this.bus.emit('recorder:warning', {
      code: 'large-file',
      message: `This recording has passed ${formatBytes(limit)}. It will keep going, but make sure there is disk space free.`,
    });
  }

  /** Projected final size, so the UI can warn before a long call starts. */
  projectedBytes(durationMs) {
    return estimateRecordingBytes(
      durationMs,
      this.settings.videoBitsPerSecond || 1_200_000,
      this.settings.audioBitsPerSecond || 128_000,
    );
  }

  status() {
    return {
      state: this.state,
      sessionId: this.sessionId,
      elapsedMs: this.elapsedMs,
      bytes: this.bytes,
      mimeType: this.mimeType,
      sink: this.sink?.kind || null,
      hasTabAudio: Boolean(this.hasTabAudio),
      hasMic: Boolean(this.hasMic),
    };
  }

  /** Stops and finalises. Safe to call more than once. */
  async stop() {
    if (this.stopPromise) return this.stopPromise;
    if (this.state !== RecorderState.RECORDING) return null;

    this.state = RecorderState.STOPPING;
    this.stopPromise = this.#doStop();
    try {
      return await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  async #doStop() {
    const durationMs = this.elapsedMs;
    try {
      await this.#flushAndStopRecorder();
      const result = await this.sink.finalize();
      this.state = RecorderState.STOPPED;

      const payload = {
        ...result,
        sessionId: this.sessionId,
        durationMs,
        mimeType: this.mimeType,
        startedAt: this.startedAt,
        endedAt: Date.now(),
      };
      this.log.info('recording finished', {
        bytes: payload.bytes,
        durationMs,
        sink: result.kind,
      });
      this.bus.emit('recorder:stopped', payload);
      return payload;
    } catch (error) {
      this.state = RecorderState.ERROR;
      this.log.error('failed to finalise recording', error);
      this.bus.emit('recorder:error', {
        message: 'The recording could not be finalised cleanly.',
        error,
      });
      throw error;
    } finally {
      await this.#teardown();
    }
  }

  /** Flushes the final partial slice, then waits for `stop` to actually fire. */
  #flushAndStopRecorder() {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        resolve();
        return;
      }
      // Guarantee we never hang here: a stuck recorder must not block saving.
      const timer = setTimeout(resolve, 5000);
      this.recorder.onstop = () => {
        clearTimeout(timer);
        // Let the last `ondataavailable` write settle before finalising.
        setTimeout(resolve, 150);
      };
      try {
        this.recorder.requestData();
        this.recorder.stop();
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  async #teardown() {
    for (const key of Object.keys(this.timers)) {
      const handle = this.timers[key];
      if (!handle) continue;
      clearInterval(handle);
      clearTimeout(handle);
      this.timers[key] = null;
    }
    if (this.unloadHandler) {
      window.removeEventListener('beforeunload', this.unloadHandler);
      this.unloadHandler = null;
    }
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    try { await this.wakeLock?.release(); } catch { /* already released */ }
    this.wakeLock = null;

    for (const stream of [this.displayStream, this.micStream]) {
      stream?.getTracks().forEach((track) => track.stop());
    }
    this.displayStream = null;
    this.micStream = null;
    this.recordStream = null;

    try { await this.audioContext?.close(); } catch { /* already closed */ }
    this.audioContext = null;
    this.mixDestination = null;
    this.recorder = null;
  }

  /** Emergency path: keep whatever is on disk, abandon the rest. */
  async abort() {
    try { await this.sink?.abort(); } finally { await this.#teardown(); }
    this.state = RecorderState.STOPPED;
  }
}

export { supportsFileSystemSink };
export default MeetingRecorder;
