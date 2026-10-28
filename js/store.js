// Progress state, saved in localStorage and merged with the synced copy.
import { todayKey } from './util.js';

const KEY = 'erb1.state';
const listeners = new Set();

function blank() {
  return {
    v: 1,
    startedAt: Date.now(),
    cards: {},        // cardId -> { due, ivl, ease, reps, lapses, u }
    lessons: {},      // lessonId -> { done: ts, u }
    practice: {},     // practiceId -> { last: ts, best, u }
    civics: {},       // questionId -> { r, w, u }
    mocks: [],        // [{ at, score, total }]
    writing: {},      // writingId -> { text, at, u }
    log: {},          // YYYY-MM-DD -> { sec, reviews, lessons, practice, civics }
    settings: { goal: 45, voice: '', rate: 1, theme: 'auto', newPerLesson: true, u: 0 },
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...blank(), ...JSON.parse(raw) };
  } catch { /* storage unavailable or corrupt */ }
  return blank();
}

let saveTimer;
export function save(reason = 'change') {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota or private mode */ }
  }, 50);
  listeners.forEach(fn => fn(reason));
}

export function flush() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { }
}

export const get = () => state;
export const onChange = fn => (listeners.add(fn), () => listeners.delete(fn));

export function replace(next) { state = { ...blank(), ...next }; flush(); listeners.forEach(fn => fn('replace')); }

export function dayLog(key = todayKey()) {
  if (!state.log[key]) state.log[key] = { sec: 0, reviews: 0, lessons: 0, practice: 0, civics: 0 };
  return state.log[key];
}

export function bump(field, n = 1) { dayLog()[field] += n; save('log'); }

// --- Active study timer -----------------------------------------------------
// Counts seconds only while the page is visible and the user interacted in the last 90 s.
let lastActivity = 0;
export function markActive() { lastActivity = Date.now(); }
['pointerdown', 'keydown', 'input'].forEach(ev => addEventListener(ev, markActive, { passive: true }));
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastActivity > 90000) return;
  dayLog().sec += 5;
  if ((dayLog().sec % 30) === 0) save('tick'); else listeners.forEach(fn => fn('tick'));
}, 5000);

export function streak() {
  const goalSec = 60 * 10; // a day counts towards the streak after 10 minutes
  let n = 0; const d = new Date();
  if ((state.log[todayKey(d)]?.sec || 0) < goalSec) d.setDate(d.getDate() - 1); // today not done yet: count from yesterday
  for (;;) {
    if ((state.log[todayKey(d)]?.sec || 0) >= goalSec) { n++; d.setDate(d.getDate() - 1); } else break;
  }
  return n;
}

// --- Merge (used by sync) ----------------------------------------------------
// Each record carries `u` (updated-at ms). The newer record wins per key.
export function merge(a, b) {
  const out = { ...blank(), ...a };
  for (const coll of ['cards', 'lessons', 'practice', 'civics', 'writing']) {
    out[coll] = { ...(a[coll] || {}) };
    for (const [k, rec] of Object.entries(b[coll] || {})) {
      const mine = out[coll][k];
      if (!mine || (rec.u || 0) > (mine.u || 0)) out[coll][k] = rec;
    }
  }
  out.log = { ...(a.log || {}) };
  for (const [k, rec] of Object.entries(b.log || {})) {
    const mine = out.log[k] || {};
    out.log[k] = Object.fromEntries(['sec', 'reviews', 'lessons', 'practice', 'civics'].map(f => [f, Math.max(mine[f] || 0, rec[f] || 0)]));
  }
  const seen = new Set((a.mocks || []).map(m => m.at));
  out.mocks = [...(a.mocks || []), ...(b.mocks || []).filter(m => !seen.has(m.at))].sort((x, y) => x.at - y.at);
  out.settings = (b.settings?.u || 0) > (a.settings?.u || 0) ? b.settings : a.settings;
  out.startedAt = Math.min(a.startedAt || Date.now(), b.startedAt || Date.now());
  return out;
}

export function setSetting(k, v) { state.settings[k] = v; state.settings.u = Date.now(); save('settings'); }
