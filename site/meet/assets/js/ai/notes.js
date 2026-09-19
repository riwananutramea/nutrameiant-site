/**
 * The note-taking engine: transcript in, structured meeting notes out.
 *
 * Everything here is pure, deterministic and dependency-free. That is a
 * deliberate choice:
 *   - It runs with no API key and no per-call cost, so notes stay free.
 *   - Meeting content never leaves the browser, which matters for commercial
 *     conversations with suppliers and partners.
 *   - Deterministic output can be unit-tested, unlike a model call.
 *
 * A segment is `{ id, speaker, text, t0, t1 }` with `t0`/`t1` in milliseconds
 * from the start of the meeting.
 */

/** Words carrying no topical signal. Kept tight — over-filtering loses meaning. */
export const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'cannot', 'could', 'did', 'do', 'does', 'doing', 'done', 'down', 'during',
  'each', 'few', 'for', 'from', 'further', 'get', 'got', 'had', 'has', 'have', 'having',
  'he', 'her', 'here', 'hers', 'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its',
  'just', 'like', 'me', 'more', 'most', 'my', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once',
  'only', 'or', 'other', 'ought', 'our', 'ours', 'out', 'over', 'own',
  'really', 'said', 'same', 'say', 'see', 'she', 'should', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'theirs', 'them', 'then', 'there', 'these', 'they', 'thing',
  'things', 'think', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'us',
  'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why',
  'will', 'with', 'would', 'yeah', 'yes', 'you', 'your', 'yours',
  'okay', 'ok', 'right', 'well', 'sure', 'actually', 'basically', 'maybe', 'kind', 'sort',
  'gonna', 'wanna', 'going', 'know', 'mean', 'let', 'lets',
]);

/** Filler that adds nothing to a written record. */
const FILLER = /\b(?:um+|uh+|erm+|hmm+|mm+|you know|i mean|sort of|kind of)\b/gi;

export function normaliseText(text) {
  return String(text ?? '')
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    // Removing filler strips the words but leaves their punctuation behind:
    // "Um, so the dossier..." would otherwise survive as ", so the dossier...".
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/^[\s,;:.!?-]+/, '')
    .trim();
}

/** Restores the leading capital lost when an opening filler word is removed. */
function capitaliseFirst(sentence) {
  if (!sentence) return sentence;
  const first = sentence[0];
  return first === first.toUpperCase() ? sentence : first.toUpperCase() + sentence.slice(1);
}

/** Splits on sentence terminators while keeping common abbreviations intact. */
export function splitSentences(text) {
  const clean = normaliseText(text);
  if (!clean) return [];
  const protectedText = clean
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e|No)\./gi, '$1<DOT>')
    .replace(/\b([A-Z])\./g, '$1<DOT>');
  return protectedText
    .split(/(?<=[.!?])\s+/)
    .map((s) => capitaliseFirst(s.replace(/<DOT>/g, '.').trim()))
    .filter((s) => s.length > 0);
}

