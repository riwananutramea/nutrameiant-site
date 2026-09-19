import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJitsiConfig, buildJitsiInterfaceConfig, buildRoomName, videoConstraintsFor,
} from '../site/meet/assets/js/media/jitsi.js';
import {
  classifyConnection, decideStep, LADDER,
} from '../site/meet/assets/js/media/resilience.js';
import {
  pickMimeType, fileExtensionFor, MIME_CANDIDATES,
} from '../site/meet/assets/js/media/recorder.js';
import { classifySpeechError } from '../site/meet/assets/js/ai/transcriber.js';

/* ------------------------------------------------------------------ jitsi */

test('buildJitsiConfig sets the flags that keep a long call smooth', () => {
  const config = buildJitsiConfig({ quality: 720, channelLastN: 12 });
  // Simulcast lets the server degrade one struggling viewer, not everyone.
  assert.equal(config.disableSimulcast, false);
  // Suspending unwatched layers is the main CPU saving over an hour.
  assert.equal(config.enableLayerSuspension, true);
  assert.equal(config.channelLastN, 12);
  // Audio level meters cost main-thread time and add nothing here.
  assert.equal(config.disableAudioLevels, true);
  // Direct peer-to-peer for 1:1 is the lowest-latency path.
  assert.equal(config.p2p.enabled, true);
  // DTX stops sending packets during silence.
  assert.equal(config.enableOpusDtx, true);
  assert.equal(config.resolution, 720);
});

test('buildJitsiConfig never enables a paid or unavailable recording path', () => {
  const config = buildJitsiConfig({});
  assert.equal(config.fileRecordingsEnabled, false);
  assert.equal(config.liveStreamingEnabled, false);
});

test('buildJitsiConfig honours audio-only entry', () => {
  const config = buildJitsiConfig({ audioOnly: true, quality: 720 });
  assert.equal(config.startAudioOnly, true);
  assert.equal(config.startWithVideoMuted, true);
});

test('buildJitsiConfig applies the audio bitrate floor', () => {
  const config = buildJitsiConfig({ resilience: { audioBitrateFloor: 16000 } });
  assert.equal(config.audioQuality.opusMaxAverageBitrate, 16000);
  assert.equal(config.audioQuality.stereo, false);
});

test('interface config strips third-party branding', () => {
  const ui = buildJitsiInterfaceConfig();
  assert.equal(ui.SHOW_JITSI_WATERMARK, false);
  assert.equal(ui.SHOW_POWERED_BY, false);
  assert.ok(ui.TOOLBAR_BUTTONS.includes('hangup'));
  assert.ok(ui.TOOLBAR_BUTTONS.includes('desktop'));
});

test('buildRoomName namespaces and sanitises', () => {
  assert.equal(buildRoomName('Board Sync', 'NutraMEAInt'), 'NutraMEAInt-Board-Sync');
  assert.equal(buildRoomName('  ', 'NutraMEAInt'), 'NutraMEAInt-room');
  assert.equal(buildRoomName('board', ''), 'board');
  assert.equal(buildRoomName('board', null), 'board');
  assert.equal(buildRoomName('board', undefined), 'board');
  // A prefix of only punctuation is no prefix at all.
  assert.equal(buildRoomName('board', '!!!'), 'board');
});

test('videoConstraintsFor clamps the ideal and max together', () => {
  const c = videoConstraintsFor(720);
  assert.equal(c.video.height.ideal, 720);
  assert.equal(c.video.height.max, 720);
  assert.equal(videoConstraintsFor(180).video.height.min, 180);
});

/* ------------------------------------------------------------- resilience */

test('classifyConnection trusts an explicit transport report first', () => {
  assert.equal(classifyConnection({ reported: 'poor', downlinkMbps: 100 }), 'poor');
  assert.equal(classifyConnection({ reported: 'good', effectiveType: '2g' }), 'good');
});

