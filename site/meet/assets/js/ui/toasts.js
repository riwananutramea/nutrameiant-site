/**
 * Non-blocking notifications.
 *
 * `alert()` would pause the page — during a live recording that is unacceptable,
 * so everything user-facing goes through here instead.
 */

const ICONS = { info: 'i', success: '✓', warning: '!', error: '×' };

export class Toasts {
  constructor(container) {
    this.container = container;
    this.active = new Map();
  }

  show(message, { type = 'info', timeoutMs = 6000, key = null, actions = [] } = {}) {
    // A keyed toast replaces its predecessor rather than stacking duplicates —
    // otherwise a repeating warning buries the screen.
    if (key && this.active.has(key)) this.dismiss(key);

    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const icon = document.createElement('span');
    icon.className = 'toast__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = ICONS[type] || ICONS.info;

    const body = document.createElement('div');
    body.className = 'toast__body';
    body.textContent = message;

    el.append(icon, body);

    if (actions.length) {
      const row = document.createElement('div');
      row.className = 'toast__actions';
      for (const action of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'toast__action';
        button.textContent = action.label;
        button.addEventListener('click', () => {
          action.onClick?.();
          this.dismiss(id);
        });
        row.appendChild(button);
      }
      el.appendChild(row);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast__close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    const id = key || `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    close.addEventListener('click', () => this.dismiss(id));
    el.appendChild(close);

    this.container.appendChild(el);
    const timer = timeoutMs > 0 ? setTimeout(() => this.dismiss(id), timeoutMs) : null;
    this.active.set(id, { el, timer });
    return id;
  }

  dismiss(id) {
    const entry = this.active.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.el.remove();
    this.active.delete(id);
  }

  info(message, options) { return this.show(message, { ...options, type: 'info' }); }
  success(message, options) { return this.show(message, { ...options, type: 'success' }); }
  warning(message, options) { return this.show(message, { ...options, type: 'warning', timeoutMs: 10000 }); }
  error(message, options) { return this.show(message, { ...options, type: 'error', timeoutMs: 0 }); }
}

export default Toasts;
