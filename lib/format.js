// ─── Shared text formatting utilities ────────────────────────────────────────
// Platform-agnostic. No ctx / bot references here.
// Telegram-specific sending lives in platforms/telegram/context.js.

const TG_HARD_LIMIT = 4096;
const SAFE_CHUNK = 3800;
const PRE_CLOSE = '</code></pre>';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Convert a Markdown string to Telegram-compatible HTML. */
function toHtml(raw) {
  if (!raw) return '';
  const text = String(raw);
  const fencePattern = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = fencePattern.exec(text)) !== null) {
    out += renderInline(text.slice(last, m.index));
    const lang = m[1] ? ` class="language-${escapeHtml(m[1])}"` : '';
    out += `<pre><code${lang}>${escapeHtml(m[2])}</code></pre>`;
    last = m.index + m[0].length;
  }
  out += renderInline(text.slice(last));
  return out;
}

function renderInline(segment) {
  let s = escapeHtml(segment);
  s = s.replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, (_, b) => `<b>${b}</b>`);
  s = s.replace(/__([^_\n]+)__/g, (_, b) => `<b>${b}</b>`);
  s = s.replace(/_([^_\n]+)_/g, (_, i) => `<i>${i}</i>`);
  return s;
}

function splitIntoSafeSegments(html) {
  const segments = [];
  let i = 0;
  while (i < html.length) {
    const preStart = html.indexOf('<pre>', i);
    if (preStart === -1) {
      if (i < html.length) segments.push({ type: 'text', body: html.slice(i) });
      break;
    }
    if (preStart > i) segments.push({ type: 'text', body: html.slice(i, preStart) });
    const preEnd = html.indexOf('</pre>', preStart);
    if (preEnd === -1) {
      segments.push({ type: 'text', body: html.slice(preStart) });
      break;
    }
    segments.push({ type: 'pre', body: html.slice(preStart, preEnd + 6) });
    i = preEnd + 6;
  }
  return segments;
}

function splitLargePre(seg, size) {
  const codeOpenIdx = seg.body.indexOf('<code');
  const codeOpenEnd = seg.body.indexOf('>', codeOpenIdx) + 1;
  const wrapStart = seg.body.slice(0, codeOpenEnd);
  const inner = seg.body.slice(codeOpenEnd, seg.body.length - PRE_CLOSE.length);
  const frame = wrapStart.length + PRE_CLOSE.length;
  const budget = Math.max(size - frame, 200);

  const pieces = [];
  let buf = '';
  const lines = inner.split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    let line = lines[idx];
    while (line.length > budget) {
      if (buf) { pieces.push(buf); buf = ''; }
      pieces.push(line.slice(0, budget));
      line = line.slice(budget);
    }
    const next = buf ? buf + '\n' + line : line;
    if (next.length > budget && buf) { pieces.push(buf); buf = line; }
    else { buf = next; }
  }
  if (buf) pieces.push(buf);
  return pieces.map((p) => wrapStart + p + PRE_CLOSE);
}

function splitLargeText(body, size) {
  const out = [];
  let i = 0;
  while (i < body.length) {
    let end = Math.min(i + size, body.length);
    if (end < body.length) {
      const nl = body.lastIndexOf('\n', end);
      if (nl > i + size / 2) end = nl;
    }
    out.push(body.slice(i, end));
    i = end;
    while (i < body.length && body[i] === '\n') i++;
  }
  return out;
}

/** Split an HTML string into chunks that respect Telegram's message size limit. */
function chunkHtml(html, size = SAFE_CHUNK) {
  if (html.length <= size) return [html];
  const pieces = [];
  for (const seg of splitIntoSafeSegments(html)) {
    if (seg.body.length <= size) { pieces.push(seg.body); continue; }
    if (seg.type === 'pre') pieces.push(...splitLargePre(seg, size));
    else pieces.push(...splitLargeText(seg.body, size));
  }

  const chunks = [];
  let cur = '';
  for (const piece of pieces) {
    if (!cur) { cur = piece; continue; }
    if (cur.length + piece.length + 1 <= size) { cur += piece; }
    else { chunks.push(cur); cur = piece; }
  }
  if (cur) chunks.push(cur);
  return chunks.filter((p) => p && p.replace(/<[^>]+>/g, '').trim().length);
}

function stripTags(html) {
  return String(html).replace(/<[^>]+>/g, '');
}

function truncate(s, n = 120) {
  const flat = String(s || '').replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat;
}

function formatSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

module.exports = {
  toHtml,
  chunkHtml,
  escapeHtml,
  stripTags,
  truncate,
  formatSize,
};
