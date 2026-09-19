/**
 * Minimal synchronous event bus.
 *
 * A listener that throws must never take down the emitter — during a live call
 * a broken notes panel cannot be allowed to stop the recorder. Errors are
 * therefore caught, reported once, and the remaining listeners still run.
 */
export class Bus {
  constructor(onListenerError = null) {
    this.listeners = new Map();
    this.onListenerError = onListenerError;
  }

  on(event, handler) {
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off(event, handler) {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this.listeners.delete(event);
  }

  emit(event, payload) {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return 0;
    // Copy first: a handler may unsubscribe itself or others mid-dispatch.
    let delivered = 0;
    for (const handler of Array.from(set)) {
      try {
        handler(payload);
        delivered += 1;
      } catch (error) {
        if (this.onListenerError) {
          try {
            this.onListenerError(error, event);
          } catch {
            /* a failing error reporter must not recurse */
          }
        }
      }
    }
    return delivered;
  }

  removeAll(event) {
    if (event === undefined) this.listeners.clear();
    else this.listeners.delete(event);
  }

  listenerCount(event) {
    return this.listeners.get(event)?.size ?? 0;
  }
}

export default Bus;
