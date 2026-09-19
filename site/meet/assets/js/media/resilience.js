/**
 * Adaptive degradation: keep VOICE alive when the link is bad.
 *
 * Video is ~95% of a call's bitrate. On an unstable connection the correct
 * response is to spend the remaining bandwidth entirely on audio, because a
 * frozen picture with clear speech is a usable meeting and the reverse is not.
 *
 * Ladder: 720p → 360p → 180p → audio-only, with hysteresis in both directions
 * so a brief dip never causes visible flapping.
 *
 * Signal sources, in order of reliability:
 *   1. Transport-reported quality (Daily exposes this directly).
 *   2. The Network Information API (`navigator.connection`) — coarse, and not
 *      available in Safari or Firefox, but a genuine early warning where it is.
 *   3. The transport's own internal adaptation, which continues regardless.
 *
 * An iframe embed cannot read RTCPeerConnection stats directly, so this
 * controller supplements the transport's built-in adaptation rather than
 * replacing it.
 */

export const LADDER = [720, 360, 180, 0]; // 0 === audio-only

/** Normalises any signal source to 'good' | 'fair' | 'poor'. */
export function classifyConnection({ effectiveType, downlinkMbps, rttMs, reported } = {}) {
  // An explicit report from the transport always wins.
  if (reported === 'poor' || reported === 'low' || reported === 'bad') return 'poor';
  if (reported === 'good' || reported === 'excellent' || reported === 'high') return 'good';
  if (reported === 'fair' || reported === 'medium') return 'fair';

  if (effectiveType === 'slow-2g' || effectiveType === '2g') return 'poor';
  if (typeof downlinkMbps === 'number' && Number.isFinite(downlinkMbps)) {
    // 720p needs ~1.2 Mbps up plus headroom for each incoming stream.
    if (downlinkMbps < 0.6) return 'poor';
    if (downlinkMbps < 1.8) return 'fair';
  }
  if (typeof rttMs === 'number' && Number.isFinite(rttMs)) {
    if (rttMs > 600) return 'poor';
    if (rttMs > 300) return 'fair';
  }
  if (effectiveType === '3g') return 'fair';
  return 'good';
}

/**
 * Decides the next ladder index from the current one and how long the link has
 * been in its present state. Pure, so the hysteresis is directly testable.
 *
 * @returns {number} the ladder index to move to (possibly unchanged)
 */
export function decideStep({
  currentIndex,
  quality,
  poorForMs,
  goodForMs,
  downAfterMs,
  upAfterMs,
  floorIndex = LADDER.length - 1,
  ceilingIndex = 0,
}) {
  const maxIndex = Math.min(floorIndex, LADDER.length - 1);
  if (quality === 'poor' && poorForMs >= downAfterMs && currentIndex < maxIndex) {
    return currentIndex + 1;
  }
  // Recovery is deliberately slower than degradation: stepping up too eagerly
  // on a flaky link produces exactly the oscillation we are avoiding.
  if (quality === 'good' && goodForMs >= upAfterMs && currentIndex > ceilingIndex) {
    return currentIndex - 1;
  }
  return currentIndex;
}

export class ResilienceController {
  constructor({ transport, config, logger, bus }) {
    this.transport = transport;
    this.config = config;
    this.log = logger.child('resilience');
    this.bus = bus;

    this.settings = config.resilience || {};
    this.enabled = this.settings.audioPriority !== false;
    this.index = 0;
    this.quality = 'good';
    this.qualitySince = Date.now();
    this.manualOverride = false;
    this.timer = null;
    this.connection = typeof navigator !== 'undefined' ? navigator.connection : null;
    this.onConnectionChange = () => this.sample();

    // Start the ladder at whatever resolution the operator configured.
    const configuredIndex = LADDER.indexOf(Number(config.quality));
    this.ceilingIndex = configuredIndex >= 0 ? configuredIndex : 0;
    this.index = this.ceilingIndex;
  }

  start() {
    if (!this.enabled) {
      this.log.info('adaptive degradation disabled by configuration');
      return;
    }
    this.connection?.addEventListener?.('change', this.onConnectionChange);
    // Poll as well: the `change` event is not fired for gradual degradation.
    this.timer = setInterval(() => this.sample(), 5000);
    this.log.info('adaptive degradation active', {
      hasNetworkInfo: Boolean(this.connection),
      startIndex: this.index,
    });
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.connection?.removeEventListener?.('change', this.onConnectionChange);
  }

  /** Lets a transport push its own quality reading in (Daily does this). */
  report(quality) {
    this.#observe(classifyConnection({ reported: quality }));
  }

  sample() {
    if (this.manualOverride) return;
    const quality = classifyConnection({
      effectiveType: this.connection?.effectiveType,
      downlinkMbps: this.connection?.downlink,
      rttMs: this.connection?.rtt,
    });
    this.#observe(quality);
  }

  #observe(quality) {
    const now = Date.now();
    if (quality !== this.quality) {
      this.quality = quality;
      this.qualitySince = now;
      this.bus.emit('resilience:quality', { quality });
    }
    if (this.manualOverride) return;

    const heldMs = now - this.qualitySince;
    const next = decideStep({
      currentIndex: this.index,
      quality,
      poorForMs: quality === 'poor' ? heldMs : 0,
      goodForMs: quality === 'good' ? heldMs : 0,
      downAfterMs: this.settings.autoAudioOnlyAfterPoorMs ?? 15000,
      upAfterMs: this.settings.autoRestoreVideoAfterGoodMs ?? 20000,
      ceilingIndex: this.ceilingIndex,
    });
    if (next !== this.index) this.#applyIndex(next, 'auto');
  }

  #applyIndex(index, reason) {
    const clamped = Math.max(0, Math.min(LADDER.length - 1, index));
    this.index = clamped;
    // Re-arm hysteresis so we do not step twice off one observation.
    this.qualitySince = Date.now();
    const height = LADDER[clamped];
    this.log.info('stepping video quality', { height, reason, link: this.quality });

    if (height === 0) this.transport.setAudioOnly(true);
    else {
      this.transport.setAudioOnly(false);
      this.transport.setVideoQuality(height);
    }
    this.bus.emit('resilience:step', {
      height,
      audioOnly: height === 0,
      reason,
      quality: this.quality,
    });
  }

  /** User pressed the audio-only button — stop adapting and honour the choice. */
  forceAudioOnly(enabled) {
    this.manualOverride = enabled;
    if (enabled) {
      this.#applyIndex(LADDER.length - 1, 'manual');
    } else {
      this.#applyIndex(this.ceilingIndex, 'manual');
      this.qualitySince = Date.now();
    }
  }

  get state() {
    return {
      height: LADDER[this.index],
      audioOnly: LADDER[this.index] === 0,
      quality: this.quality,
      manual: this.manualOverride,
    };
  }
}

export default ResilienceController;
