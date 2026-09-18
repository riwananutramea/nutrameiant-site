/**
 * Live transcription.
 *
 * Two engines behind one interface, both free:
 *
 *   WebSpeechEngine — the browser's built-in recogniser. No download, no key,
 *     starts instantly. Hears the local microphone only, so remote speech is
 *     attributed via the transport's dominant-speaker signal rather than
 *     genuinely transcribed. Chromium-family browsers.
 *
 *   WhisperEngine — Whisper running locally through transformers.js. A ~75 MB
 *     one-off model download, after which it transcribes the *mixed* room
 *     audio, offline, with no per-minute cost. Opt-in.
 *
 * The Web Speech API is not built for hour-long sessions: it stops on its own
 * after roughly a minute, and after silence. The watchdog below is what turns
 * it into something that survives a real meeting.
 */

import { Bus } from '../core/bus.js';

export const EngineState = {
  IDLE: 'idle',
  STARTING: 'starting',
  RUNNING: 'running',
  RECOVERING: 'recovering',
  STOPPED: 'stopped',
  FAILED: 'failed',
};

/** Error codes that mean "stop trying" rather than "retry". */
const FATAL_SPEECH_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

export function isWebSpeechSupported() {
  return typeof window !== 'undefined'
    && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Classifies a SpeechRecognition error into an action.
 * Pure and exported: the recovery policy is the fiddly part and deserves tests.
 */
export function classifySpeechError(code) {
  if (FATAL_SPEECH_ERRORS.has(code)) return 'fatal';
  if (code === 'network') return 'backoff';
  // 'no-speech' and 'aborted' are routine during a normal meeting.
  return 'restart';
}

export class WebSpeechEngine {
  constructor({ lang = 'en-US', speakerName = 'You', logger, bus }) {
    this.lang = lang;
    this.log = logger.child('webspeech');
    this.bus = bus;
    this.state = EngineState.IDLE;
    this.recognition = null;
    this.wanted = false;
    this.consecutiveFailures = 0;
    this.restartTimer = null;
    this.lastResultAt = 0;
    this.segmentStartedAt = null;
    /**
     * Always the local participant.
     *
     * This engine listens to the default microphone. Remote participants are
     * played through the speakers, and echo cancellation deliberately removes
     * that from the mic signal — so everything this engine hears was said by
     * the person sitting at this computer. Attributing it to whoever the call
     * reports as the dominant speaker would mislabel the transcript whenever
     * someone else is talking. Whole-room capture is WhisperEngine's job.
     */
    this.currentSpeaker = speakerName;
  }

  get name() { return 'webspeech'; }

  /** Captures only the local microphone, so attribution is fixed. */
  get capturesAllParticipants() { return false; }

  setSpeaker() { /* intentionally ignored — see currentSpeaker above */ }

  async start(clock) {
    if (!isWebSpeechSupported()) {
      throw new Error('Live notes need Chrome, Edge or another Chromium browser. The call and the recording are unaffected.');
    }
    this.clock = clock;
    this.wanted = true;
    this.consecutiveFailures = 0;
    this.#spawn();
  }

  #spawn() {
    if (!this.wanted) return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new Ctor();
    recognition.lang = this.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    // One alternative: we want the recogniser's best guess, not a ranked list.
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      this.state = EngineState.RUNNING;
      this.consecutiveFailures = 0;
      this.bus.emit('transcriber:state', { state: this.state, engine: this.name });
    };

    recognition.onresult = (event) => {
      this.lastResultAt = Date.now();
      // Only walk from resultIndex: earlier entries were already emitted and
      // re-emitting them is the classic source of duplicated transcript lines.
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript?.trim();
        if (!text) continue;

        if (this.segmentStartedAt === null) this.segmentStartedAt = this.clock();
        if (result.isFinal) {
          this.bus.emit('transcriber:segment', {
            text,
            speaker: this.currentSpeaker,
            t0: this.segmentStartedAt,
            t1: this.clock(),
            confidence: result[0]?.confidence ?? null,
            final: true,
          });
          this.segmentStartedAt = null;
        } else {
          this.bus.emit('transcriber:interim', {
            text,
            speaker: this.currentSpeaker,
            t0: this.segmentStartedAt,
            final: false,
          });
        }
      }
    };

    recognition.onerror = (event) => {
      const action = classifySpeechError(event.error);
      this.log.debug('recognition error', { code: event.error, action });
      if (action === 'fatal') {
        this.wanted = false;
        this.state = EngineState.FAILED;
        this.bus.emit('transcriber:error', {
          fatal: true,
          code: event.error,
          message: event.error === 'not-allowed'
            ? 'Microphone access was denied, so live notes are off. The call and the recording are unaffected.'
            : 'Live notes could not access audio. The call and the recording are unaffected.',
        });
        return;
      }
      if (action === 'backoff') this.consecutiveFailures += 1;
    };

    // The important one: the API ends the session by itself, repeatedly,
    // throughout any real meeting. Treat `end` as normal and respawn.
    recognition.onend = () => {
      if (!this.wanted) {
        this.state = EngineState.STOPPED;
        this.bus.emit('transcriber:state', { state: this.state, engine: this.name });
        return;
      }
      this.state = EngineState.RECOVERING;
      // Ends that arrive with no speech in between suggest a genuine problem
      // rather than the routine idle timeout, so back off progressively.
      const quiet = Date.now() - this.lastResultAt;
      if (quiet > 30000) this.consecutiveFailures += 1;
      else this.consecutiveFailures = 0;

      if (this.consecutiveFailures >= 8) {
        this.wanted = false;
        this.state = EngineState.FAILED;
        this.log.warn('giving up on live notes after repeated restarts');
        this.bus.emit('transcriber:error', {
          fatal: true,
          code: 'restart-loop',
          message: 'Live notes kept dropping out and have been switched off. The call and the recording are unaffected.',
        });
        return;
      }
      const delay = Math.min(8000, 250 * 2 ** this.consecutiveFailures);
      this.restartTimer = setTimeout(() => this.#spawn(), delay);
    };

    try {
      recognition.start();
      this.recognition = recognition;
      this.state = EngineState.STARTING;
    } catch (error) {
      // InvalidStateError means one is already running — harmless.
      if (error?.name !== 'InvalidStateError') {
        this.log.warn('could not start recognition', error);
        this.consecutiveFailures += 1;
        this.restartTimer = setTimeout(() => this.#spawn(), 1000);
      }
    }
  }

  async stop() {
    this.wanted = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    try {
      this.recognition?.stop();
    } catch {
      /* already stopped */
    }
    this.recognition = null;
    this.state = EngineState.STOPPED;
  }
}

