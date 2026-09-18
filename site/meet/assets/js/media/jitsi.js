/**
 * Jitsi transport for NutraMEA Meet.
 *
 * Why Jitsi is the default:
 *   - No account, no API key, no credit card, no per-minute billing. There is
 *     no code path here that can produce a charge.
 *   - No duration cap, so a 60-minute call is unremarkable.
 *   - A real SFU: each client sends one stream up and the server fans it out.
 *     Mesh WebRTC would melt CPUs past three participants; this does not.
 *   - Self-hostable. Pointing `jitsi.domain` at meet.nutrameaint.com later is
 *     a one-line configuration change, not a rewrite.
 *
 * This module owns the iframe lifecycle only. It never touches recording —
 * recording is browser-side and provider-independent by design.
 */

import { loadScript } from './loader.js';
import { slugifyRoom } from '../core/util.js';

/** Maps our 180/360/720/1080 ladder onto Jitsi's sender constraints. */
export function videoConstraintsFor(height) {
  const h = Number(height) || 720;
  return {
    video: {
      height: { ideal: h, max: h, min: Math.min(180, h) },
    },
  };
}

/**
 * Builds the Jitsi `configOverwrite`.
 *
 * Pure and exported so the tuning can be asserted in tests — these flags are
 * the difference between a smooth hour and a stuttering one.
 */
export function buildJitsiConfig(options) {
  const {
    quality = 720,
    channelLastN = 12,
    startWithAudioMuted = false,
    startWithVideoMuted = false,
    prejoinEnabled = true,
    audioOnly = false,
    resilience = {},
  } = options || {};

  return {
    // ---- resolution / bandwidth -------------------------------------------
    resolution: quality,
    constraints: videoConstraintsFor(quality),
    // Simulcast lets the SFU forward a lower spatial layer to whoever is
    // struggling instead of degrading the call for everyone.
    disableSimulcast: false,
    // Stop decoding video nobody is looking at. Major CPU saving on long calls.
    enableLayerSuspension: true,
    channelLastN,

    // ---- audio resilience --------------------------------------------------
    // Opus DTX: stop sending packets during silence. Large bandwidth saving on
    // a two-person call where only one person talks at a time.
    enableOpusDtx: true,
    audioQuality: {
      stereo: false,
      opusMaxAverageBitrate: resilience.audioBitrateFloor || 24000,
    },
    // Browser-side audio processing. Echo cancellation and noise suppression
    // matter more for perceived "professional" quality than raw bitrate.
    disableAP: false,
    disableAEC: false,
    disableNS: false,
    disableAGC: false,

    // ---- startup state -----------------------------------------------------
    startWithAudioMuted,
    startWithVideoMuted: startWithVideoMuted || audioOnly,
    startAudioOnly: audioOnly,

    // ---- latency -----------------------------------------------------------
    // Direct peer-to-peer for 1:1 calls: lowest possible latency and no server
    // hop. Jitsi transparently promotes to the SFU when a third person joins.
    p2p: {
      enabled: true,
      preferredCodec: 'VP9',
    },
    preferredCodec: 'VP9',

    // ---- performance -------------------------------------------------------
    // Per-participant audio level meters cost a surprising amount of main
    // thread time over an hour and add nothing here.
    disableAudioLevels: true,
    // We render our own branding and controls.
    prejoinConfig: { enabled: prejoinEnabled },
    prejoinPageEnabled: prejoinEnabled,
    disableDeepLinking: true,
    disableThirdPartyRequests: true,
    // Our own recorder handles this; hide Jitsi's (which needs Dropbox or a
    // paid Jibri deployment and would confuse the organiser).
    fileRecordingsEnabled: false,
    liveStreamingEnabled: false,
    hiddenPremeetingButtons: ['invite'],
  };
}

