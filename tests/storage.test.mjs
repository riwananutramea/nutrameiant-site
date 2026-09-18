import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contentRange, parseResumeOffset, normaliseChunkSize, isRetryableStatus,
  isConfigured, CHUNK_GRANULARITY,
} from '../site/meet/assets/js/storage/drive.js';
import { resolveBlob } from '../site/meet/assets/js/storage/delivery.js';
import {
  notesToMarkdown, transcriptToText, transcriptToVtt, bundleToJson, exportBaseName,
} from '../site/meet/assets/js/ai/exporters.js';
import { buildNotes } from '../site/meet/assets/js/ai/notes.js';

/* ------------------------------------------------------------------ drive */

test('contentRange uses an inclusive end offset', () => {
  // Drive expects the LAST byte index, not the exclusive end.
  assert.equal(contentRange(0, 262144, 1048576), 'bytes 0-262143/1048576');
  assert.equal(contentRange(262144, 524288, 1048576), 'bytes 262144-524287/1048576');
  // Final chunk.
  assert.equal(contentRange(1000000, 1048576, 1048576), 'bytes 1000000-1048575/1048576');
});

test('parseResumeOffset returns the next byte to send', () => {
  // "bytes 0-262143 stored" means resume at 262144.
  assert.equal(parseResumeOffset('bytes=0-262143'), 262144);
  assert.equal(parseResumeOffset('bytes=0-0'), 1);
  // A missing header means nothing was stored.
  assert.equal(parseResumeOffset(null), 0);
  assert.equal(parseResumeOffset(''), 0);
  assert.equal(parseResumeOffset('garbage'), 0);
});

test('normaliseChunkSize keeps chunks a multiple of 256 KiB', () => {
  assert.equal(normaliseChunkSize(8 * 1024 * 1024) % CHUNK_GRANULARITY, 0);
  assert.equal(normaliseChunkSize(300000) % CHUNK_GRANULARITY, 0);
  // Never below one granule, however small a value is configured.
  assert.equal(normaliseChunkSize(1), CHUNK_GRANULARITY);
  assert.equal(normaliseChunkSize(100), CHUNK_GRANULARITY);
  // 0 / absent / nonsense mean "unset", so the 8 MiB default applies.
  assert.equal(normaliseChunkSize(0), 8 * 1024 * 1024);
  assert.equal(normaliseChunkSize(undefined), 8 * 1024 * 1024);
  assert.equal(normaliseChunkSize('abc'), 8 * 1024 * 1024);
});

test('a full chunk sequence covers the file exactly with no gaps', () => {
  const total = 5 * 1024 * 1024 + 7777;
  const chunk = normaliseChunkSize(1024 * 1024);
  const ranges = [];
  for (let offset = 0; offset < total; offset += chunk) {
    ranges.push([offset, Math.min(offset + chunk, total)]);
  }
  assert.equal(ranges[0][0], 0);
  assert.equal(ranges.at(-1)[1], total, 'the last chunk must end exactly at the file size');
  for (let i = 1; i < ranges.length; i += 1) {
    assert.equal(ranges[i][0], ranges[i - 1][1], 'chunks must be contiguous');
  }
});

test('isRetryableStatus retries throttling and server faults only', () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(401), false);
  assert.equal(isRetryableStatus(404), false);
});

test('Drive stays hidden until a client ID is configured', () => {
  assert.equal(isConfigured({ storage: { googleClientId: '' } }), false);
  assert.equal(isConfigured({}), false);
  assert.equal(isConfigured({ storage: { googleClientId: 'abc.apps.googleusercontent.com' } }), true);
});

/* --------------------------------------------------------------- delivery */

test('resolveBlob prefers an in-memory blob and can reopen a file handle', async () => {
  assert.equal(await resolveBlob(null), null);
  const blob = { size: 10 };
  assert.equal(await resolveBlob({ blob }), blob);

  const file = { size: 99 };
  assert.equal(await resolveBlob({ fileHandle: { getFile: async () => file } }), file);
  // Nothing to resolve.
  assert.equal(await resolveBlob({ kind: 'file' }), null);
});

