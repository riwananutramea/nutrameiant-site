/**
 * Turns notes and transcripts into files worth sending to someone.
 *
 * Pure string builders — no DOM, no I/O — so every format is directly testable.
 */

import { formatDuration, formatVttTime } from '../core/util.js';

function heading(notes) {
  const when = notes.startedAt ? new Date(notes.startedAt).toLocaleString() : 'Unknown date';
  const lines = [
    `# ${notes.title || 'Meeting notes'}`,
    '',
    `**Date:** ${when}  `,
    `**Duration:** ${formatDuration(notes.durationMs || 0)}  `,
  ];
  if (notes.speakers?.length) {
    lines.push(`**Participants:** ${notes.speakers.map((s) => s.speaker).join(', ')}  `);
  }
  lines.push('');
  return lines;
}

/** Markdown — the format that pastes cleanly into email, Notion or a doc. */
export function notesToMarkdown(notes) {
  const out = heading(notes);

  if (notes.summary?.length) {
    out.push('## Summary', '');
    for (const item of notes.summary) out.push(`- ${item.text}`);
    out.push('');
  }

  if (notes.decisions?.length) {
    out.push('## Decisions', '');
    for (const item of notes.decisions) {
      out.push(`- ${item.text} _(${item.speaker}, ${formatDuration(item.t0)})_`);
    }
    out.push('');
  }

  if (notes.actions?.length) {
    out.push('## Action items', '');
    for (const item of notes.actions) {
      const due = item.due ? ` — **due ${item.due}**` : '';
      // Checkboxes so the list is usable as-is in a task tool.
      out.push(`- [ ] **${item.owner}:** ${item.text}${due} _(${formatDuration(item.t0)})_`);
    }
    out.push('');
  }

  if (notes.questions?.length) {
    out.push('## Open questions', '');
    for (const item of notes.questions) out.push(`- ${item.text} _(${item.speaker})_`);
    out.push('');
  }

  if (notes.risks?.length) {
    out.push('## Risks and blockers', '');
    for (const item of notes.risks) out.push(`- ${item.text} _(${item.speaker})_`);
    out.push('');
  }

  if (notes.chapters?.length > 1) {
    out.push('## Timeline', '');
    for (const chapter of notes.chapters) {
      out.push(`- \`${formatDuration(chapter.t0)}\` ${chapter.title}`);
    }
    out.push('');
  }

  if (notes.speakers?.length > 1) {
    out.push('## Speaking share', '');
    for (const speaker of notes.speakers) {
      out.push(`- ${speaker.speaker}: ${speaker.sharePct}%`);
    }
    out.push('');
  }

  if (notes.keywords?.length) {
    out.push('## Key topics', '', notes.keywords.map((k) => k.term).join(' · '), '');
  }

  out.push('---', '', '_Notes generated automatically by NutraMEA Intelligence. Review before circulating._');
  return out.join('\n');
}

/** Plain-text transcript with timestamps and speakers. */
export function transcriptToText(segments, { title = 'Transcript' } = {}) {
  const lines = [title, '='.repeat(title.length), ''];
  for (const segment of segments) {
    lines.push(`[${formatDuration(segment.t0)}] ${segment.speaker}: ${segment.text}`);
  }
  return lines.join('\n');
}

/**
 * WebVTT subtitles. Dropping this next to the recording makes the video
 * searchable and accessible in any player that reads sidecar tracks.
 */
export function transcriptToVtt(segments) {
  const lines = ['WEBVTT', ''];
  segments.forEach((segment, index) => {
    const start = segment.t0 ?? 0;
    // Never emit a zero-length or inverted cue: players reject the whole file.
    const end = Math.max(segment.t1 ?? start, start + 1200);
    lines.push(String(index + 1));
    lines.push(`${formatVttTime(start)} --> ${formatVttTime(end)}`);
    lines.push(`<v ${escapeVtt(segment.speaker || 'Speaker')}>${escapeVtt(segment.text)}`);
    lines.push('');
  });
  return lines.join('\n');
}

function escapeVtt(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Machine-readable bundle for downstream automation. */
export function bundleToJson(notes, segments) {
  return JSON.stringify({
    schema: 'nutramea.meeting-notes/1',
    notes,
    transcript: segments,
  }, null, 2);
}

/** Filename stem shared by every artefact of one meeting, so they sort together. */
export function exportBaseName(title, startedAt) {
  const date = startedAt ? new Date(startedAt) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const slug = String(title || 'meeting')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'meeting';
  return `nutramea-${slug}-${stamp}`;
}