/** Interface chrome: strip Jitsi branding so the call reads as NutraMEA's. */
export function buildJitsiInterfaceConfig() {
  return {
    SHOW_JITSI_WATERMARK: false,
    SHOW_WATERMARK_FOR_GUESTS: false,
    SHOW_BRAND_WATERMARK: false,
    SHOW_POWERED_BY: false,
    JITSI_WATERMARK_LINK: '',
    DEFAULT_BACKGROUND: '#0a0c0b',
    DISABLE_VIDEO_BACKGROUND: false,
    TOOLBAR_BUTTONS: [
      'microphone', 'camera', 'desktop', 'fullscreen',
      'fodeviceselection', 'hangup', 'chat', 'settings',
      'raisehand', 'videoquality', 'filmstrip', 'tileview',
      'select-background', 'participants-pane',
    ],
    SETTINGS_SECTIONS: ['devices', 'language', 'profile'],
    MOBILE_APP_PROMO: false,
    HIDE_INVITE_MORE_HEADER: true,
    DISABLE_JOIN_LEAVE_NOTIFICATIONS: false,
    VIDEO_QUALITY_LABEL_DISABLED: false,
  };
}

/** Full room name including the NutraMEA namespace prefix. */
export function buildRoomName(room, prefix) {
  const slug = slugifyRoom(room);
  // `slugifyRoom` is contractually never empty — it falls back to "room" — so
  // an absent prefix must be detected BEFORE slugifying, or every unprefixed
  // room silently becomes "room-<name>".
  const hasPrefix = /[a-zA-Z0-9]/.test(String(prefix ?? ''));
  return hasPrefix ? `${slugifyRoom(prefix)}-${slug}` : slug;
}

export class JitsiTransport {
  constructor({ config, logger, bus }) {
    this.config = config;
    this.log = logger.child('jitsi');
    this.bus = bus;
    this.api = null;
    this.joined = false;
    this.disposed = false;
    this.participants = new Map();
    this.dominantSpeakerId = null;
    this.localId = null;
    this.currentQuality = config.quality;
  }

  get name() { return 'jitsi'; }

  /** Domain used for both the SDK URL and the conference. */
  get domain() {
    return this.config.jitsi?.domain || 'meet.jit.si';
  }

  async join({ container, room, displayName, audioOnly = false }) {
    if (this.api) throw new Error('Already joined — call leave() first.');

    const scriptUrl = `https://${this.domain}/external_api.js`;
    this.log.info('loading transport sdk', { scriptUrl });
    await loadScript(scriptUrl, { timeoutMs: 15000 });

    const Ctor = window.JitsiMeetExternalAPI;
    if (typeof Ctor !== 'function') {
      throw new Error('The meeting SDK loaded but did not initialise. Reload the page and try again.');
    }

    const roomName = buildRoomName(room, this.config.jitsi?.roomPrefix);
    const tenant = this.config.jitsi?.tenant;

    const options = {
      // JaaS puts the tenant in the room path; the public deployment does not.
      roomName: tenant ? `${tenant}/${roomName}` : roomName,
      parentNode: container,
      width: '100%',
      height: '100%',
      configOverwrite: buildJitsiConfig({
        quality: this.config.quality,
        channelLastN: this.config.channelLastN,
        startWithAudioMuted: this.config.startWithAudioMuted,
        startWithVideoMuted: this.config.startWithVideoMuted,
        prejoinEnabled: this.config.prejoinEnabled,
        audioOnly,
        resilience: this.config.resilience,
      }),
      interfaceConfigOverwrite: buildJitsiInterfaceConfig(),
      userInfo: displayName ? { displayName } : undefined,
    };
    if (this.config.jitsi?.jwt) options.jwt = this.config.jitsi.jwt;

    this.log.info('joining room', { roomName, audioOnly });
    this.api = new Ctor(this.domain, options);
    this.#wireEvents();

    // Surface a clear error rather than hanging if the conference never forms.
    await this.#waitForJoin(60000);
    return { roomName, url: `https://${this.domain}/${options.roomName}` };
  }

