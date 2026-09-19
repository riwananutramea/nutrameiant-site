import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDuration, formatVttTime, formatBytes, slugifyRoom, randomRoomName,
  estimateRecordingBytes, clamp, retry, debounce,
} from '../site/meet/assets/js/core/util.js';
import { Bus } from '../site/meet/assets/js/core/bus.js';
import { Logger } from '../site/meet/assets/js/core/logger.js';
import { mergeConfig, readQueryOverrides, buildConfig, decodePackedConfig } from '../site/meet/assets/js/config.js';

test('formatDuration switches to hours past 60 minutes', () => {
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(5_000), '00:05');
  assert.equal(formatDuration(65_000), '01:05');
  // The one-hour case this whole build exists to serve.
  assert.equal(formatDuration(3_600_000), '1:00:00');
  assert.equal(formatDuration(3_725_000), '1:02:05');
  assert.equal(formatDuration(-5), '00:00');
  assert.equal(formatDuration('nonsense'), '00:00');
});

test('formatVttTime always emits HH:MM:SS.mmm', () => {
  assert.equal(formatVttTime(0), '00:00:00.000');
  assert.equal(formatVttTime(1234), '00:00:01.234');
  assert.equal(formatVttTime(3_661_007), '01:01:01.007');
});

test('formatBytes is readable at every scale', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(540 * 1024 * 1024), '540 MB');
});

test('slugifyRoom never returns an empty or unsafe room name', () => {
  assert.equal(slugifyRoom('Board Sync!'), 'Board-Sync');
  assert.equal(slugifyRoom('  ??? '), 'room');
  assert.equal(slugifyRoom(''), 'room');
  assert.equal(slugifyRoom(null), 'room');
  // Accents are folded rather than dropped into nothing.
  assert.equal(slugifyRoom('Réunion'), 'Reunion');
  assert.ok(slugifyRoom('x'.repeat(200)).length <= 60);
});

test('randomRoomName is unguessable and avoids ambiguous glyphs', () => {
  const names = new Set(Array.from({ length: 200 }, () => randomRoomName('nutramea')));
  assert.equal(names.size, 200, 'room names must not collide');
  for (const name of names) {
    assert.match(name, /^nutramea-[a-z2-9]{4}-[a-z2-9]{4}$/);
    // 0/O and 1/l/I are excluded so a room can be read aloud.
    assert.ok(!/[01lio]/.test(name.split('-').slice(1).join('')));
  }
});

test('estimateRecordingBytes projects an hour realistically', () => {
  const hour = estimateRecordingBytes(3_600_000, 1_200_000, 128_000);
  const mb = hour / 1024 / 1024;
  assert.ok(mb > 500 && mb < 620, `expected ~575 MB for an hour, got ${mb.toFixed(0)} MB`);
  assert.equal(estimateRecordingBytes(0, 1, 1), 0);
  assert.equal(estimateRecordingBytes(-1000, 1, 1), 0);
});

test('clamp bounds values', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(50, 0, 10), 10);
});

test('retry backs off then succeeds', async () => {
  let attempts = 0;
  const value = await retry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('transient');
    return 'done';
  }, { attempts: 5, baseMs: 1 });
  assert.equal(value, 'done');
  assert.equal(attempts, 3);
});

test('retry stops immediately on a permanent failure', async () => {
  let attempts = 0;
  await assert.rejects(
    retry(async () => {
      attempts += 1;
      const error = new Error('bad request');
      error.status = 400;
      throw error;
    }, { attempts: 5, baseMs: 1, shouldRetry: (error) => error.status !== 400 }),
    /bad request/,
  );
  assert.equal(attempts, 1, 'a 400 must not be retried');
});

test('bus isolates a throwing listener from the rest', () => {
  const seen = [];
  const errors = [];
  const bus = new Bus((error) => errors.push(error.message));
  bus.on('x', () => { throw new Error('boom'); });
  bus.on('x', (payload) => seen.push(payload));
  const delivered = bus.emit('x', 42);

  // The healthy listener still ran — a broken notes panel cannot stop recording.
  assert.deepEqual(seen, [42]);
  assert.deepEqual(errors, ['boom']);
  assert.equal(delivered, 1);
});