/**
 * Whisper in the browser via transformers.js.
 *
 * Transcribes the mixed room audio rather than just the local microphone, so
 * every participant is captured. The model is fetched once from a CDN and then
 * cached by the browser; inference is local, so there is no per-minute cost and
 * no meeting audio leaves the machine.
 */
export class WhisperEngine {
  constructor({ model = 'Xenova/whisper-base.en', lang = 'en', logger, bus }) {
    this.model = model;
    this.lang = lang;
    this.log = logger.child('whisper');
    this.bus = bus;
    this.state = EngineState.IDLE;
    this.pipeline = null;
    this.audioContext = null;
    this.processor = null;
    this.buffer = [];
    this.bufferedSamples = 0;
    this.wanted = false;
    this.currentSpeaker = 'Participant';
    this.busy = false;
    // Whisper is trained on 16 kHz mono; anything else must be resampled.
    this.sampleRate = 16000;
    this.windowSamples = this.sampleRate * 20; // 20-second windows
  }

  get name() { return 'whisper'; }

  /** Listens to the mixed room audio, so every participant is transcribed. */
  get capturesAllParticipants() { return true; }

  /**
   * Whisper hears everyone at once but cannot tell voices apart, so the call's
   * dominant-speaker signal is the best attribution available.
   */
  setSpeaker(name) {
    if (name) this.currentSpeaker = name;
  }

  async start(clock, sourceStream) {
    if (!sourceStream) throw new Error('Whisper notes need the meeting audio. Start the recording first.');
    this.clock = clock;
    this.wanted = true;
    this.state = EngineState.STARTING;
    this.bus.emit('transcriber:state', { state: this.state, engine: this.name, note: 'downloading model' });

    const { pipeline, env } = await import(
      /* webpackIgnore: true */ 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2'
    ).catch(() => {
      throw new Error('The offline notes model could not be downloaded. Check the connection, or use the built-in engine instead.');
    });
    // Browser-only: never try to hit a local filesystem for weights.
    env.allowLocalModels = false;

    this.pipeline = await pipeline('automatic-speech-recognition', this.model, {
      // WebGPU where available — roughly an order of magnitude faster than WASM
      // and the difference between real-time and falling behind.
      device: typeof navigator !== 'undefined' && navigator.gpu ? 'webgpu' : 'wasm',
      dtype: 'q8',
    });

    this.#attachAudio(sourceStream);
    this.state = EngineState.RUNNING;
    this.bus.emit('transcriber:state', { state: this.state, engine: this.name });
  }

  #attachAudio(stream) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioCtx({ sampleRate: this.sampleRate });
    const source = this.audioContext.createMediaStreamSource(stream);
    // ScriptProcessor is deprecated but is the only node available without
    // shipping a separate worklet file; the work done per callback is trivial.
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (event) => {
      if (!this.wanted) return;
      // Copy: the underlying buffer is reused by the audio thread.
      this.buffer.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      this.bufferedSamples += event.inputBuffer.length;
      if (this.bufferedSamples >= this.windowSamples && !this.busy) this.#flush();
    };