  #waitForJoin(timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('The meeting did not connect in time. This is usually a firewall blocking UDP — try another network, or switch to audio-only.'));
      }, timeoutMs);

      const onJoined = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      // The prejoin screen counts as "ready": the user is in control from
      // there, so we must not time them out while they pick a camera.
      this.api.addListener('videoConferenceJoined', onJoined);
      this.api.addListener('readyToClose', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('The meeting was closed before it connected.'));
      });
      if (this.config.prejoinEnabled) {
        this.api.addListener('prejoinScreenLoaded', onJoined);
      }
    });
  }

  #wireEvents() {
    const api = this.api;

    api.addListener('videoConferenceJoined', (event) => {
      this.joined = true;
      this.localId = event.id;
      this.participants.set(event.id, { id: event.id, displayName: event.displayName, local: true });
      this.log.info('conference joined', { id: event.id, room: event.roomName });
      this.bus.emit('transport:joined', { id: event.id, roomName: event.roomName });
      this.bus.emit('transport:participants', this.participantList());
    });

    api.addListener('videoConferenceLeft', () => {
      this.joined = false;
      this.log.info('conference left');
      this.bus.emit('transport:left', {});
    });

    api.addListener('participantJoined', (event) => {
      this.participants.set(event.id, { id: event.id, displayName: event.displayName, local: false });
      this.bus.emit('transport:participantJoined', { id: event.id, displayName: event.displayName });
      this.bus.emit('transport:participants', this.participantList());
    });

    api.addListener('participantLeft', (event) => {
      this.participants.delete(event.id);
      this.bus.emit('transport:participantLeft', { id: event.id });
      this.bus.emit('transport:participants', this.participantList());
    });

    api.addListener('displayNameChange', (event) => {
      const existing = this.participants.get(event.id);
      if (existing) existing.displayName = event.displayname || event.displayName;
      this.bus.emit('transport:participants', this.participantList());
    });

    // Drives speaker attribution in the transcript.
    api.addListener('dominantSpeakerChanged', (event) => {
      this.dominantSpeakerId = event.id;
      const who = this.participants.get(event.id);
      this.bus.emit('transport:dominantSpeaker', {
        id: event.id,
        displayName: who?.displayName || 'Participant',
      });
    });

    api.addListener('audioMuteStatusChanged', (event) => {
      this.bus.emit('transport:audioMute', { muted: event.muted });
    });
    api.addListener('videoMuteStatusChanged', (event) => {
      this.bus.emit('transport:videoMute', { muted: event.muted });
    });
    api.addListener('screenSharingStatusChanged', (event) => {
      this.bus.emit('transport:screenShare', { on: event.on });
    });

    api.addListener('readyToClose', () => {
      this.bus.emit('transport:readyToClose', {});
    });

    api.addListener('errorOccurred', (event) => {
      this.log.error('transport error', event);
      this.bus.emit('transport:error', {
        message: event?.error?.message || 'Meeting error',
        fatal: Boolean(event?.error?.isFatal),
      });
    });
  }

  participantList() {
    return Array.from(this.participants.values());
  }

  participantCount() {
    return this.participants.size;
  }

  /* ---------------------------------------------------------- controls */

  toggleAudio() { this.api?.executeCommand('toggleAudio'); }
  toggleVideo() { this.api?.executeCommand('toggleVideo'); }
  toggleShareScreen() { this.api?.executeCommand('toggleShareScreen'); }
  toggleChat() { this.api?.executeCommand('toggleChat'); }
  hangup() { this.api?.executeCommand('hangup'); }

  setDisplayName(name) {
    this.api?.executeCommand('displayName', String(name || '').slice(0, 64));
  }

  /**
   * The main lever for a degrading link: drop the sender resolution before the
   * connection starts dropping packets on its own.
   */
  setVideoQuality(height) {
    if (!this.api) return;
    const allowed = [180, 360, 720, 1080];
    const target = allowed.includes(Number(height)) ? Number(height) : 360;
    if (target === this.currentQuality) return;
    this.currentQuality = target;
    this.api.executeCommand('setVideoQuality', target);
    this.log.info('video quality set', { height: target });
    this.bus.emit('transport:qualityChanged', { height: target });
  }

  /** Last-resort degradation: keep voice, drop all video. */
  async setAudioOnly(enabled) {
    if (!this.api) return;
    // `setVideoQuality(0)` is how the external API expresses audio-only.
    this.api.executeCommand('setVideoQuality', enabled ? 0 : this.config.quality);
    this.log.info('audio-only mode', { enabled });
    this.bus.emit('transport:audioOnly', { enabled });
  }

  async isAudioMuted() {
    try { return await this.api?.isAudioMuted(); } catch { return null; }
  }

  async leave() {
    if (!this.api) return;
    try {
      this.api.executeCommand('hangup');
    } catch {
      /* already gone */
    }
    this.dispose();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.api?.dispose();
    } catch (error) {
      this.log.warn('dispose failed', error);
    }
    this.api = null;
    this.joined = false;
    this.participants.clear();
  }
}

export default JitsiTransport;
