/**
 * Pre-flight setup check.
 *
 * Exists because of one failure that is silent until it is too late: when
 * Chrome asks what to share and the organiser does not tick "Also share tab
 * audio", the recording captures their own microphone and nothing else. The
 * meeting sounds fine throughout. The problem is only discovered on playback,
 * after the call, when it cannot be fixed.
 *
 * So this records a few seconds through exactly the same capture call the real
 * recorder uses, reports what was and was not captured, and plays it back.
 * Everything it checks is checked before the meeting rather than after it.
 */

import { DISPLAY_CAPTURE_OPTIONS, pickMimeType, isRecordingSupported } from '../media/recorder.js';
import { iconElement } from './icons.js';
import { formatBytes } from '../core/util.js';

const SAMPLE_MS = 6000;

/** One line of the report. `ok: null` means "checked, not applicable". */
function check(ok, title, detail) {
  return { ok, title, detail };
}

/**
 * Captures a short sample and reports on it.
 *
 * Must be called from a user gesture — the screen picker requires one.
 */
export async function runPreflight({ logger, onProgress = null } = {}) {
  const log = logger?.child?.('preflight') || logger;
  const results = [];
  let displayStream = null;
  let micStream = null;
  let audioContext = null;

  if (!isRecordingSupported()) {
    return {
      fatal: true,
      results: [check(false, 'Recording is not available in this browser',
        'Use Chrome or Edge on a desktop or laptop. The call itself works here, but it cannot be recorded.')],
      blob: null,
    };
  }

  try {
    onProgress?.('Asking for the tab…');
    displayStream = await navigator.mediaDevices.getDisplayMedia(DISPLAY_CAPTURE_OPTIONS);
  } catch (error) {
    return {
      fatal: true,
      results: [check(false, 'Screen sharing was declined',
        'Recording needs permission to capture this tab. Run the test again and choose "This tab".')],
      blob: null,
    };
  }

  try {
    const videoTrack = displayStream.getVideoTracks()[0];
    const tabAudio = displayStream.getAudioTracks();

    results.push(videoTrack
      ? check(true, 'Video is being captured', trackDescription(videoTrack))
      : check(false, 'No video was captured', 'Run the test again and choose "This tab".'));

    // The check this whole screen exists for.
    results.push(tabAudio.length > 0
      ? check(true, 'Tab audio is shared',
        'The other person\'s voice will be recorded.')
      : check(false, 'Tab audio is NOT shared',
        'The other person will be silent in your recording. Run the test again and tick "Also share tab audio" in the sharing dialog.'));

    onProgress?.('Checking your microphone…');
    let micLevel = 0;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      results.push(check(true, 'Microphone is available', 'Your own voice will be recorded.'));
    } catch (error) {
      results.push(check(false, 'Microphone unavailable',
        'Your own voice will not be recorded, though the other person still will be. Check the browser\'s microphone permission.'));
    }

    // Mix exactly as the recorder does, so the sample is representative.
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx();
    const destination = audioContext.createMediaStreamDestination();
    let analyser = null;

    if (tabAudio.length > 0) {
      audioContext.createMediaStreamSource(new MediaStream(tabAudio)).connect(destination);
    }
    if (micStream) {
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      micSource.connect(analyser);
    }

    const recordStream = new MediaStream([
      ...(videoTrack ? [videoTrack] : []),
      ...destination.stream.getAudioTracks(),
    ]);

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(recordStream, {
      mimeType,
      videoBitsPerSecond: 800_000,
      audioBitsPerSecond: 128_000,
    });

    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };

    const finished = new Promise((resolve) => {
      recorder.onstop = resolve;
      // A recorder that never stops must not hang the dialog.
      setTimeout(resolve, SAMPLE_MS + 4000);
    });

    recorder.start(1000);
    const started = Date.now();
    // Sample the microphone while recording so we can say whether we heard
    // anything, rather than only whether a device exists.
    const meter = setInterval(() => {
      if (analyser) micLevel = Math.max(micLevel, peakLevel(analyser));
      const left = Math.ceil((SAMPLE_MS - (Date.now() - started)) / 1000);
      onProgress?.(`Recording a sample… say something. ${Math.max(0, left)}s`);
    }, 150);

    await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
    clearInterval(meter);
    try {
      recorder.requestData();
      recorder.stop();
    } catch {
      /* already stopped */
    }
    await finished;

    if (analyser) {
      results.push(micLevel > 0.012
        ? check(true, 'We heard you', 'Your microphone is picking up sound at a usable level.')
        : check(false, 'We did not hear anything',
          'Your microphone is connected but no sound reached it. Check that the right input is selected and that it is not muted in hardware.'));
    }

    const blob = new Blob(chunks, { type: mimeType });
    results.push(blob.size > 0
      ? check(true, 'A playable file was produced', `${formatBytes(blob.size)} for ${SAMPLE_MS / 1000} seconds.`)
      : check(false, 'No file was produced', 'Recording started but produced nothing. Try another browser.'));

    log?.info?.('preflight complete', {
      hasTabAudio: tabAudio.length > 0,
      hasMic: Boolean(micStream),
      micLevel: Number(micLevel.toFixed(3)),
      bytes: blob.size,
    });

    return { fatal: false, results, blob, mimeType };
  } finally {
    for (const stream of [displayStream, micStream]) {
      stream?.getTracks().forEach((track) => track.stop());
    }
    try { await audioContext?.close(); } catch { /* already closed */ }
  }
}

