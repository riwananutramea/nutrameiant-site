/**
 * NutraMEA Meet — application orchestration.
 *
 * Wires transport, resilience, recorder, live notes and delivery together and
 * drives three screens: lobby → call → summary.
 *
 * Ordering rule that runs through the whole file: the CALL and the RECORDING
 * are the product. Live notes are a convenience layered on top and are wrapped
 * so that no failure in them can ever interrupt either.
 */

import { config } from '../config.js';
import { logger, installGlobalErrorCapture } from '../core/logger.js';
import { Bus } from '../core/bus.js';
import { MeetStore, requestPersistentStorage, estimateQuota } from '../core/store.js';
import { JitsiTransport } from '../media/jitsi.js';
import { ResilienceController } from '../media/resilience.js';
import { MeetingRecorder, isRecordingSupported } from '../media/recorder.js';
import { Transcriber, isWebSpeechSupported } from '../ai/transcriber.js';
import { buildNotes } from '../ai/notes.js';
import {
  notesToMarkdown, transcriptToText, transcriptToVtt, bundleToJson, exportBaseName,
} from '../ai/exporters.js';
import { DeliveryService } from '../storage/delivery.js';
import { TranscriptView } from './transcript-view.js';
import { Toasts } from './toasts.js';
import { decorateButton, swapButtonIcon, setButtonLabel, iconElement } from './icons.js';
import { Tour, lobbyTour, callTour } from './tour.js';
import { PreflightDialog } from './preflight.js';
import {
  formatDuration, formatBytes, randomRoomName, slugifyRoom, uid, downloadBlob, throttle,
} from '../core/util.js';

const $ = (selector, root = document) => root.querySelector(selector);

export class MeetApp {
  constructor() {
    this.config = config;
    this.log = logger;
    if (config.debug) this.log.setLevel('debug');
    this.bus = new Bus((error, event) => this.log.error(`listener failed for ${event}`, error));

    this.store = null;
    this.transport = null;
    this.resilience = null;
    this.recorder = null;
    this.transcriber = null;
    this.delivery = new DeliveryService({ config, logger: this.log, bus: this.bus });

    this.session = null;
    this.recordingResult = null;
    this.notes = null;
    this.segments = [];
    this.uploadAbort = null;
    this.clockTimer = null;
    this.tour = new Tour({ logger: this.log });
  }

  async init() {
    installGlobalErrorCapture(this.log);
    this.toasts = new Toasts($('#toasts'));
    this.#cacheElements();
    this.#renderBranding();
    this.#bindLobby();
    this.#bindCallControls();
    this.#bindSummary();

    try {
      this.store = await MeetStore.open();
    } catch (error) {
      // Recording can still work via the disk sink; only recovery is lost.
      this.log.warn('local storage unavailable', error);
      this.toasts.warning('This browser blocked local storage, so recordings cannot be recovered after a crash. Recording to a file on disk still works.');
    }

    this.#reportCapabilities();
    await this.#offerRecovery();
    this.#prefillLobby();
    this.#showScreen('lobby');
    this.#runTour(lobbyTour, 'lobby-v1');
    this.log.info('ready', { provider: this.config.provider });
  }