export function tokenize(text) {
  return normaliseText(text)
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ\s'-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^[-']+|[-']+$/g, ''))
    .filter((token) => token.length > 2 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
}

/**
 * TF-IDF over segments, treating each segment as a document.
 *
 * Plain term frequency would rank whatever the meeting is about most highly —
 * which is exactly the word everyone already knows. The IDF term surfaces the
 * distinctive vocabulary instead.
 */
export function keywordScores(segments) {
  const docs = segments.map((segment) => new Set(tokenize(segment.text)));
  const docCount = Math.max(1, docs.length);
  const termFreq = new Map();
  const docFreq = new Map();

  for (const segment of segments) {
    for (const token of tokenize(segment.text)) {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    }
  }
  for (const doc of docs) {
    for (const token of doc) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }

  const scores = new Map();
  for (const [term, tf] of termFreq) {
    const df = docFreq.get(term) || 1;
    // Smoothed IDF; +1 keeps a term appearing in every segment from scoring 0.
    const idf = Math.log(1 + docCount / df);
    scores.set(term, tf * idf);
  }
  return scores;
}

export function topKeywords(segments, limit = 12) {
  const scores = keywordScores(segments);
  return Array.from(scores.entries())
    // Alphabetical tiebreak keeps the output deterministic.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, score]) => ({ term, score: Number(score.toFixed(4)) }));
}

/* ------------------------------------------------------------------ cues */

const ACTION_PATTERNS = [
  /\b(?:action item|action point|takeaway|to-?do)\b\s*:?/i,
  /\b(?:i|we|you|they)\s+(?:will|'ll|shall)\s+\w+/i,
  /\b(?:let'?s|lets)\s+\w+/i,
  /\b(?:need|needs|needed)\s+to\s+\w+/i,
  /\b(?:have|has)\s+to\s+\w+/i,
  /\b(?:should|must)\s+\w+/i,
  /\bfollow[\s-]?up\b/i,
  /\b(?:send|share|prepare|draft|review|check|confirm|schedule|book|circulate)\s+(?:the|a|an|it|them|over)\b/i,
];

const DECISION_PATTERNS = [
  /\b(?:we|it was|it's|its)\s+(?:have\s+)?(?:decided|agreed|settled)\b/i,
  /\bdecision\b\s*:?/i,
  /\bwe(?:'re| are)\s+going\s+with\b/i,
  /\b(?:let'?s|lets)\s+go\s+with\b/i,
  /\bagreed\s+(?:to|on|that)\b/i,
  /\bwe'?ll\s+(?:go|stick)\s+with\b/i,
  /\bfinal(?:ise|ize)d?\s+on\b/i,
];

const RISK_PATTERNS = [
  /\b(?:risk|blocker|blocked|concern|issue|problem|delay|bottleneck)\b/i,
  /\bworried\s+about\b/i,
  /\bwon'?t\s+(?:work|be\s+ready)\b/i,
];

const DUE_PATTERN = /\b(?:by|before|on|due)\s+((?:next\s+|this\s+|end\s+of\s+(?:the\s+)?)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|week|month|quarter|year|q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{1,2}(?:st|nd|rd|th)?)?|\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)/i;

function matchesAny(patterns, sentence) {
  return patterns.some((pattern) => pattern.test(sentence));
}

/**
 * Guesses who owns an action.
 *
 * "I'll send it" in a segment spoken by Riwana belongs to Riwana; "Sara will
 * send it" belongs to Sara regardless of who said it.
 */
export function inferOwner(sentence, speaker, knownSpeakers = []) {
  const named = knownSpeakers.find((name) => {
    if (!name) return false;
    const first = String(name).split(/\s+/)[0];
    if (first.length < 2) return false;
    return new RegExp(`\\b${escapeRegExp(first)}\\b\\s+(?:will|'ll|is going to|to)\\b`, 'i').test(sentence);
  });
  if (named) return named;
  if (/\b(?:i|i'?ll|i will)\b/i.test(sentence)) return speaker || 'Unassigned';
  if (/\b(?:we|we'?ll|let'?s|lets)\b/i.test(sentence)) return 'Team';
  if (/\byou\b/i.test(sentence)) return 'Other participant';
  return speaker || 'Unassigned';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Sentence-level scan producing action items, decisions, questions and risks. */
export function extractCues(segments) {
  const speakers = Array.from(new Set(segments.map((s) => s.speaker).filter(Boolean)));
  const actions = [];
  const decisions = [];
  const questions = [];
  const risks = [];
  const seen = new Set();

  for (const segment of segments) {
    for (const sentence of splitSentences(segment.text)) {
      // Drop pure acknowledgements ("Yes.", "Sure thing.", "Okay.") — after
      // stopword removal these leave nothing behind. The threshold is 2 rather
      // than 3 because real questions are often short once stopwords are gone:
      // "What is the shipping timeline?" reduces to just shipping + timeline.
      if (tokenize(sentence).length < 2) continue;
      const key = sentence.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const base = { text: sentence, speaker: segment.speaker || 'Unknown', t0: segment.t0 };

      if (matchesAny(DECISION_PATTERNS, sentence)) {
        decisions.push(base);
        // A decision is not also an action; classifying once keeps notes clean.
        continue;
      }
      if (matchesAny(ACTION_PATTERNS, sentence)) {
        const due = sentence.match(DUE_PATTERN);
        actions.push({
          ...base,
          owner: inferOwner(sentence, segment.speaker, speakers),
          due: due ? due[1].toLowerCase() : null,
        });
        continue;
      }
      if (sentence.endsWith('?')) {
        questions.push(base);
        continue;
      }
      if (matchesAny(RISK_PATTERNS, sentence)) risks.push(base);
    }
  }
  return { actions, decisions, questions, risks };
}

/* --------------------------------------------------------------- summary */

/**
 * Extractive summary.
 *
 * Sentences are scored on keyword density, normalised by length so a rambling
 * sentence cannot win on volume alone, then returned in the order they were
 * spoken so the summary reads as a narrative.
 */
export function summarise(segments, { maxSentences = 6 } = {}) {
  const scores = keywordScores(segments);
  const candidates = [];
  let index = 0;

  for (const segment of segments) {
    for (const sentence of splitSentences(segment.text)) {
      const tokens = tokenize(sentence);
      if (tokens.length < 4) continue;
      let score = tokens.reduce((sum, token) => sum + (scores.get(token) || 0), 0);
      // Length normalisation. sqrt rather than a plain mean keeps some
      // preference for substantive sentences over three-word fragments.
      score /= Math.sqrt(tokens.length);
      // Sentences that decide or commit are what a reader actually wants.
      if (matchesAny(DECISION_PATTERNS, sentence)) score *= 1.6;
      else if (matchesAny(ACTION_PATTERNS, sentence)) score *= 1.3;
      candidates.push({ sentence, score, order: index, speaker: segment.speaker, t0: segment.t0 });
      index += 1;
    }
  }

  if (candidates.length === 0) return [];

  const chosen = [];
  const ranked = candidates.slice().sort((a, b) => b.score - a.score || a.order - b.order);
  for (const candidate of ranked) {
    if (chosen.length >= maxSentences) break;
    // Drop near-duplicates: spoken language repeats the same point often.
    if (chosen.some((picked) => jaccard(tokenize(picked.sentence), tokenize(candidate.sentence)) > 0.6)) continue;
    chosen.push(candidate);
  }
  return chosen.sort((a, b) => a.order - b.order);
}

/** Set overlap, used for de-duplication. */
export function jaccard(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/* -------------------------------------------------------------- chapters */

/** Buckets the meeting into time windows, each titled by its own vocabulary. */
export function buildChapters(segments, { windowMs = 5 * 60 * 1000, maxChapters = 12 } = {}) {
  if (segments.length === 0) return [];
  const start = segments[0].t0 || 0;
  const end = segments[segments.length - 1].t1 ?? segments[segments.length - 1].t0 ?? start;
  const span = Math.max(1, end - start);
  // Widen the window rather than emit fifty chapters for a long meeting.
  const effectiveWindow = Math.max(windowMs, Math.ceil(span / maxChapters));

  const buckets = new Map();
  for (const segment of segments) {
    const bucket = Math.floor(((segment.t0 || 0) - start) / effectiveWindow);
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(segment);
  }

  const globalScores = keywordScores(segments);
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, bucketSegments]) => {
      const local = keywordScores(bucketSegments);
      const terms = Array.from(local.entries())
        // Favour terms that are prominent locally but not everywhere.
        .map(([term, score]) => [term, score / (1 + (globalScores.get(term) || 0) * 0.25)])
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([term]) => term);
      return {
        index: bucket,
        t0: start + bucket * effectiveWindow,
        title: terms.length ? terms.join(', ') : 'Discussion',
        speakers: Array.from(new Set(bucketSegments.map((s) => s.speaker).filter(Boolean))),
        segmentCount: bucketSegments.length,
      };
    });
}

/* ----------------------------------------------------------------- notes */

export function speakerStats(segments) {
  const byspeaker = new Map();
  for (const segment of segments) {
    const name = segment.speaker || 'Unknown';
    const entry = byspeaker.get(name) || { speaker: name, words: 0, segments: 0, talkMs: 0 };
    entry.words += tokenize(segment.text).length;
    entry.segments += 1;
    entry.talkMs += Math.max(0, (segment.t1 ?? segment.t0) - (segment.t0 ?? 0));
    byspeaker.set(name, entry);
  }
  const totalWords = Array.from(byspeaker.values()).reduce((sum, e) => sum + e.words, 0) || 1;
  return Array.from(byspeaker.values())
    .map((entry) => ({ ...entry, sharePct: Math.round((entry.words / totalWords) * 100) }))
    .sort((a, b) => b.words - a.words);
}

/** Assembles the complete note object rendered in the UI and exported. */
export function buildNotes(segments, options = {}) {
  const {
    title = 'NutraMEA meeting',
    startedAt = null,
    durationMs = 0,
    maxSummarySentences = 6,
  } = options;

  const clean = (segments || []).filter((segment) => normaliseText(segment?.text).length > 0);
  const cues = extractCues(clean);

  return {
    title,
    startedAt,
    durationMs,
    generatedAt: Date.now(),
    segmentCount: clean.length,
    summary: summarise(clean, { maxSentences: maxSummarySentences }).map((item) => ({
      text: item.sentence,
      speaker: item.speaker,
      t0: item.t0,
    })),
    actions: cues.actions,
    decisions: cues.decisions,
    questions: cues.questions,
    risks: cues.risks,
    keywords: topKeywords(clean, 12),
    chapters: buildChapters(clean),
    speakers: speakerStats(clean),
  };
}

export default buildNotes;
