import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseText, splitSentences, tokenize, extractCues, summarise,
  topKeywords, inferOwner, buildNotes, jaccard, buildChapters, speakerStats,
} from '../site/meet/assets/js/ai/notes.js';

const meeting = [
  { id: 1, speaker: 'Riwana', t0: 0, t1: 9000, text: 'Thanks for joining. Today we need to lock the distributor agreement for the Saudi launch.' },
  { id: 2, speaker: 'Sara', t0: 9000, t1: 20000, text: "Um, so the SFDA registration dossier is the blocker. It won't be ready before the end of month." },
  { id: 3, speaker: 'Riwana', t0: 20000, t1: 31000, text: "Okay. I'll send the revised dossier to the regulatory consultant by Monday." },
  { id: 4, speaker: 'Sara', t0: 31000, t1: 42000, text: 'What is the budget ceiling for the consultant?' },
  { id: 5, speaker: 'Riwana', t0: 42000, t1: 55000, text: 'We decided to cap it at twelve thousand dollars for the first phase.' },
  { id: 6, speaker: 'Sara', t0: 55000, t1: 70000, text: 'Sara will prepare the distributor shortlist and circulate it before Friday.' },
];

test('normaliseText removes filler and the punctuation it leaves behind', () => {
  assert.equal(normaliseText('Um, so we ship Friday.'), 'so we ship Friday.');
  assert.equal(normaliseText('Well, uh, you know, it works'), 'Well, it works');
  assert.equal(normaliseText('   spaced   out   '), 'spaced out');
  assert.equal(normaliseText(null), '');
});

test('splitSentences keeps abbreviations intact and restores capitalisation', () => {
  assert.deepEqual(
    splitSentences('Dr. Haddad approved it. We ship Monday.'),
    ['Dr. Haddad approved it.', 'We ship Monday.'],
  );
  // The leading filler word is gone, but the sentence still reads properly.
  assert.deepEqual(splitSentences('Um, so the dossier is late.'), ['So the dossier is late.']);
});

test('tokenize drops stopwords, short tokens and bare numbers', () => {
  const tokens = tokenize('The dossier is 12 ready for the regulator');
  assert.ok(tokens.includes('dossier'));
  assert.ok(tokens.includes('regulator'));
  assert.ok(!tokens.includes('the'));
  assert.ok(!tokens.includes('is'));
  assert.ok(!tokens.includes('12'));
});

test('action items are extracted with owner and due date', () => {
  const { actions } = extractCues(meeting);
  const send = actions.find((a) => a.text.includes('send the revised dossier'));
  assert.ok(send, 'expected the dossier action to be found');
  // "I'll" belongs to whoever said it.
  assert.equal(send.owner, 'Riwana');
  assert.equal(send.due, 'monday');

  const shortlist = actions.find((a) => a.text.includes('shortlist'));
  // Named owner wins over the speaker.
  assert.equal(shortlist.owner, 'Sara');
  assert.equal(shortlist.due, 'friday');
});

test('decisions are classified as decisions and not duplicated as actions', () => {
  const { decisions, actions } = extractCues(meeting);
  assert.equal(decisions.length, 1);
  assert.match(decisions[0].text, /cap it at twelve thousand/);
  assert.ok(!actions.some((a) => a.text.includes('cap it at twelve thousand')));
});

test('questions and risks are separated from actions', () => {
  const { questions, risks } = extractCues(meeting);
  assert.equal(questions.length, 1);
  assert.match(questions[0].text, /budget ceiling/);
  assert.ok(risks.some((r) => /blocker/.test(r.text)));
});

test('inferOwner falls back sensibly', () => {
  assert.equal(inferOwner("I'll do it", 'Riwana', ['Riwana', 'Sara']), 'Riwana');
  assert.equal(inferOwner("Let's do it", 'Riwana', []), 'Team');
  assert.equal(inferOwner('You should do it', 'Riwana', []), 'Other participant');
  assert.equal(inferOwner('It happened', 'Riwana', []), 'Riwana');
});

test('summarise is bounded, ordered and free of near-duplicates', () => {
  const summary = summarise(meeting, { maxSentences: 3 });
  assert.ok(summary.length <= 3);
  const orders = summary.map((s) => s.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), 'summary must stay in spoken order');

  const repetitive = [
    { speaker: 'A', t0: 0, t1: 1, text: 'The dossier must go to the regulator this week.' },
    { speaker: 'B', t0: 1, t1: 2, text: 'The dossier must go to the regulator this week.' },
  ];
  assert.equal(summarise(repetitive, { maxSentences: 5 }).length, 1);
});

test('summarise is deterministic across runs', () => {
  const a = summarise(meeting, { maxSentences: 4 }).map((s) => s.sentence);
  const b = summarise(meeting, { maxSentences: 4 }).map((s) => s.sentence);
  assert.deepEqual(a, b);
});

test('jaccard measures overlap', () => {
  assert.equal(jaccard([], ['a']), 0);
  assert.equal(jaccard(['a', 'b'], ['a', 'b']), 1);
  assert.equal(jaccard(['a', 'b'], ['b', 'c']), 1 / 3);
});

test('topKeywords surfaces distinctive vocabulary', () => {
  const terms = topKeywords(meeting, 6).map((k) => k.term);
  assert.ok(terms.includes('dossier'));
  assert.ok(!terms.includes('the'));
});

test('speakerStats shares sum to roughly 100%', () => {
  const stats = speakerStats(meeting);
  assert.equal(stats.length, 2);
  const total = stats.reduce((sum, s) => sum + s.sharePct, 0);
  assert.ok(Math.abs(total - 100) <= 2, `expected ~100, got ${total}`);
});

test('buildChapters stays bounded for a long meeting', () => {
  const long = Array.from({ length: 400 }, (_, i) => ({
    speaker: 'A',
    t0: i * 30000,
    t1: i * 30000 + 25000,
    text: `We discussed topic ${i % 7} and the supply chain implications in detail.`,
  }));
  const chapters = buildChapters(long, { maxChapters: 12 });
  assert.ok(chapters.length <= 12, `expected at most 12 chapters, got ${chapters.length}`);
  assert.ok(chapters.every((c) => typeof c.title === 'string' && c.title.length > 0));
});

test('buildNotes tolerates an empty or blank transcript', () => {
  for (const input of [[], null, [{ speaker: 'A', t0: 0, t1: 1, text: '   ' }]]) {
    const notes = buildNotes(input, { title: 'Empty' });
    assert.equal(notes.segmentCount, 0);
    assert.deepEqual(notes.summary, []);
    assert.deepEqual(notes.actions, []);
    assert.deepEqual(notes.chapters, []);
  }
});

test('buildNotes produces the full structure', () => {
  const notes = buildNotes(meeting, { title: 'Distributor sync', startedAt: 1_700_000_000_000, durationMs: 70000 });
  assert.equal(notes.title, 'Distributor sync');
  assert.equal(notes.segmentCount, 6);
  assert.ok(notes.summary.length > 0);
  assert.ok(notes.actions.length >= 2);
  assert.equal(notes.decisions.length, 1);
  assert.ok(notes.keywords.length > 0);
  assert.ok(notes.speakers.length === 2);
});
