/**
 * Third-party script loading with a hard timeout.
 *
 * A provider SDK that never loads must fail fast and loudly. Without a timeout
 * the join button simply hangs forever, which is the worst possible failure
 * mode two minutes before a scheduled call.
 */

const loaded = new Map();

export function loadScript(src, { timeoutMs = 15000, integrity = null } = {}) {
  if (loaded.has(src)) return loaded.get(src);

  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-nutramea-src="${CSS.escape(src)}"]`);
    if (existing && existing.dataset.loaded === 'true') {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.nutrameaSrc = src;
    if (integrity) {
      script.integrity = integrity;
      script.crossOrigin = 'anonymous';
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      script.remove();
      loaded.delete(src);
      reject(new Error(`Timed out loading ${src} after ${timeoutMs}ms. Check the network connection or any content blocker.`));
    }, timeoutMs);

    script.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.remove();
      loaded.delete(src);
      reject(new Error(`Failed to load ${src}. It may be blocked by a firewall, extension or content policy.`));
    };

    document.head.appendChild(script);
  });

  loaded.set(src, promise);
  return promise;
}

export default loadScript;
