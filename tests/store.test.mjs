import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Regression tests for the open() guard.
 *
 * `indexedDB.open()` can legitimately never settle — a partitioned frame, or
 * another tab holding an upgrade lock. Unguarded, that hangs application start
 * on a blank page, which is the worst failure mode available: it looks broken
 * and hides its own cause. These lock in that it always resolves or rejects.
 */

/** Minimal request that behaves however the test needs it to. */
function fakeIndexedDB(behaviour) {
  return {
    open() {
      const request = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: { name: 'db' } };
      queueMicrotask(() => behaviour(request));
      return request;
    },
  };
}

async function withIndexedDB(stub, fn) {
  const original = globalThis.indexedDB;
  globalThis.indexedDB = stub;
  // Import fresh each time so module state cannot leak between cases.
  const { openDatabase } = await import(`../site/meet/assets/js/core/store.js?t=${Math.random()}`);
  try {
    return await fn(openDatabase);
  } finally {
    if (original === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = original;
  }
}

test('openDatabase resolves normally', async () => {
  await withIndexedDB(fakeIndexedDB((request) => request.onsuccess?.()), async (openDatabase) => {
    const db = await openDatabase('t', 1, { timeoutMs: 500 });
    assert.equal(db.name, 'db');
  });
});

test('openDatabase rejects rather than hanging when nothing ever settles', async () => {
  // Never calls any callback — the partitioned-storage case.
  await withIndexedDB(fakeIndexedDB(() => {}), async (openDatabase) => {
    const started = Date.now();
    await assert.rejects(
      openDatabase('t', 1, { timeoutMs: 120 }),
      /did not respond/,
    );
    assert.ok(Date.now() - started < 2000, 'must give up promptly, not hang');
  });
});

test('openDatabase reports a blocking tab immediately', async () => {
  await withIndexedDB(fakeIndexedDB((request) => request.onblocked?.()), async (openDatabase) => {
    const started = Date.now();
    await assert.rejects(
      openDatabase('t', 1, { timeoutMs: 5000 }),
      /held open by another tab/,
    );
    // The whole point: it must not wait out the 5s timeout first.
    assert.ok(Date.now() - started < 1000, 'blocked must not wait for the timeout');
  });
});

test('openDatabase surfaces a genuine open error', async () => {
  await withIndexedDB(fakeIndexedDB((request) => {
    request.error = new Error('quota exceeded');
    request.onerror?.();
  }), async (openDatabase) => {
    await assert.rejects(openDatabase('t', 1, { timeoutMs: 500 }), /quota exceeded/);
  });
});

test('openDatabase reports unsupported browsers clearly', async () => {
  await withIndexedDB(undefined, async (openDatabase) => {
    await assert.rejects(openDatabase('t', 1), /IndexedDB is unavailable/);
  });
});
