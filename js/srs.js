// Spaced repetition scheduler (SM-2 family, tuned for language cards).
import { get, save, bump } from './store.js';

const MIN = 60000, DAY = 86400000;

export function addCard(id) {
  const s = get();
  if (s.cards[id]) return false;
  s.cards[id] = { due: Date.now(), ivl: 0, ease: 2.5, reps: 0, lapses: 0, u: Date.now() };
  return true;
}

// grade: 1 again, 2 hard, 3 good, 4 easy
export function review(id, grade) {
  const s = get();
  const c = s.cards[id] || { due: 0, ivl: 0, ease: 2.5, reps: 0, lapses: 0 };
  const now = Date.now();
  let ivl = c.ivl, ease = c.ease;
  if (grade === 1) {
    c.lapses += c.reps > 0 ? 1 : 0;
    ease = Math.max(1.3, ease - 0.2);
    ivl = 0;
    c.due = now + 10 * MIN;
    c.reps = 0;
  } else {
    if (grade === 2) { ivl = c.reps === 0 ? 1 : Math.max(1, ivl * 1.2); ease = Math.max(1.3, ease - 0.15); }
    if (grade === 3) { ivl = c.reps === 0 ? 1 : c.reps === 1 ? 3 : ivl * ease; }
    if (grade === 4) { ivl = c.reps === 0 ? 3 : c.reps === 1 ? 5 : ivl * ease * 1.3; ease += 0.15; }
    ivl = Math.min(365, ivl * (0.95 + Math.random() * 0.1));
    c.reps += 1;
    c.due = startOfDay(now + ivl * DAY) + 4 * 3600000; // available from 4am on the due day
  }
  c.ivl = ivl; c.ease = ease; c.u = now;
  s.cards[id] = c;
  bump('reviews');
  save('review');
  return c;
}

function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }

export function dueCards(limit = 9999) {
  const now = Date.now();
  return Object.entries(get().cards)
    .filter(([, c]) => c.due <= now)
    .sort((a, b) => a[1].due - b[1].due)
    .slice(0, limit)
    .map(([id]) => id);
}

export function dueCount() { const now = Date.now(); return Object.values(get().cards).filter(c => c.due <= now).length; }

export function nextIntervalLabel(id, grade) {
  const c = get().cards[id] || { ivl: 0, ease: 2.5, reps: 0 };
  if (grade === 1) return '10m';
  let ivl;
  if (grade === 2) ivl = c.reps === 0 ? 1 : Math.max(1, c.ivl * 1.2);
  if (grade === 3) ivl = c.reps === 0 ? 1 : c.reps === 1 ? 3 : c.ivl * c.ease;
  if (grade === 4) ivl = c.reps === 0 ? 3 : c.reps === 1 ? 5 : c.ivl * c.ease * 1.3;
  ivl = Math.round(Math.min(365, ivl));
  return ivl < 30 ? `${ivl}d` : ivl < 365 ? `${Math.round(ivl / 30)}mo` : '1y';
}

export function stats() {
  const cards = Object.values(get().cards);
  const mature = cards.filter(c => c.ivl >= 21).length;
  const learning = cards.filter(c => c.ivl < 21).length;
  return { total: cards.length, mature, learning };
}

// Forecast of due cards for the next n days.
export function forecast(n = 7) {
  const out = new Array(n).fill(0);
  const t0 = startOfDay(Date.now());
  for (const c of Object.values(get().cards)) {
    const d = Math.max(0, Math.floor((c.due - t0) / DAY));
    if (d < n) out[d]++;
  }
  return out;
}