test('classifyConnection reads the network information API', () => {
  assert.equal(classifyConnection({ effectiveType: '2g' }), 'poor');
  assert.equal(classifyConnection({ effectiveType: 'slow-2g' }), 'poor');
  assert.equal(classifyConnection({ downlinkMbps: 0.3 }), 'poor');
  assert.equal(classifyConnection({ downlinkMbps: 1.0 }), 'fair');
  assert.equal(classifyConnection({ downlinkMbps: 10 }), 'good');
  assert.equal(classifyConnection({ rttMs: 800 }), 'poor');
  assert.equal(classifyConnection({ rttMs: 400 }), 'fair');
  assert.equal(classifyConnection({}), 'good');
});

test('the ladder ends in audio-only', () => {
  assert.deepEqual(LADDER, [720, 360, 180, 0]);
});

test('decideStep degrades only after the dip has persisted', () => {
  const opts = { downAfterMs: 15000, upAfterMs: 20000 };
  // A brief dip must not cause visible flapping.
  assert.equal(decideStep({ currentIndex: 0, quality: 'poor', poorForMs: 5000, goodForMs: 0, ...opts }), 0);
  assert.equal(decideStep({ currentIndex: 0, quality: 'poor', poorForMs: 16000, goodForMs: 0, ...opts }), 1);
});

test('decideStep recovers more slowly than it degrades', () => {
  const opts = { downAfterMs: 15000, upAfterMs: 20000 };
  assert.equal(decideStep({ currentIndex: 2, quality: 'good', poorForMs: 0, goodForMs: 16000, ...opts }), 2);
  assert.equal(decideStep({ currentIndex: 2, quality: 'good', poorForMs: 0, goodForMs: 21000, ...opts }), 1);
});

test('decideStep respects both ends of the ladder', () => {
  const opts = { downAfterMs: 1, upAfterMs: 1 };
  // Cannot degrade past audio-only.
  assert.equal(decideStep({ currentIndex: 3, quality: 'poor', poorForMs: 9999, goodForMs: 0, ...opts }), 3);
  // Cannot climb above the configured starting resolution.
  assert.equal(decideStep({ currentIndex: 1, quality: 'good', poorForMs: 0, goodForMs: 9999, ceilingIndex: 1, ...opts }), 1);
});

test('decideStep holds steady while the link is merely fair', () => {
  assert.equal(
    decideStep({ currentIndex: 1, quality: 'fair', poorForMs: 0, goodForMs: 0, downAfterMs: 1, upAfterMs: 1 }),
    1,
  );
});

/* --------------------------------------------------------------- recorder */

test('pickMimeType prefers VP9 and degrades gracefully', () => {
  assert.equal(pickMimeType(MIME_CANDIDATES, () => true), 'video/webm;codecs=vp9,opus');
  // A Safari-shaped browser with only H.264.
  assert.equal(
    pickMimeType(MIME_CANDIDATES, (t) => t.includes('h264') || t === 'video/mp4'),
    'video/webm;codecs=h264,opus',
  );
  assert.equal(pickMimeType(MIME_CANDIDATES, () => false), null);
});

test('pickMimeType survives a probe that throws', () => {
  assert.equal(
    pickMimeType(['video/webm;codecs=vp9,opus', 'video/webm'], (t) => {
      if (t.includes('vp9')) throw new TypeError('bad type');
      return true;
    }),
    'video/webm',
  );
});

test('fileExtensionFor matches the container', () => {
  assert.equal(fileExtensionFor('video/webm;codecs=vp9,opus'), 'webm');
  assert.equal(fileExtensionFor('video/mp4'), 'mp4');
  assert.equal(fileExtensionFor(null), 'webm');
});

/* ------------------------------------------------------------ transcriber */

test('classifySpeechError separates fatal from routine', () => {
  // Routine throughout any real meeting — must restart silently.
  assert.equal(classifySpeechError('no-speech'), 'restart');
  assert.equal(classifySpeechError('aborted'), 'restart');
  // Worth backing off for.
  assert.equal(classifySpeechError('network'), 'backoff');
  // No point retrying.
  assert.equal(classifySpeechError('not-allowed'), 'fatal');
  assert.equal(classifySpeechError('service-not-allowed'), 'fatal');
  assert.equal(classifySpeechError('audio-capture'), 'fatal');
});