test('resolveBlob reports a handle that cannot be reopened', async () => {
  await assert.rejects(
    resolveBlob({ fileHandle: { getFile: async () => { throw new Error('gone'); } } }),
    /could not be reopened/,
  );
});

/* -------------------------------------------------------------- exporters */

const segments = [
  { id: 's1', speaker: 'Riwana', t0: 0, t1: 6000, text: "I'll send the dossier by Monday." },
  { id: 's2', speaker: 'Sara', t0: 6000, t1: 12000, text: 'We decided to cap the budget at twelve thousand.' },
  { id: 's3', speaker: 'Sara', t0: 12000, t1: 18000, text: 'What is the shipping timeline?' },
];
const notes = buildNotes(segments, { title: 'Sync', startedAt: 1_700_000_000_000, durationMs: 18000 });

test('markdown export contains every populated section', () => {
  const md = notesToMarkdown(notes);
  assert.match(md, /^# Sync/m);
  assert.match(md, /\*\*Duration:\*\* 00:18/);
  assert.match(md, /## Action items/);
  assert.match(md, /- \[ \] \*\*Riwana:\*\*/, 'actions should be checkboxes with an owner');
  assert.match(md, /## Decisions/);
  assert.match(md, /## Open questions/);
  assert.match(md, /Review before circulating/);
});

test('markdown export omits empty sections', () => {
  const empty = buildNotes([], { title: 'Nothing' });
  const md = notesToMarkdown(empty);
  assert.doesNotMatch(md, /## Action items/);
  assert.doesNotMatch(md, /## Decisions/);
  assert.match(md, /^# Nothing/m);
});

test('transcript text export is timestamped and attributed', () => {
  const text = transcriptToText(segments, { title: 'Sync' });
  assert.match(text, /\[00:00\] Riwana: I'll send the dossier by Monday\./);
  assert.match(text, /\[00:12\] Sara: What is the shipping timeline\?/);
});

test('VTT export is structurally valid', () => {
  const vtt = transcriptToVtt(segments);
  const lines = vtt.split('\n');
  assert.equal(lines[0], 'WEBVTT');
  assert.match(vtt, /00:00:00\.000 --> 00:00:06\.000/);
  assert.match(vtt, /<v Riwana>/);
  // Every cue must advance in time; a zero-length cue invalidates the file.
  const cues = [...vtt.matchAll(/(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/g)];
  assert.equal(cues.length, segments.length);
  for (const [, start, end] of cues) assert.ok(end > start, `cue ${start} must end after it starts`);
});

test('VTT gives a minimum duration to an instantaneous segment', () => {
  const vtt = transcriptToVtt([{ speaker: 'A', t0: 5000, t1: 5000, text: 'Yes.' }]);
  assert.match(vtt, /00:00:05\.000 --> 00:00:06\.200/);
});

test('VTT escapes markup in speech and speaker names', () => {
  const vtt = transcriptToVtt([{ speaker: '<script>', t0: 0, t1: 2000, text: 'a < b && c > d' }]);
  assert.ok(!vtt.includes('<script>'), 'speaker names must be escaped');
  assert.match(vtt, /&lt;script&gt;/);
  assert.match(vtt, /a &lt; b &amp;&amp; c &gt; d/);
});

test('JSON bundle is parseable and carries a schema marker', () => {
  const parsed = JSON.parse(bundleToJson(notes, segments));
  assert.equal(parsed.schema, 'nutramea.meeting-notes/1');
  assert.equal(parsed.transcript.length, 3);
  assert.equal(parsed.notes.title, 'Sync');
});

test('exportBaseName is filesystem-safe and date-stamped', () => {
  const name = exportBaseName('Board Sync / Q4!', new Date('2026-09-18T10:00:00Z'));
  assert.match(name, /^nutramea-board-sync-q4-2026-09-18$/);
  assert.match(exportBaseName('', new Date('2026-01-05T00:00:00Z')), /^nutramea-meeting-2026-01-05$/);
  assert.ok(!/[^a-z0-9-]/.test(exportBaseName('Ünïcodé ✨', new Date('2026-01-05T00:00:00Z'))));
});