    source.connect(this.processor);
    // Zero-gain sink: ScriptProcessor only runs when connected to a destination,
    // but routing the mix to the speakers would echo the meeting.
    const silent = this.audioContext.createGain();
    silent.gain.value = 0;
    this.processor.connect(silent).connect(this.audioContext.destination);
  }

  async #flush() {
    if (this.busy || this.buffer.length === 0) return;
    this.busy = true;
    const chunks = this.buffer;
    const total = this.bufferedSamples;
    this.buffer = [];
    this.bufferedSamples = 0;

    const t0 = this.clock() - Math.round((total / this.sampleRate) * 1000);
    try {
      const audio = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        audio.set(chunk, offset);
        offset += chunk.length;
      }
      const output = await this.pipeline(audio, { language: this.lang, task: 'transcribe' });
      const text = String(output?.text || '').trim();
      if (text) {
        this.bus.emit('transcriber:segment', {
          text,
          speaker: this.currentSpeaker,
          t0,
          t1: this.clock(),
          confidence: null,
          final: true,
        });
      }
    } catch (error) {
      this.log.warn('whisper window failed', error);
    } finally {
      this.busy = false;
    }
  }

  async stop() {
    this.wanted = false;
    // Transcribe whatever is left rather than discarding the last window.
    if (this.bufferedSamples > this.sampleRate) await this.#flush();
    try { this.processor?.disconnect(); } catch { /* already detached */ }
    try { await this.audioContext?.close(); } catch { /* already closed */ }
    this.processor = null;
    this.audioContext = null;
    this.state = EngineState.STOPPED;
  }
}

/**
 * Owns the chosen engine, accumulates segments and keeps speaker attribution
 * current from the transport's dominant-speaker events.
 */
export class Transcriber {
  constructor({ config, logger, bus, store = null }) {
    this.config = config;
    this.settings = config.notes || {};
    this.log = logger.child('transcriber');
    this.bus = bus;
    this.store = store;
    this.engine = null;
    this.segments = [];
    this.startedAt = 0;
    this.sessionId = null;
    this.flushSeq = 0;
    this.pendingFlush = [];
    this.unsubscribes = [];
  }

  get isRunning() {
    return Boolean(this.engine) && this.engine.state === EngineState.RUNNING;
  }

  /** Milliseconds since the meeting started — the transcript's time base. */
  clock() {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  async start({ sessionId, startedAt, audioStream = null, speakerName = 'You' }) {
    this.sessionId = sessionId;
    this.startedAt = startedAt || Date.now();
    this.segments = [];

    const engineName = this.settings.engine === 'whisper' ? 'whisper' : 'webspeech';
    if (engineName === 'whisper' && !audioStream) {
      throw new Error('Whole-room notes need the mixed meeting audio. Start the recording first, then turn notes on.');
    }
    this.engine = engineName === 'whisper'
      ? new WhisperEngine({
        model: this.settings.whisperModel,
        lang: String(this.settings.lang || 'en-US').split('-')[0],
        logger: this.log,
        bus: this.bus,
      })
      : new WebSpeechEngine({
        lang: this.settings.lang,
        speakerName: speakerName || 'You',
        logger: this.log,
        bus: this.bus,
      });

    this.unsubscribes.push(
      this.bus.on('transcriber:segment', (segment) => this.#collect(segment)),
      // Only meaningful for whole-room engines; WebSpeechEngine ignores it.
      this.bus.on('transcript:dominantSpeaker', ({ displayName }) => this.engine?.setSpeaker(displayName)),
    );

    await this.engine.start(() => this.clock(), audioStream);
    this.log.info('live notes started', { engine: engineName, wholeRoom: this.engine.capturesAllParticipants });
  }

  #collect(segment) {
    if (!segment?.final) return;
    const entry = {
      id: `seg_${this.segments.length}`,
      speaker: segment.speaker || 'Participant',
      text: segment.text,
      t0: segment.t0 ?? 0,
      t1: segment.t1 ?? segment.t0 ?? 0,
    };
    this.segments.push(entry);
    this.pendingFlush.push(entry);
    // Persist in batches: one transaction per utterance would be wasteful over
    // an hour, and losing at most 20 lines to a crash is acceptable.
    if (this.pendingFlush.length >= 20) this.flush().catch(() => {});
  }

  async flush() {
    if (!this.store || !this.sessionId || this.pendingFlush.length === 0) return;
    const batch = this.pendingFlush;
    this.pendingFlush = [];
    const seq = this.flushSeq;
    this.flushSeq += 1;
    try {
      await this.store.putNotes(this.sessionId, seq, batch);
    } catch (error) {
      this.log.warn('could not persist transcript batch', error);
    }
  }

  async stop() {
    try {
      await this.engine?.stop();
    } finally {
      await this.flush();
      for (const off of this.unsubscribes) off();
      this.unsubscribes = [];
      this.engine = null;
    }
    return this.segments;
  }
}

export { Bus };
export default Transcriber;
