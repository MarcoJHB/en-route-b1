// Loads the course and unit files and indexes them.
const cache = { course: null, units: {}, civics: null };
export const index = { vocab: {}, drills: {}, unitOfLesson: {} };

async function getJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Could not load ${path}`);
  return r.json();
}

export async function course() {
  if (!cache.course) cache.course = await getJSON('content/course.json');
  return cache.course;
}

export function weeks(c = cache.course) { return c.months.flatMap(m => m.weeks.map(w => ({ ...w, month: m.n }))); }

export function availableUnitIds(c = cache.course) { return weeks(c).filter(w => w.unit).map(w => w.unit); }

export async function unit(id) {
  if (cache.units[id]) return cache.units[id];
  const u = await getJSON(`content/units/${id}.json`);
  cache.units[id] = u;
  for (const v of u.vocab) index.vocab[v.id] = { ...v, unit: id };
  for (const d of u.drills) index.drills[d.id] = { ...d, unit: id };
  for (const l of u.lessons) index.unitOfLesson[l.id] = id;
  return u;
}

export async function allUnits() {
  const c = await course();
  return Promise.all(availableUnitIds(c).map(unit));
}

export async function civics() {
  if (!cache.civics) cache.civics = await getJSON('content/civics.json');
  return cache.civics;
}

// Every French string that should have audio (also used by the audio generator).
export function frenchStrings(u) {
  const out = new Set();
  u.vocab.forEach(v => { out.add(v.fr); if (v.ex) out.add(v.ex); });
  u.grammar.forEach(g => (g.examples || []).forEach(([fr]) => out.add(fr)));
  u.lessons.forEach(l => l.steps.forEach(s => {
    if (s.t === 'listen' || s.t === 'order') out.add(s.fr);
    if (s.t === 'dialogue') s.lines.forEach(([, fr]) => out.add(fr));
  }));
  u.dictation.forEach(d => out.add(d.fr));
  u.speaking.forEach(s => { if (s.fr) out.add(s.fr); if (s.q) out.add(s.q); if (s.sample) out.add(s.sample); });
  return [...out];
}