test('bus supports unsubscribe and once', () => {
  const bus = new Bus();
  const calls = [];
  const off = bus.on('a', () => calls.push('persistent'));
  bus.once('a', () => calls.push('once'));
  bus.emit('a');
  bus.emit('a');
  off();
  bus.emit('a');
  assert.deepEqual(calls, ['persistent', 'once', 'persistent']);
  assert.equal(bus.listenerCount('a'), 0);
});

test('a listener removing itself mid-dispatch does not skip others', () => {
  const bus = new Bus();
  const calls = [];
  const off = bus.on('a', () => { calls.push('first'); off(); });
  bus.on('a', () => calls.push('second'));
  bus.emit('a');
  assert.deepEqual(calls, ['first', 'second']);
});

test('logger buffers entries and stays bounded', () => {
  const log = new Logger({ scope: 'test', level: 'error' });
  for (let i = 0; i < 700; i += 1) log.debug(`entry ${i}`);
  assert.ok(log.buffer.length <= 500, 'buffer must not grow without limit');
  assert.equal(log.buffer.at(-1).message, 'entry 699');
});

test('logger serialises Errors instead of dropping them', () => {
  const log = new Logger({ scope: 'test', level: 'error' });
  const entry = log.error('failed', new Error('kaboom'));
  assert.equal(entry.data.message, 'kaboom');
  assert.ok(entry.data.stack);
});

test('logger survives circular data', () => {
  const log = new Logger({ scope: 'test', level: 'error' });
  const circular = { name: 'x' };
  circular.self = circular;
  const entry = log.error('circular', circular);
  assert.equal(entry.data.self, '[circular]');
});

test('mergeConfig deep-merges without prototype pollution', () => {
  const base = { a: 1, nested: { x: 1, y: 2 } };
  const merged = mergeConfig(base, { nested: { y: 9, z: 3 } });
  assert.deepEqual(merged.nested, { x: 1, y: 9, z: 3 });
  assert.deepEqual(base.nested, { x: 1, y: 2 }, 'inputs must not be mutated');

  mergeConfig({}, JSON.parse('{"__proto__": {"polluted": true}}'));
  assert.equal({}.polluted, undefined, 'prototype must not be polluted');
});

test('readQueryOverrides coerces and ignores unknown keys', () => {
  const out = readQueryOverrides('?quality=1080&debug=1&room=board&evil=yes');
  assert.equal(out.quality, 1080);
  assert.equal(out.debug, true);
  assert.equal(out.room, 'board');
  assert.equal(out.evil, undefined);
  assert.equal(readQueryOverrides('?quality=abc').quality, undefined);
  assert.equal(readQueryOverrides('?debug=0').debug, false);
});

test('decodePackedConfig round-trips and fails safe', () => {
  const payload = { jitsi: { domain: 'meet.nutrameaint.com' }, brandName: 'NutraMEA' };
  const packed = Buffer.from(JSON.stringify(payload)).toString('base64url');
  assert.deepEqual(decodePackedConfig(packed), payload);
  // Malformed input must never throw during page load.
  assert.equal(decodePackedConfig('!!!!'), null);
  assert.equal(decodePackedConfig(''), null);
  assert.equal(decodePackedConfig(Buffer.from('"just a string"').toString('base64url')), null);
});

test('buildConfig layers defaults, packed config then query string', () => {
  // 8x8.vc is on the trusted transport list; an arbitrary host is rejected,
  // which tests/security.test.mjs covers in full.
  const packed = Buffer.from(JSON.stringify({ quality: 360, jitsi: { domain: '8x8.vc' } })).toString('base64url');
  const config = buildConfig({ search: `?cfg=${packed}&quality=1080&room=board&name=Riwana&audioOnly=1` });
  // The query string wins over packed config, which wins over defaults.
  assert.equal(config.quality, 1080);
  assert.equal(config.jitsi.domain, '8x8.vc');
  assert.equal(config.jitsi.roomPrefix, 'NutraMEAInt');
  assert.deepEqual(config.session, { room: 'board', displayName: 'Riwana', audioOnly: true });
});

test('debounce collapses rapid calls', async () => {
  let calls = 0;
  const fn = debounce(() => { calls += 1; }, 20);
  fn(); fn(); fn();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls, 1);
});