  #cacheElements() {
    this.el = {
      screens: {
        lobby: $('#screen-lobby'),
        call: $('#screen-call'),
        summary: $('#screen-summary'),
      },
      roomInput: $('#room-name'),
      nameInput: $('#display-name'),
      audioOnly: $('#audio-only'),
      notesToggle: $('#enable-notes'),
      notesEngine: $('#notes-engine'),
      notesEngineHint: $('#notes-engine-hint'),
      notesEngineField: $('#notes-engine-field'),
      helpButton: $('#help-button'),
      preflightButton: $('#preflight-button'),
      joinButton: $('#join-button'),
      newRoomButton: $('#new-room'),
      lobbyStatus: $('#lobby-status'),
      capabilities: $('#capabilities'),

      stage: $('#stage'),
      recordButton: $('#record-button'),
      recordState: $('#record-state'),
      recordTimer: $('#record-timer'),
      recordSize: $('#record-size'),
      linkQuality: $('#link-quality'),
      audioOnlyButton: $('#toggle-audio-only'),
      copyLinkButton: $('#copy-link'),
      leaveButton: $('#leave-button'),
      participants: $('#participant-count'),
      transcriptPanel: $('#transcript'),
      notesPanelToggle: $('#toggle-notes-panel'),
      sidePanel: $('#side-panel'),

      summaryBody: $('#summary-body'),
      summaryActions: $('#summary-actions'),
      uploadProgress: $('#upload-progress'),
      brandNames: document.querySelectorAll('[data-brand]'),
    };
  }

  #renderBranding() {
    for (const node of this.el.brandNames) node.textContent = this.config.brandName;
    document.title = `Meetings · ${this.config.brandShort}`;
    // Drives the CSS that strips duplicated chrome when embedded in My Account.
    document.body.dataset.embedded = String(Boolean(this.config.embedded));

    // Icons are added in JS so the markup stays readable and the icon set has
    // exactly one definition. Labels are always kept beside them.
    decorateButton(this.el.recordButton, 'record', { size: 18 });
    decorateButton(this.el.newRoomButton, 'refresh', { size: 17 });
    decorateButton(this.el.copyLinkButton, 'link', { size: 18 });
    decorateButton(this.el.notesPanelToggle, 'notes', { size: 18 });
    decorateButton(this.el.leaveButton, 'leave', { size: 18 });
    decorateButton(this.el.audioOnlyButton, 'videoOff', { size: 18 });
    decorateButton(this.el.helpButton, 'compass', { size: 17 });
    decorateButton(this.el.preflightButton, 'shield', { size: 17 });
    this.el.participants.prepend(iconElement('users', { size: 16 }));
  }

  /** Tells the user up front what this browser can and cannot do. */
  #reportCapabilities() {
    const items = [];
    const canRecord = isRecordingSupported();
    items.push({
      ok: canRecord,
      text: canRecord
        ? 'Recording supported'
        : 'Recording needs Chrome or Edge on a desktop — the call itself still works here',
    });
    const canNote = isWebSpeechSupported();
    items.push({
      ok: canNote,
      text: canNote ? 'Live AI notes supported' : 'Live notes need Chrome or Edge — call and recording are unaffected',
    });
    items.push({
      ok: this.delivery.driveAvailable,
      text: this.delivery.driveAvailable
        ? 'Google Drive delivery configured'
        : 'Recordings download to this computer (Drive not configured)',
    });

    this.el.capabilities.replaceChildren();
    for (const item of items) {
      const li = document.createElement('li');
      li.className = item.ok ? 'cap cap--ok' : 'cap cap--warn';
      li.textContent = item.text;
      this.el.capabilities.appendChild(li);
    }
    if (!canRecord) {
      this.el.recordButton.disabled = true;
      // Nothing to check if recording is unavailable in the first place.
      this.el.preflightButton.hidden = true;
    }

    const notesConfigured = Boolean(this.config.notes?.enabled);
    // Whole-room notes only need a recording, not the Web Speech API, so the
    // option stays available on browsers that lack speech recognition.
    this.el.notesToggle.checked = notesConfigured && (canNote || canRecord);
    this.el.notesToggle.disabled = !canNote && !canRecord;
    this.el.notesEngine.value = this.config.notes?.engine === 'whisper' ? 'whisper' : 'webspeech';
    if (!canNote) {
      this.el.notesEngine.querySelector('option[value="webspeech"]').disabled = true;
      if (canRecord) this.el.notesEngine.value = 'whisper';
    }
    if (!canRecord) this.el.notesEngine.querySelector('option[value="whisper"]').disabled = true;
    this.#updateNotesEngineHint();
  }

  #updateNotesEngineHint() {
    const whole = this.el.notesEngine.value === 'whisper';
    this.el.notesEngineHint.textContent = whole
      ? 'Transcribes every participant from the meeting audio. Notes begin when you start recording, and the model downloads once then works offline.'
      : 'Transcribes what you say into your own microphone. Other participants are not captured, because the call audio never reaches the microphone.';
    // Hiding the whole block is calmer than leaving a disabled control behind.
    this.el.notesEngineField.hidden = !this.el.notesToggle.checked;
  }

  /** A recording interrupted by a crash is still on disk — offer it back. */
  async #offerRecovery() {
    if (!this.store) return;
    let recoverable = [];
    try {
      recoverable = await this.store.findRecoverable();
    } catch (error) {
      this.log.warn('recovery scan failed', error);
      return;
    }
    if (recoverable.length === 0) return;

    const latest = recoverable[0];
    this.toasts.show(
      `An interrupted recording from ${new Date(latest.startedAt).toLocaleString()} was found (${formatBytes(latest.recoveredBytes)}).`,
      {
        type: 'warning',
        timeoutMs: 0,
        key: 'recovery',
        actions: [
          { label: 'Save it', onClick: () => this.#recoverSession(latest) },
          { label: 'Discard', onClick: () => this.store.purgeSession(latest.id).catch(() => {}) },
        ],
      },
    );
  }

  async #recoverSession(session) {
    try {
      const blob = await this.store.assembleChunks(session.id, session.mimeType);
      downloadBlob(blob, `${session.baseName || 'nutramea-recording'}-recovered.webm`);
      await this.store.patchSession(session.id, { recordingState: 'recovered' });
      this.toasts.success('The recovered recording has been downloaded.');
    } catch (error) {
      this.log.error('recovery failed', error);
      this.toasts.error(`The interrupted recording could not be rebuilt: ${error.message}`);
    }
  }

  #prefillLobby() {
    const room = this.config.session?.room || randomRoomName('nutramea');
    this.el.roomInput.value = room;
    if (this.config.session?.displayName) this.el.nameInput.value = this.config.session.displayName;
    else this.el.nameInput.value = localStorage.getItem('nutramea.displayName') || '';
    this.el.audioOnly.checked = Boolean(this.config.session?.audioOnly);
  }

  #bindLobby() {
    this.el.newRoomButton.addEventListener('click', () => {
      this.el.roomInput.value = randomRoomName('nutramea');
    });
    this.el.joinButton.addEventListener('click', () => {
      this.join().catch((error) => {
        this.log.error('join failed', error);
        this.el.joinButton.disabled = false;
        this.el.lobbyStatus.textContent = '';
        this.toasts.error(error.message);
      });
    });
    this.el.roomInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.el.joinButton.click();
    });
    this.el.notesEngine.addEventListener('change', () => this.#updateNotesEngineHint());
    this.el.notesToggle.addEventListener('change', () => this.#updateNotesEngineHint());
    // Replays whichever tour matches the screen the user is currently on.
    this.el.preflightButton.addEventListener('click', () => {
      new PreflightDialog({ logger: this.log }).open();
    });
    this.el.helpButton.addEventListener('click', () => {
      const onCall = document.body.dataset.screen === 'call';
      this.tour.start(onCall ? callTour : lobbyTour, { force: true });
    });
  }

  #bindCallControls() {
    this.el.recordButton.addEventListener('click', () => this.#onRecordClick());
    this.el.leaveButton.addEventListener('click', () => this.leave().catch(() => {}));
    this.el.audioOnlyButton.addEventListener('click', () => {
      const next = !this.resilience?.state.manual;
      this.resilience?.forceAudioOnly(next);
      this.el.audioOnlyButton.setAttribute('aria-pressed', String(next));
      setButtonLabel(this.el.audioOnlyButton, next ? 'Video off' : 'Audio only');
      swapButtonIcon(this.el.audioOnlyButton, next ? 'video' : 'videoOff', { size: 18 });
    });
    this.el.copyLinkButton.addEventListener('click', () => this.#copyInvite());
    this.el.notesPanelToggle.addEventListener('click', () => this.#toggleNotesPanel());
    this.#bindSheetGestures();
    this.#observeControlsHeight();

    this.bus.on('transport:participants', (list) => {
      this.el.participants.textContent = String(list.length);
    });
    // Speaker attribution for the transcript.
    this.bus.on('transport:dominantSpeaker', (payload) => {
      this.bus.emit('transcript:dominantSpeaker', payload);
    });
    this.bus.on('transport:readyToClose', () => this.leave().catch(() => {}));
    this.bus.on('transport:error', ({ message, fatal }) => {
      if (fatal) this.toasts.error(`Meeting error: ${message}`);
      else this.toasts.warning(message);
    });

    this.bus.on('resilience:step', ({ audioOnly, height, reason }) => {
      if (reason !== 'auto') return;
      this.toasts.info(
        audioOnly
          ? 'Your connection is weak — video paused so the audio stays clear.'
          : `Connection changed — video set to ${height}p.`,
        { key: 'resilience', timeoutMs: 5000 },
      );
    });
    this.bus.on('resilience:quality', ({ quality }) => {
      this.el.linkQuality.dataset.quality = quality;
      this.el.linkQuality.textContent = { good: 'Connection good', fair: 'Connection fair', poor: 'Connection weak' }[quality] || '';
    });

    this.bus.on('recorder:warning', ({ message, code }) => this.toasts.warning(message, { key: code }));
    this.bus.on('recorder:error', ({ message }) => this.toasts.error(message));
    this.bus.on('recorder:progress', (status) => {
      this.el.recordTimer.textContent = formatDuration(status.elapsedMs);
      this.el.recordSize.textContent = formatBytes(status.bytes);
    });
    this.bus.on('storage:warning', ({ message }) => this.toasts.warning(message));
  }

  /**
   * Publishes the control bar's real height as `--controls-h`.
   *
   * Toasts and the notes sheet are both positioned off this value. On a phone
   * the bar wraps to two rows and grows again while recording, so a constant
   * here means overlays end up sitting on top of the controls. Measuring is
   * the only way this stays correct at every width and in every state.
   */
  #observeControlsHeight() {
    this.#trackHeight('.controls', '--controls-h');
    this.#trackHeight('.topbar', '--topbar-h');
  }

  /**
   * Keeps a CSS variable equal to an element's measured height.
   *
   * Overlays are positioned off these values. A hard-coded number silently
   * goes wrong the moment the control bar wraps to two rows on a phone, or
   * grows while recording — and the symptom is a toast sitting on top of a
   * button, which is exactly what must never happen.
   */
  #trackHeight(selector, variable) {
    const node = document.querySelector(selector);
    if (!node) return;
    let last = -1;
    const apply = () => {
      const height = Math.round(node.getBoundingClientRect().height);
      // Writing the variable changes layout, which notifies the observer
      // again. Without this guard that is an endless loop, reported by the
      // browser as "ResizeObserver loop completed with undelivered
      // notifications".
      if (height <= 0 || height === last) return;
      last = height;
      document.documentElement.style.setProperty(variable, `${height}px`);
    };
    apply();
    if (typeof ResizeObserver === 'function') {
      // Defer the write out of the observation callback so the style change
      // lands in the next frame rather than mid-cycle.
      const observer = new ResizeObserver(() => requestAnimationFrame(apply));
      observer.observe(node);
      (this.observers ||= []).push(observer);
    } else {
      window.addEventListener('resize', apply, { passive: true });
    }
  }

  #toggleNotesPanel(force = null) {
    const open = force === null
      ? this.el.sidePanel.classList.toggle('side-panel--open')
      : this.el.sidePanel.classList.toggle('side-panel--open', force);
    this.el.notesPanelToggle.setAttribute('aria-expanded', String(open));
    return open;
  }

  /**
   * Bottom-sheet gestures for phones.
   *
   * A sheet that can only be closed by the button that opened it feels stuck,
   * so it also responds to a downward drag and to Escape. The drag threshold is
   * generous: this sits under the thumb during a live call and an accidental
   * dismissal is worse than a missed one.
   */
  #bindSheetGestures() {
    const panel = this.el.sidePanel;
    const handle = panel.querySelector('.sheet-handle');
    if (!handle) return;

    let startY = null;
    const onStart = (event) => { startY = event.touches[0].clientY; };
    const onMove = (event) => {
      if (startY === null) return;
      const delta = event.touches[0].clientY - startY;
      if (delta > 0) panel.style.transform = `translateY(${delta}px)`;
    };
    const onEnd = (event) => {
      if (startY === null) return;
      const delta = (event.changedTouches[0]?.clientY ?? startY) - startY;
      panel.style.transform = '';
      startY = null;
      if (delta > 90) this.#toggleNotesPanel(false);
    };

    handle.addEventListener('touchstart', onStart, { passive: true });
    handle.addEventListener('touchmove', onMove, { passive: true });
    handle.addEventListener('touchend', onEnd, { passive: true });
    handle.addEventListener('click', () => this.#toggleNotesPanel(false));

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (panel.classList.contains('side-panel--open')) this.#toggleNotesPanel(false);
    });
  }

  /**
   * Runs a tour once the screen has settled.
   *
   * Coach marks are positioned from live geometry, so they must not be measured
   * mid-transition or they land beside the wrong control.
   */
  #runTour(steps, key) {
    setTimeout(() => {
      if (this.tour.active) return;
      this.tour.start(steps, { key });
    }, 500);
  }

  #bindSummary() {
    $('#back-to-lobby').addEventListener('click', () => {
      this.#resetForNextMeeting();
      this.#showScreen('lobby');
    });
  }

  #showScreen(name) {
    for (const [key, node] of Object.entries(this.el.screens)) {
      node.hidden = key !== name;
    }
    document.body.dataset.screen = name;
  }

  /* --------------------------------------------------------------- joining */

  async join() {
    const room = slugifyRoom(this.el.roomInput.value.trim() || randomRoomName('nutramea'));
    const displayName = this.el.nameInput.value.trim() || 'NutraMEA guest';
    const audioOnly = this.el.audioOnly.checked;

    this.el.roomInput.value = room;
    localStorage.setItem('nutramea.displayName', displayName);

    this.el.joinButton.disabled = true;
    this.el.lobbyStatus.textContent = 'Connecting…';

    await requestPersistentStorage();

    this.session = {
      id: uid('session'),
      room,
      displayName,
      startedAt: Date.now(),
      recordingState: 'idle',
      baseName: exportBaseName(room, Date.now()),
    };
    if (this.store) await this.store.putSession({ ...this.session }).catch(() => {});

    this.transport = new JitsiTransport({ config: this.config, logger: this.log, bus: this.bus });
    const joined = await this.transport.join({
      container: this.el.stage,
      room,
      displayName,
      audioOnly,
    });
    this.meetingUrl = joined.url;

    this.resilience = new ResilienceController({
      transport: this.transport,
      config: this.config,
      logger: this.log,
      bus: this.bus,
    });
    this.resilience.start();
    if (audioOnly) {
      this.resilience.forceAudioOnly(true);
      this.el.audioOnlyButton.setAttribute('aria-pressed', 'true');
      setButtonLabel(this.el.audioOnlyButton, 'Video off');
      swapButtonIcon(this.el.audioOnlyButton, 'video', { size: 18 });
    }

    this.recorder = new MeetingRecorder({
      config: this.config,
      logger: this.log,
      bus: this.bus,
      store: this.store,
    });

    this.transcriptView = new TranscriptView({
      container: this.el.transcriptPanel,
      windowSize: this.config.notes?.renderWindow || 300,
    });
    this.bus.on('transcriber:segment', (segment) => {
      if (!segment.final) return;
      this.transcriptView.setInterim('');
      this.transcriptView.append(segment);
    });
    this.bus.on('transcriber:interim', (segment) => this.transcriptView.setInterim(segment.text));
    this.bus.on('transcriber:error', ({ message }) => this.toasts.warning(message, { key: 'notes' }));

    this.notesEngine = this.el.notesEngine.value === 'whisper' ? 'whisper' : 'webspeech';
    this.notesWanted = this.el.notesToggle.checked;
    if (this.notesWanted) {
      if (this.notesEngine === 'whisper') {
        // Whole-room notes listen to the recorder's mixed audio, which does
        // not exist until recording starts.
        this.toasts.info('Whole-room notes will begin as soon as you start recording.', { timeoutMs: 8000 });
      } else {
        await this.#startNotes();
      }
    }

    this.el.lobbyStatus.textContent = '';
    this.el.joinButton.disabled = false;
    this.#showScreen('call');
    this.#startClock();
    this.#runTour(callTour, 'call-v1');
    this.toasts.success(`You are in "${room}". Use Invite to bring the other person in.`, { timeoutMs: 8000 });
  }

  async #startNotes({ audioStream = null } = {}) {
    if (this.transcriber) return;
    try {
      this.transcriber = new Transcriber({
        // Honour the lobby choice rather than the site-wide default.
        config: { ...this.config, notes: { ...this.config.notes, engine: this.notesEngine } },
        logger: this.log,
        bus: this.bus,
        store: this.store,
      });
      await this.transcriber.start({
        sessionId: this.session.id,
        startedAt: this.session.startedAt,
        audioStream,
        speakerName: this.session.displayName,
      });
    } catch (error) {
      // Deliberately swallowed: notes are never allowed to block a meeting.
      this.log.warn('live notes unavailable', error);
      this.transcriber = null;
      this.toasts.warning(error.message, { key: 'notes' });
    }
  }

  #startClock() {
    this.clockTimer = setInterval(() => {
      const elapsed = Date.now() - this.session.startedAt;
      $('#call-clock').textContent = formatDuration(elapsed);
    }, 1000);
  }

  async #copyInvite() {
    const url = new URL(window.location.href);
    url.searchParams.set('room', this.session.room);
    url.searchParams.delete('name');
    try {
      await navigator.clipboard.writeText(url.toString());
      this.toasts.success('Invite link copied.');
    } catch {
      // Clipboard access is blocked in some embedded contexts.
      this.toasts.info(url.toString(), { timeoutMs: 0 });
    }
  }

  /* ------------------------------------------------------------- recording */

  async #onRecordClick() {
    if (this.recorder?.isRecording) {
      await this.#stopRecording();
      return;
    }
    await this.#startRecording();
  }

  async #startRecording() {
    if (this.config.recording?.requireConsent && !this.#confirmConsent()) return;

    const quota = await estimateQuota();
    const projected = this.recorder.projectedBytes(60 * 60 * 1000);
    if (quota && quota.available > 0 && quota.available < projected && this.config.recording.sink !== 'file') {
      this.toasts.warning(
        `Only ${formatBytes(quota.available)} of browser storage is free and an hour needs about ${formatBytes(projected)}. Choose "Save to a file on my computer" when prompted.`,
      );
    }

    this.el.recordButton.disabled = true;
    try {
      const filename = `${this.session.baseName}.webm`;
      await this.recorder.start({ sessionId: this.session.id, filename });

      if (this.store) {
        await this.store.patchSession(this.session.id, {
          recordingState: 'recording',
          mimeType: this.recorder.mimeType,
        }).catch(() => {});
      }

      // Announce in the meeting chat so every participant has a visible,
      // timestamped record that recording began.
      try {
        this.transport.api?.executeCommand(
          'sendChatMessage',
          `${this.session.displayName} started recording this meeting.`,
        );
      } catch {
        /* chat is a courtesy, not a requirement */
      }

      document.body.dataset.recording = 'true';
      setButtonLabel(this.el.recordButton, 'Stop');
      swapButtonIcon(this.el.recordButton, 'stop', { size: 18 });
      this.el.recordState.textContent = 'Recording';
      this.toasts.success('Recording started.');

      if (this.notesWanted && this.notesEngine === 'whisper' && !this.transcriber) {
        // Fire and forget: a slow model download must not hold up the call.
        this.#startNotes({ audioStream: this.recorder.mixedAudioStream }).catch(() => {});
      }
    } catch (error) {
      this.log.error('could not start recording', error);
      this.toasts.error(error.message);
    } finally {
      this.el.recordButton.disabled = false;
    }
  }

  #confirmConsent() {
    // eslint-disable-next-line no-alert -- a blocking confirm is correct here:
    // consent must be deliberate, and nothing is recording yet.
    return window.confirm(
      'Everyone in this meeting will be told that recording has started.\n\n'
      + 'Confirm that participants consent to being recorded.',
    );
  }

  async #stopRecording() {
    this.el.recordButton.disabled = true;
    this.el.recordState.textContent = 'Saving…';
    try {
      this.recordingResult = await this.recorder.stop();
      document.body.dataset.recording = 'false';
      setButtonLabel(this.el.recordButton, 'Record');
      swapButtonIcon(this.el.recordButton, 'record', { size: 18 });
      this.el.recordState.textContent = 'Saved';
      if (this.store) {
        await this.store.patchSession(this.session.id, { recordingState: 'complete' }).catch(() => {});
      }
      this.toasts.success(this.delivery.describe(this.recordingResult));
    } catch (error) {
      this.toasts.error(`The recording could not be saved cleanly: ${error.message}`);
    } finally {
      this.el.recordButton.disabled = false;
    }
  }

  /* ---------------------------------------------------------------- leaving */

  async leave() {
    if (this.leaving) return;
    this.leaving = true;

    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = null;
    this.tour.finish({ silent: true });
    this.#toggleNotesPanel(false);

    if (this.recorder?.isRecording) {
      this.toasts.info('Finishing the recording…');
      try {
        this.recordingResult = await this.recorder.stop();
      } catch (error) {
        this.log.error('stop on leave failed', error);
      }
    }

    try {
      this.segments = (await this.transcriber?.stop()) || [];
    } catch (error) {
      this.log.warn('notes stop failed', error);
      this.segments = this.transcriber?.segments || [];
    }

    this.resilience?.stop();
    await this.transport?.leave();

    const durationMs = Date.now() - (this.session?.startedAt || Date.now());
    if (this.store && this.session) {
      await this.store.patchSession(this.session.id, { endedAt: Date.now(), durationMs }).catch(() => {});
    }

    this.notes = buildNotes(this.segments, {
      title: `Meeting — ${this.session?.room || 'NutraMEA'}`,
      startedAt: this.session?.startedAt,
      durationMs,
    });

    this.#renderSummary(durationMs);
    this.#showScreen('summary');
    this.leaving = false;
  }

  #renderSummary(durationMs) {
    const body = this.el.summaryBody;
    body.replaceChildren();

    body.appendChild(this.#summaryHeader(durationMs));

    if (this.recordingResult) {
      body.appendChild(this.#recordingCard());
    } else {
      body.appendChild(this.#card('Recording', [
        this.#paragraph('This meeting was not recorded.'),
      ]));
    }

    if (this.segments.length === 0) {
      body.appendChild(this.#card('Notes', [
        this.#paragraph('No speech was captured, so there are no notes for this meeting.'),
      ]));
    } else {
      body.appendChild(this.#notesCard());
    }

    this.#renderSummaryActions();
  }

  #summaryHeader(durationMs) {
    const header = document.createElement('div');
    header.className = 'summary__header';
    const h = document.createElement('h2');
    h.textContent = this.session?.room || 'Meeting ended';
    const meta = document.createElement('p');
    meta.className = 'summary__meta';
    meta.textContent = `${formatDuration(durationMs)} · ${this.segments.length} transcript lines`;
    header.append(h, meta);
    return header;
  }

  #recordingCard() {
    const children = [this.#paragraph(this.delivery.describe(this.recordingResult))];
    if (this.recordingResult.kind === 'indexeddb') {
      children.push(this.#paragraph(
        'It is held in this browser only. Download it or send it to Drive before clearing site data.',
      ));
    }
    return this.#card('Recording', children);
  }

  #notesCard() {
    const children = [];
    const section = (title, items, render) => {
      if (!items?.length) return;
      const h = document.createElement('h4');
      h.textContent = title;
      const ul = document.createElement('ul');
      ul.className = 'summary__list';
      for (const item of items) {
        const li = document.createElement('li');
        render(li, item);
        ul.appendChild(li);
      }
      children.push(h, ul);
    };

    section('Summary', this.notes.summary, (li, item) => { li.textContent = item.text; });
    section('Decisions', this.notes.decisions, (li, item) => { li.textContent = item.text; });
    section('Action items', this.notes.actions, (li, item) => {
      const owner = document.createElement('strong');
      owner.textContent = `${item.owner}: `;
      li.append(owner, document.createTextNode(item.text + (item.due ? ` (due ${item.due})` : '')));
    });
    section('Open questions', this.notes.questions, (li, item) => { li.textContent = item.text; });
    section('Risks and blockers', this.notes.risks, (li, item) => { li.textContent = item.text; });

    if (children.length === 0) {
      children.push(this.#paragraph('Speech was captured but no summary points could be extracted.'));
    }
    return this.#card('AI meeting notes', children);
  }

  #card(title, children) {
    const card = document.createElement('section');
    card.className = 'card';
    const h = document.createElement('h3');
    h.textContent = title;
    card.append(h, ...children);
    return card;
  }

  #paragraph(text) {
    const p = document.createElement('p');
    p.textContent = text;
    return p;
  }

  #renderSummaryActions() {
    const container = this.el.summaryActions;
    container.replaceChildren();
    const base = this.session?.baseName || exportBaseName('meeting', Date.now());

    const addButton = (label, handler, variant = 'ghost', icon = null) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `button button--${variant}`;
      button.textContent = label;
      if (icon) decorateButton(button, icon, { size: 17 });
      button.addEventListener('click', () => {
        Promise.resolve(handler(button)).catch((error) => {
          this.log.error(`action "${label}" failed`, error);
          this.toasts.error(error.message);
        });
      });
      container.appendChild(button);
      return button;
    };

    if (this.recordingResult) {
      if (this.recordingResult.kind !== 'file') {
        addButton('Download recording', () => this.delivery.download(this.recordingResult, `${base}.webm`), 'primary', 'download');
      }
      if (this.delivery.driveAvailable) {
        addButton('Save to Google Drive', (button) => this.#uploadToDrive(button, base), 'primary', 'cloud');
      }
    }

    if (this.segments.length > 0) {
      addButton('Copy notes', async () => {
        await navigator.clipboard.writeText(notesToMarkdown(this.notes));
        this.toasts.success('Notes copied to the clipboard.');
      }, 'ghost', 'copy');
      addButton('Notes (.md)', () => {
        downloadBlob(new Blob([notesToMarkdown(this.notes)], { type: 'text/markdown' }), `${base}-notes.md`);
      }, 'ghost', 'notes');
      addButton('Transcript (.txt)', () => {
        const text = transcriptToText(this.segments, { title: this.notes.title });
        downloadBlob(new Blob([text], { type: 'text/plain' }), `${base}-transcript.txt`);
      }, 'ghost', 'download');
      addButton('Subtitles (.vtt)', () => {
        downloadBlob(new Blob([transcriptToVtt(this.segments)], { type: 'text/vtt' }), `${base}.vtt`);
      }, 'ghost', 'download');
      addButton('Data (.json)', () => {
        const json = bundleToJson(this.notes, this.segments);
        downloadBlob(new Blob([json], { type: 'application/json' }), `${base}.json`);
      }, 'ghost', 'download');
    }

    addButton('Diagnostics', () => {
      const diagnostics = this.log.diagnostics({ session: this.session, config: { provider: this.config.provider } });
      downloadBlob(new Blob([JSON.stringify(diagnostics, null, 2)], { type: 'application/json' }), `${base}-diagnostics.json`);
    }, 'ghost', 'shield');
  }

  async #uploadToDrive(button, base) {
    button.disabled = true;
    const progress = this.el.uploadProgress;
    progress.hidden = false;
    progress.value = 0;

    const onProgress = throttle(({ uploaded, total }) => {
      progress.max = total;
      progress.value = uploaded;
    }, 250);

    this.uploadAbort = new AbortController();
    try {
      const result = await this.delivery.uploadToDrive(this.recordingResult, {
        name: `${base}.webm`,
        onProgress,
        signal: this.uploadAbort.signal,
      });

      if (this.segments.length > 0) {
        await this.delivery.uploadSidecars([
          { name: `${base}-notes.md`, text: notesToMarkdown(this.notes), mimeType: 'text/markdown' },
          { name: `${base}.vtt`, text: transcriptToVtt(this.segments), mimeType: 'text/vtt' },
        ]);
      }

      progress.hidden = true;
      this.#renderDriveLink(result.link);
      this.toasts.success('Uploaded to Google Drive.');
    } catch (error) {
      progress.hidden = true;
      button.disabled = false;
      throw error;
    }
  }

  #renderDriveLink(href) {
    const wrap = document.createElement('p');
    wrap.className = 'summary__link';
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open the recording in Google Drive';
    wrap.appendChild(link);
    this.el.summaryActions.parentElement.insertBefore(wrap, this.el.summaryActions.nextSibling);
  }

  #resetForNextMeeting() {
    this.recordingResult = null;
    this.notes = null;
    this.segments = [];
    this.session = null;
    this.transport = null;
    this.recorder = null;
    this.transcriber = null;
    this.resilience = null;
    document.body.dataset.recording = 'false';
    setButtonLabel(this.el.recordButton, 'Record');
    swapButtonIcon(this.el.recordButton, 'record', { size: 18 });
    this.el.recordState.textContent = 'Not recording';
    this.el.recordTimer.textContent = '00:00';
    this.el.recordSize.textContent = '';
    this.el.stage.replaceChildren();
    this.el.uploadProgress.hidden = true;
    this.notesWanted = false;
    this.#prefillLobby();
    this.#updateNotesEngineHint();
  }
}

export default MeetApp;
