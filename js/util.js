// Small shared helpers.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sample(arr, n) { return shuffle(arr).slice(0, n); }

export function todayKey(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

// --- Answer checking -------------------------------------------------------

const APOS = /[’‘`´]/g;

// Lowercase, unify apostrophes, collapse spaces, drop end punctuation.
export function tidy(s) {
  return String(s ?? '')
    .replace(APOS, "'")
    .replace(/ /g, ' ')
    .toLowerCase()
    .replace(/\s*'\s*/g, "'")
    .replace(/[.!?;:,«»"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae');
}

// Returns 'ok' | 'accent' | 'typo' | 'wrong' with the best matching answer.
export function checkAnswer(given, answers) {
  const g = tidy(given);
  if (!g) return { result: 'wrong', best: answers[0] };
  let best = answers[0], bestDist = Infinity;
  for (const a of answers) {
    const t = tidy(a);
    if (g === t) return { result: 'ok', best: a };
    if (stripAccents(g) === stripAccents(t)) return { result: 'accent', best: a };
    const d = levenshtein(stripAccents(g), stripAccents(t));
    if (d < bestDist) { bestDist = d; best = a; }
  }
  const len = tidy(best).length;
  if (bestDist === 1 && len >= 6) return { result: 'typo', best };
  return { result: 'wrong', best };
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i), cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// Word-level diff for dictation. Returns HTML.
export function wordDiff(given, target) {
  const gw = tidy(given).split(' ').filter(Boolean);
  const tw = String(target).replace(APOS, "'").split(/\s+/).filter(Boolean);
  const tn = tw.map(w => tidy(w));
  // LCS on accent-stripped tokens
  const A = gw.map(stripAccents), B = tn.map(stripAccents);
  const eq = (x, y) => x === y || (y.length > 4 && levenshtein(x, y) <= 1);
  const dp = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--)
    dp[i][j] = eq(A[i], B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0; const out = []; let right = 0, accentSlips = 0;
  while (i < A.length && j < B.length) {
    if (eq(A[i], B[j])) {
      if (gw[i] === tn[j]) { out.push(`<span class="ok">${esc(tw[j])}</span>`); right++; }
      else { out.push(`<span class="acc" title="spelling or accent">${esc(tw[j])}</span>`); accentSlips++; right += .5; }
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(`<span class="miss">${esc(gw[i])}</span>`); i++; }
    else { out.push(`<span class="fix">${esc(tw[j])}</span>`); j++; }
  }
  while (i < A.length) out.push(`<span class="miss">${esc(gw[i++])}</span>`);
  while (j < B.length) out.push(`<span class="fix">${esc(tw[j++])}</span>`);
  return { html: out.join(' '), score: B.length ? right / B.length : 0, accentSlips };
}

// Similarity 0..1 between two French strings (for speaking checks).
export function similarity(a, b) {
  const A = stripAccents(tidy(a)).split(' ').filter(Boolean);
  const B = stripAccents(tidy(b)).split(' ').filter(Boolean);
  if (!B.length) return 0;
  const used = new Array(A.length).fill(false);
  let hit = 0;
  for (const w of B) {
    const k = A.findIndex((x, idx) => !used[idx] && (x === w || (w.length > 4 && levenshtein(x, w) <= 1)));
    if (k >= 0) { used[k] = true; hit++; }
  }
  return hit / Math.max(B.length, A.length * 0.85);
}

export function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

// Minimal markdown-ish formatter for grammar notes: **bold**, *italic*, line breaks.
export function md(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

export function fmtMinutes(m) {
  m = Math.round(m);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