function peakLevel(analyser) {
  const buffer = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buffer);
  let peak = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const value = Math.abs(buffer[i]);
    if (value > peak) peak = value;
  }
  return peak;
}

function trackDescription(track) {
  const settings = track.getSettings?.() || {};
  if (!settings.width) return 'Ready.';
  return `${settings.width}×${settings.height}, ${Math.round(settings.frameRate || 0)} fps.`;
}

/** Dialog wrapper around the check. */
export class PreflightDialog {
  constructor({ logger }) {
    this.logger = logger;
    this.dialog = null;
    this.objectUrl = null;
  }

  open() {
    this.#build();
    this.dialog.showModal();
  }

  #build() {
    if (this.dialog) {
      this.dialog.remove();
      this.#revoke();
    }
    const dialog = document.createElement('dialog');
    dialog.className = 'preflight';
    dialog.innerHTML = `
      <form method="dialog" class="preflight__close-form">
        <button class="preflight__close" aria-label="Close" value="close"></button>
      </form>
      <h2 class="preflight__title">Check your setup</h2>
      <p class="preflight__lead">
        This records six seconds exactly the way a real meeting does, then plays it
        back. Choose <strong>This tab</strong> and tick <strong>Also share tab audio</strong>.
      </p>
      <div class="preflight__body">
        <button type="button" class="button button--primary preflight__start">Start the check</button>
      </div>`;
    dialog.querySelector('.preflight__close').appendChild(iconElement('close', { size: 18 }));
    dialog.addEventListener('close', () => this.#revoke());
    document.body.appendChild(dialog);
    this.dialog = dialog;

    dialog.querySelector('.preflight__start').addEventListener('click', () => this.#run());
  }

  async #run() {
    const body = this.dialog.querySelector('.preflight__body');
    const status = document.createElement('p');
    status.className = 'preflight__status';
    status.textContent = 'Starting…';
    body.replaceChildren(status);

    let outcome;
    try {
      outcome = await runPreflight({
        logger: this.logger,
        onProgress: (message) => { status.textContent = message; },
      });
    } catch (error) {
      status.textContent = `The check could not run: ${error.message}`;
      return;
    }

    body.replaceChildren();
    const failures = outcome.results.filter((r) => r.ok === false).length;

    const verdict = document.createElement('p');
    verdict.className = failures === 0 ? 'preflight__verdict preflight__verdict--ok' : 'preflight__verdict preflight__verdict--warn';
    verdict.textContent = failures === 0
      ? 'Everything is ready. Your recording will capture both sides of the conversation.'
      : failures === 1
        ? 'One thing needs attention before your meeting.'
        : `${failures} things need attention before your meeting.`;
    body.appendChild(verdict);

    const list = document.createElement('ul');
    list.className = 'preflight__list';
    for (const result of outcome.results) {
      const item = document.createElement('li');
      item.className = result.ok ? 'preflight__item preflight__item--ok' : 'preflight__item preflight__item--bad';
      item.appendChild(iconElement(result.ok ? 'check' : 'alert', { size: 18 }));
      const text = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = result.title;
      const detail = document.createElement('span');
      detail.textContent = result.detail;
      text.append(title, detail);
      item.appendChild(text);
      list.appendChild(item);
    }
    body.appendChild(list);

    if (outcome.blob?.size) {
      this.objectUrl = URL.createObjectURL(outcome.blob);
      const video = document.createElement('video');
      video.className = 'preflight__playback';
      video.src = this.objectUrl;
      video.controls = true;
      video.playsInline = true;
      const hint = document.createElement('p');
      hint.className = 'preflight__hint';
      hint.textContent = 'Play this back and listen. If you can hear yourself, the recording path works end to end.';
      body.append(hint, video);
    }

    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'button button--ghost preflight__again';
    again.textContent = 'Run the check again';
    again.addEventListener('click', () => this.#run());
    body.appendChild(again);
  }

  #revoke() {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}

export default PreflightDialog;
