import { $, $$, esc, shuffle, sample, md, todayKey, toast, fmtMinutes, wordDiff, similarity, checkAnswer } from './util.js';
import * as store from './store.js';
import * as srs from './srs.js';
import * as C from './content.js';
import { renderStep, typedAnswer, speakBtn, wireSpeak, grammarHTML, genderClass, accentKeys } from './exercises.js';
import { speak, stop as stopAudio, loadAudioManifest, canListen, listen, frenchVoices, hasRecorded } from './speech.js';
import * as sync from './sync.js';

const view = $('#view');
const S = store.get;

// ---------------------------------------------------------------- boot
async function boot() {
  applyTheme();
  await Promise.all([C.course(), loadAudioManifest()]);
  await C.allUnits();
  sync.startAutoSync();
  sync.onStatus((s, detail) => {
    const el = $('#sync-status');
    el.textContent = { off: '', idle: '☁ Synced', syncing: '☁ Syncing…', error: '☁ Sync error', offline: '☁ Offline' }[s];
    el.title = detail || '';
  });
  store.onChange(updateTopbar);
  updateTopbar();
  addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

function updateTopbar() {
  const sec = store.dayLog().sec;
  $('#today-minutes').textContent = `${Math.floor(sec / 60)}/${S().settings.goal} min`;
}

function applyTheme() {
  const t = S().settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

// ---------------------------------------------------------------- router
const routes = [
  [/^\/?$/, home],
  [/^\/review$/, reviewView],
  [/^\/lesson\/(\w+)$/, lessonView],
  [/^\/practice$/, practiceHub],
  [/^\/practice\/(\w+)(?:\/(\w+))?$/, practiceRun],
  [/^\/course$/, courseView],
  [/^\/unit\/(\w+)$/, unitView],
  [/^\/civics$/, civicsHub],
  [/^\/civics\/(daily|practice|mock|theme)(?:\/(\w+))?$/, civicsRun],
  [/^\/read\/(\w+)\/(reading|civics)$/, readingView],
  [/^\/settings$/, settingsView],
];

function route() {
  stopAudio();
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      const tab = path.split('/')[1] || 'home';
      $$('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === ({ lesson: 'home', unit: 'course', read: 'practice' }[tab] || tab)));
      window.scrollTo(0, 0);
      Promise.resolve(fn(...m.slice(1))).catch(err => { console.error(err); view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(err.message)}</p></div>`; });
      view.focus({ preventScroll: true });
      return;
    }
  }
  location.hash = '#/';
}

// ---------------------------------------------------------------- progress helpers
function lessonList() {
  const out = [];
  for (const w of C.weeks()) {
    if (!w.unit) continue;
    const u = C.index && cacheUnit(w.unit);
    u.lessons.forEach((l, i) => out.push({ lesson: l, unit: u, week: w, i }));
  }
  return out;
}
const unitCache = {};
function cacheUnit(id) { return unitCache[id]; }
async function primeUnits() { for (const u of await C.allUnits()) unitCache[u.id] = u; }

function nextLesson() { return lessonList().find(x => !S().lessons[x.lesson.id]?.done) || null; }
function unitProgress(u) { const done = u.lessons.filter(l => S().lessons[l.id]?.done).length; return { done, total: u.lessons.length }; }
function startedUnits() { return Object.values(unitCache).filter(u => u.lessons.some(l => S().lessons[l.id]?.done)); }
function currentWeek() {
  const n = nextLesson(); if (n) return n.week.w;
  const ws = C.weeks().filter(w => w.unit); return ws.length ? ws[ws.length - 1].w : 1;
}

const PRACTICE = {
  drills: { name: 'Grammar drills', ico: '✎', blurb: 'Fill-the-gap, sentence building and conjugation from units you have started.' },
  dictation: { name: 'Dictation', ico: '🎧', blurb: 'Hear a sentence, type it, see every slip.' },
  speaking: { name: 'Speaking', ico: '🎙', blurb: 'Repeat after the voice and answer questions out loud.' },
  reading: { name: 'Reading', ico: '📖', blurb: 'Short texts built from your vocab, with tap-to-translate.' },
  writing: { name: 'Writing', ico: '✍', blurb: 'A short text on the week’s topic, checked against a model answer.' },
};
// Rotation by weekday (0 = Sunday)
const ROTATION = ['reading', 'drills', 'dictation', 'speaking', 'reading', 'writing', 'speaking'];

// ---------------------------------------------------------------- HOME
async function home() {
  await primeUnits();
  const log = store.dayLog(), goal = S().settings.goal;
  const mins = log.sec / 60, pct = Math.min(100, (mins / goal) * 100);
  const due = srs.dueCount();
  const nx = nextLesson();
  const todayKind = ROTATION[new Date().getDay()];
  const civToday = log.civics || 0;
  const st = srs.stats();
  const wk = currentWeek();
  const lessonsToday = log.lessons || 0;
  const practiceToday = log.practice || 0;
  const fc = srs.forecast(7);

  view.innerHTML = `
  <div class="stack">
    <section>
      <div class="eyebrow">${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <h1>Aujourd’hui</h1>
      <div class="card">
        <div class="row between"><div><span class="big-num">${Math.floor(mins)}</span> <span class="muted">/ ${goal} min</span></div>
          <div class="row" style="gap:16px"><div><div class="eyebrow">Streak</div><strong>${store.streak()} days</strong></div><div><div class="eyebrow">Week</div><strong>${wk} / 48</strong></div></div></div>
        <div class="bar ${pct >= 100 ? 'good' : ''}" style="margin-top:12px"><span style="width:${pct}%"></span></div>
      </div>
    </section>

    <section class="stack">
      <h2 style="margin-top:8px">Today’s plan</h2>
      ${planCard(1, 'Review', due ? `${due} card${due > 1 ? 's' : ''} due` : st.total ? 'All caught up' : 'No cards yet — start with the lesson', '~10–15 min', '#/review', due === 0 && st.total > 0)}
      ${nx ? planCard(2, 'Lesson', `${esc(nx.unit.title)} · ${esc(nx.lesson.title)}`, '~15 min', `#/lesson/${nx.lesson.id}`, lessonsToday >= 1, lessonsToday >= 1 ? 'Done for today — another one is fine if you have time' : '')
             : planCard(2, 'Lesson', 'You have finished every available unit', '', '#/course', true)}
      ${planCard(3, 'Practice: ' + PRACTICE[todayKind].name, PRACTICE[todayKind].blurb, '~15 min', `#/practice/${todayKind}`, practiceToday >= 1)}
      ${planCard(4, 'Civics', civToday >= 5 ? 'Done for today' : '5 questions for the civic exam', '~3 min', '#/civics/daily', civToday >= 5)}
    </section>

    <section class="grid2">
      <div class="card"><div class="eyebrow">Cards</div><div class="big-num">${st.total}</div><div class="small muted">${st.mature} mature · ${st.learning} learning</div></div>
      <div class="card"><div class="eyebrow">Due this week</div>
        <div class="row" style="align-items:flex-end;gap:6px;height:48px;margin-top:6px">${fc.map((n, i) => `<div title="${n}" style="flex:1;background:${i ? 'var(--line)' : 'var(--accent)'};border-radius:4px;height:${Math.max(4, Math.min(48, n / Math.max(...fc, 1) * 48))}px"></div>`).join('')}</div>
        <div class="small muted" style="margin-top:4px">${fc.reduce((a, b) => a + b, 0)} reviews over 7 days</div></div>
    </section>

    <div class="row" style="justify-content:center"><a href="#/settings" class="btn ghost sm">⚙ Settings & sync</a></div>
  </div>`;
}

function planCard(n, title, sub, time, href, done, note = '') {
  return `<a class="card link ${done ? 'done' : ''}" href="${href}">
    <div class="row between" style="flex-wrap:nowrap">
      <div class="row" style="flex-wrap:nowrap;gap:14px;min-width:0">
        <div class="brand-mark" style="${done ? 'background:var(--good)' : ''}">${done ? '✓' : n}</div>
        <div style="min-width:0"><h3 style="margin:0">${title}</h3><div class="small muted">${sub}</div>${note ? `<div class="small" style="color:var(--good)">${note}</div>` : ''}</div>
      </div>
      <span class="small muted" style="white-space:nowrap">${time}</span>
    </div></a>`;
}

// ---------------------------------------------------------------- generic runner
// Runs a queue of steps with a progress bar; wrong answers are re-queued once.
function runQueue({ steps, title, onStep, onFinish, requeue = true, exitHref = '#/' }) {
  const queue = [...steps];
  const total = queue.length;
  let doneCount = 0, right = 0, scored = 0;
  const retried = new Set();
  view.innerHTML = `<div class="ex-head"><a class="ex-close" href="${exitHref}" aria-label="Quit">✕</a><div class="bar"><span style="width:0"></span></div><span class="small muted count"></span></div><div class="ex-body"></div>`;
  const body = $('.ex-body', view), bar = $('.bar span', view), count = $('.count', view);
  const next = () => {
    if (!queue.length) return onFinish({ right, scored, total });
    const step = queue.shift();
    count.textContent = `${doneCount + 1}/${total + retried.size}`;
    renderStep(body, step, res => {
      if (!res.skip) {
        if (!retried.has(step)) { scored++; if (res.ok) right++; }
        if (!res.ok && requeue && !retried.has(step)) { retried.add(step); queue.splice(Math.min(queue.length, 3), 0, step); }
      }
      onStep?.(step, res);
      doneCount++;
      bar.style.width = `${Math.min(100, (doneCount / (total + retried.size)) * 100)}%`;
      window.scrollTo(0, 0);
      next();
    });
  };
  next();
}

function finishScreen({ icon = '🎉', title, lines = [], actions = [] }) {
  view.innerHTML = `<div class="done-screen stack">
    <div class="big">${icon}</div><h1>${title}</h1>
    ${lines.map(l => `<p class="muted">${l}</p>`).join('')}
    <div class="stack" style="max-width:360px;margin:20px auto 0">${actions.map(([label, href, cls]) => `<a class="btn ${cls || ''} block" href="${href}">${label}</a>`).join('')}</div>
  </div>`;
}

// ---------------------------------------------------------------- LESSON
async function lessonView(lessonId) {
  await primeUnits();
  const unitId = C.index.unitOfLesson[lessonId];
  const u = unitCache[unitId];
  if (!u) throw new Error('Lesson not found');
  const lesson = u.lessons.find(l => l.id === lessonId);
  const vocab = lesson.vocab.map(id => C.index.vocab[id]);
  const steps = [];
  if (lesson.grammar) steps.push({ t: 'grammar', g: u.grammar.find(g => g.id === lesson.grammar) });
  // Introduce words in groups of 4, each followed by a quick check.
  for (let i = 0; i < vocab.length; i += 4) {
    const group = vocab.slice(i, i + 4);
    group.forEach(v => steps.push({ t: 'learn', v }));
    group.forEach((v, k) => {
      const others = shuffle(vocab.filter(x => x !== v)).slice(0, 3).map(x => x.en);
      if (others.length < 2) return;
      if (k % 2 === 0) steps.push({ t: 'choice', kind: 'What does it mean?', q: `**${v.fr}**`, say: v.fr, opts: [v.en, ...others], a: 0 });
      else steps.push({ t: 'listen', fr: v.fr, opts: [v.en, ...others], a: 0 });
    });
    group.forEach(v => steps.push({ t: 'type', kind: 'Say it in French', q: `**${v.en}**`, a: [v.fr, ...(v.alt || [])], hint: v.g ? 'Include the article (le/la/l’/les)' : undefined }));
  }
  steps.push(...lesson.steps);

  // intro screen
  view.innerHTML = `<div class="stack">
    <div class="eyebrow">Week ${u.week} · ${esc(u.title)}</div>
    <h1>${esc(lesson.title)}</h1>
    ${lesson.intro ? `<p>${md(lesson.intro)}</p>` : ''}
    <div class="card"><div class="small muted">In this lesson</div>
      <div>${vocab.length} new words${lesson.grammar ? ' · 1 grammar point' : ''} · ${lesson.steps.length} exercises</div></div>
    <a class="btn accent block start" href="javascript:void 0">Start</a>
    <a class="btn ghost block" href="#/unit/${u.id}">Unit overview</a>
  </div>`;
  $('.start', view).onclick = () => runQueue({
    steps, exitHref: '#/',
    onFinish: ({ right, scored }) => {
      const s = S();
      const first = !s.lessons[lessonId]?.done;
      s.lessons[lessonId] = { done: Date.now(), u: Date.now() };
      let added = 0;
      if (first) {
        vocab.forEach(v => { added += srs.addCard(`v:${v.id}:r`) ? 1 : 0; added += srs.addCard(`v:${v.id}:p`) ? 1 : 0; });
        const isLast = u.lessons[u.lessons.length - 1].id === lessonId;
        u.drills.filter(d => d.l === lessonId || (isLast && !d.l)).filter(d => ['cloze', 'type'].includes(d.t))
          .forEach(d => { added += srs.addCard(`d:${d.id}`) ? 1 : 0; });
        store.bump('lessons');
      }
      store.save('lesson');
      const nx = nextLesson();
      finishScreen({
        title: 'Leçon terminée !',
        lines: [`${right}/${scored} right first time.`, first ? `${added} cards added to your reviews.` : 'Replayed — no new cards.'],
        actions: [['Back to today', '#/', 'primary'], ...(nx ? [[`Next: ${esc(nx.lesson.title)}`, `#/lesson/${nx.lesson.id}`, '']] : [])],
      });
    },
  });
}

// ---------------------------------------------------------------- REVIEW
async function reviewView() {
  await primeUnits();
  const ids = srs.dueCards(200).filter(id => cardData(id));
  if (!ids.length) {
    const fc = srs.forecast(2);
    return finishScreen({ icon: '☕', title: 'Nothing due', lines: [fc[1] ? `${fc[1]} cards come back tomorrow.` : 'Do a lesson to add new cards.'], actions: [['Back to today', '#/', 'primary'], ['Extra practice', '#/practice', '']] });
  }
  // Interleave: recognition, production and grammar mixed.
  const queue = shuffle(ids);
  let i = 0, n = 0, again = 0;
  const total = queue.length;
  view.innerHTML = `<div class="ex-head"><a class="ex-close" href="#/" aria-label="Quit">✕</a><div class="bar"><span style="width:0"></span></div><span class="small muted count"></span></div><div class="ex-body"></div>`;
  const body = $('.ex-body', view), bar = $('.bar span', view), count = $('.count', view);
  const next = () => {
    if (i >= queue.length) {
      return finishScreen({ title: 'Révisions finies', lines: [`${n} reviews · ${again} to see again soon.`], actions: [['Back to today', '#/', 'primary']] });
    }
    const id = queue[i++];
    count.textContent = `${Math.min(i, total)}/${total}`;
    bar.style.width = `${((i - 1) / total) * 100}%`;
    renderCard(body, id, grade => {
      srs.review(id, grade); n++;
      if (grade === 1) { again++; queue.push(id); } // see it again this session
      window.scrollTo(0, 0);
      next();
    });
  };
  next();
}

function cardData(id) {
  const [kind, ref, side] = id.split(':');
  if (kind === 'v') { const v = C.index.vocab[ref]; return v ? { kind: side === 'r' ? 'recog' : 'prod', v } : null; }
  if (kind === 'd') { const d = C.index.drills[ref]; return d ? { kind: 'drill', d } : null; }
  return null;
}

function gradeButtons(id, allowed = [1, 2, 3, 4], highlight = 3) {
  const names = { 1: ['Again', 'g-again'], 2: ['Hard', 'g-hard'], 3: ['Good', 'g-good'], 4: ['Easy', 'g-easy'] };
  return `<div class="grade-row" style="grid-template-columns:repeat(${allowed.length},1fr)">${allowed.map(g =>
    `<button class="btn ${names[g][1]}" data-g="${g}" ${g === highlight ? 'autofocus' : ''}>${names[g][0]}<small>${srs.nextIntervalLabel(id, g)}</small></button>`).join('')}</div>
    <div class="kbd-hint">Keys: 1 Again · 2 Hard · 3 Good · 4 Easy · Space to reveal</div>`;
}

function wireGrades(el, cb) {
  let used = false;
  const fire = g => { if (used) return; used = true; removeEventListener('keydown', key); cb(g); };
  $$('[data-g]', el).forEach(b => b.onclick = () => fire(+b.dataset.g));
  const key = e => {
    if (!document.body.contains(el) || !$('[data-g]', el)) return removeEventListener('keydown', key);
    if (e.target.matches('input:not([readonly]), textarea')) return;
    const b = $(`[data-g="${e.key}"]`, el); if (b) { e.preventDefault(); fire(+e.key); }
  };
  addEventListener('keydown', key);
}

function renderCard(el, id, done) {
  const cd = cardData(id);
  if (cd.kind === 'recog') {
    const v = cd.v;
    el.innerHTML = `<div class="ex-kind">Do you know it?</div>
      <div class="card flash"><div class="front ${genderClass(v)}">${esc(v.fr)}</div>
        <div class="row" style="justify-content:center">${speakBtn(v.fr)}</div>
        <div class="reveal hidden"><div class="back">${esc(v.en)}</div>${v.ex ? `<div class="ex" style="margin-top:8px">${esc(v.ex)}<br><span class="small">${esc(v.exEn || '')}</span></div>` : ''}</div></div>
      <div class="actions" style="margin-top:14px"><button class="btn primary block show">Show answer</button><div class="kbd-hint">Space to reveal</div></div>`;
    wireSpeak(el); speak(v.fr);
    const reveal = () => {
      removeEventListener('keydown', sp);
      $('.reveal', el).classList.remove('hidden');
      $('.actions', el).innerHTML = gradeButtons(id);
      wireGrades(el, done);
    };
    const sp = e => { if (e.key === ' ' && document.body.contains(el)) { e.preventDefault(); reveal(); } };
    addEventListener('keydown', sp);
    $('.show', el).onclick = reveal;
    return;
  }
  if (cd.kind === 'prod') {
    const v = cd.v;
    return typedAnswer(el, { prompt: `<div style="font-size:1.6rem;font-family:var(--display)">${esc(v.en)}</div>`, answers: [v.fr, ...(v.alt || [])], kind: 'In French', hint: v.g ? 'with the article' : undefined, instant: true },
      res => afterTyped(el, id, res, v.fr, done));
  }
  const d = cd.d;
  if (d.t === 'cloze') {
    const full = d.full || d.q.replace('___', d.a[0]);
    return typedAnswer(el, { prompt: esc(d.q).replace(/___/g, '<span class="blank"></span>') + (d.en ? `<div class="muted small" style="font-weight:400;margin-top:6px">${esc(d.en)}</div>` : ''), answers: d.a, hint: d.hint, why: d.why, kind: 'Grammar · fill the gap', placeholder: 'Missing word(s)…', instant: true },
      res => afterTyped(el, id, res, full, done));
  }
  return typedAnswer(el, { prompt: md(d.q), answers: d.a, hint: d.hint, why: d.why, kind: 'Grammar · translate', instant: true }, res => afterTyped(el, id, res, d.a[0], done));
}

function afterTyped(el, id, res, say, done) {
  speak(say);
  const allowed = res.result === 'ok' ? [2, 3, 4] : res.result === 'wrong' || res.result === 'article' ? [1] : [1, 2, 3];
  const hl = res.result === 'ok' ? 3 : res.result === 'wrong' ? 1 : 2;
  el.insertAdjacentHTML('beforeend', `<div style="margin-top:14px" class="grades">${gradeButtons(id, allowed, hl)}${res.result === 'wrong' ? '<div class="row" style="justify-content:center;margin-top:8px"><button class="btn ghost sm override">I was right (typo / valid alternative)</button></div>' : ''}</div>`);
  $('.check', el)?.closest('.row')?.remove();
  wireGrades(el, done);
  const ov = $('.override', el); if (ov) ov.onclick = () => done(3);
  setTimeout(() => $(`[data-g="${hl}"]`, el)?.focus(), 20);
}

// ---------------------------------------------------------------- PRACTICE
async function practiceHub() {
  await primeUnits();
  const today = ROTATION[new Date().getDay()];
  const units = Object.values(unitCache);
  view.innerHTML = `<div class="stack">
    <h1>Practice</h1>
    <p class="muted">Today’s focus is <strong>${PRACTICE[today].name.toLowerCase()}</strong>. Practice uses the units you have started; pick a unit to focus on it.</p>
    ${Object.entries(PRACTICE).map(([k, p]) => `
      <a class="card link" href="#/practice/${k}"><div class="row" style="flex-wrap:nowrap;gap:14px">
        <div style="font-size:1.6rem">${p.ico}</div><div style="flex:1"><h3 style="margin:0">${p.name} ${k === today ? '<span class="tag accent">Today</span>' : ''}</h3><div class="small muted">${p.blurb}</div></div></div></a>`).join('')}
    <h2 style="margin-top:12px">By unit</h2>
    <div class="card list-card">${units.map(u => `<a class="week available" href="#/unit/${u.id}"><div class="num">${u.week}</div><div class="meta"><div class="title">${esc(u.title)}</div><div class="sub">${esc(u.grammarFocus)}</div></div></a>`).join('')}</div>
  </div>`;
}

function poolUnits(unitId) {
  if (unitId) return [unitCache[unitId]].filter(Boolean);
  const started = startedUnits();
  return started.length ? started : [Object.values(unitCache).sort((a, b) => a.week - b.week)[0]];
}

function weightedPick(units, getter, n) {
  // Most recent unit gets ~half the items.
  const sorted = [...units].sort((a, b) => b.week - a.week);
  const out = [];
  const recent = getter(sorted[0]);
  out.push(...sample(recent, Math.ceil(n * (sorted.length > 1 ? 0.5 : 1))));
  const rest = sorted.slice(1).flatMap(getter);
  out.push(...sample(rest, n - out.length));
  if (out.length < n) out.push(...sample(recent.filter(x => !out.includes(x)), n - out.length));
  return shuffle(out);
}

async function practiceRun(kind, unitId) {
  await primeUnits();
  const units = poolUnits(unitId);
  if (!units.length) return practiceHub();
  const exit = unitId ? `#/unit/${unitId}` : '#/practice';
  const markDone = (id, score) => {
    const s = S();
    const prev = s.practice[id] || {};
    s.practice[id] = { last: Date.now(), best: Math.max(prev.best || 0, score || 0), u: Date.now() };
    store.bump('practice');
  };

  if (kind === 'drills') {
    const items = weightedPick(units, u => u.drills, 15);
    return runQueue({ steps: items, exitHref: exit, onFinish: ({ right, scored }) => {
      markDone(`drills:${unitId || 'mix'}`, right / Math.max(1, scored));
      finishScreen({ title: 'Drills done', lines: [`${right}/${scored} right first time.`], actions: [['Another round', `#/practice/drills${unitId ? '/' + unitId : ''}?r=${Date.now()}`, 'primary'], ['Back to today', '#/', '']] });
    } });
  }
  if (kind === 'dictation') return dictation(units, exit, markDone, unitId);
  if (kind === 'speaking') return speaking(units, exit, markDone, unitId);
  if (kind === 'reading') {
    const u = unitId ? units[0] : units.sort((a, b) => b.week - a.week)[0];
    location.hash = `#/read/${u.id}/reading`; return;
  }
  if (kind === 'writing') return writingView(unitId ? units[0] : units.sort((a, b) => b.week - a.week)[0], exit, markDone);
  location.hash = '#/practice';
}

function dictation(units, exit, markDone, unitId) {
  const items = weightedPick(units, u => u.dictation, 8);
  let i = 0, total = 0;
  view.innerHTML = `<div class="ex-head"><a class="ex-close" href="${exit}" aria-label="Quit">✕</a><div class="bar"><span style="width:0"></span></div><span class="small muted count"></span></div><div class="ex-body"></div>`;
  const body = $('.ex-body', view), bar = $('.bar span', view), count = $('.count', view);
  const next = () => {
    if (i >= items.length) {
      const pct = Math.round((total / items.length) * 100);
      markDone(`dictation:${unitId || 'mix'}`, total / items.length);
      return finishScreen({ title: 'Dictée finie', lines: [`Accuracy: ${pct}%`], actions: [['Another round', `#/practice/dictation${unitId ? '/' + unitId : ''}?r=${Date.now()}`, 'primary'], ['Back to today', '#/', '']] });
    }
    const item = items[i++];
    count.textContent = `${i}/${items.length}`; bar.style.width = `${((i - 1) / items.length) * 100}%`;
    body.innerHTML = `<div class="ex-kind">Dictation</div>
      <div class="ex-prompt">Listen and type what you hear.</div>
      <div class="row" style="margin-bottom:14px">${speakBtn(item.fr, 'Play')}${speakBtn(item.fr, 'Play slowly', { slow: true })}<span class="small muted">Play as often as you like.</span></div>
      <textarea class="answer" style="min-height:90px" lang="fr" autocapitalize="sentences" spellcheck="false" placeholder="Écrivez ici…"></textarea>
      <div class="fb"></div>
      <div class="row" style="margin-top:14px"><button class="btn primary block check">Check</button></div>`;
    const ta = $('.answer', body);
    ta.after(accentKeys(ta));
    wireSpeak(body);
    setTimeout(() => speak(item.fr), 300);
    const btn = $('.check', body);
    btn.onclick = () => {
      if (!ta.value.trim()) return;
      const d = wordDiff(ta.value, item.fr);
      total += d.score; ta.readOnly = true;
      $('.fb', body).innerHTML = `<div class="feedback ${d.score >= .99 ? 'ok' : d.score >= .7 ? 'close' : 'bad'}"><strong>${Math.round(d.score * 100)}%</strong>
        <div class="diff" style="font-size:1.1rem;margin:6px 0">${d.html}</div>
        <div class="small muted">${esc(item.en)}</div>
        <div class="small" style="margin-top:6px"><span class="diff"><span class="fix">green</span></span> = missing · <span class="diff"><span class="miss">struck</span></span> = extra/wrong · <span class="diff"><span class="acc">amber</span></span> = accent / spelling slip</div></div>`;
      btn.textContent = 'Continue'; btn.classList.replace('primary', 'accent');
      btn.onclick = next;
    };
  };
  next();
}

function speaking(units, exit, markDone, unitId) {
  const items = weightedPick(units, u => u.speaking, 8);
  let i = 0, sum = 0;
  view.innerHTML = `<div class="ex-head"><a class="ex-close" href="${exit}" aria-label="Quit">✕</a><div class="bar"><span style="width:0"></span></div><span class="small muted count"></span></div><div class="ex-body"></div>`;
  const body = $('.ex-body', view), bar = $('.bar span', view), count = $('.count', view);
  const next = () => {
    if (i >= items.length) {
      markDone(`speaking:${unitId || 'mix'}`, sum / items.length);
      return finishScreen({ title: 'Bien parlé !', lines: [canListen ? `Average match: ${Math.round((sum / items.length) * 100)}%` : 'Speaking check done.'], actions: [['Another round', `#/practice/speaking${unitId ? '/' + unitId : ''}?r=${Date.now()}`, 'primary'], ['Back to today', '#/', '']] });
    }
    const it = items[i++];
    count.textContent = `${i}/${items.length}`; bar.style.width = `${((i - 1) / items.length) * 100}%`;
    const isRepeat = it.type === 'repeat';
    const target = isRepeat ? it.fr : it.sample;
    body.innerHTML = `<div class="ex-kind">${isRepeat ? 'Listen and repeat' : 'Answer out loud'}</div>
      ${isRepeat ? `<div class="ex-prompt">${esc(it.fr)}</div><p class="muted">${esc(it.en)}</p>`
                 : `<div class="ex-prompt">${esc(it.q)}</div><p class="muted">${esc(it.qEn || '')}</p>${it.hint ? `<p class="small">Try to use: <em>${esc(it.hint)}</em></p>` : ''}`}
      <div class="row" style="margin:6px 0 16px">${speakBtn(isRepeat ? it.fr : it.q)}${isRepeat ? speakBtn(it.fr, 'Slowly', { slow: true }) : ''}</div>
      <div class="card" style="text-align:center">
        ${canListen ? `<button class="icon-btn mic" style="width:72px;height:72px;font-size:1.8rem" aria-label="Record">🎙</button>
        <div class="small muted" style="margin-top:8px">Tap, speak, tap again to stop</div>` : `<p class="small muted">Speech recognition isn’t available in this browser — say it out loud, then compare.</p>`}
        <div class="heard" style="margin-top:10px"></div>
      </div>
      <div class="fb"></div>
      <div class="row" style="margin-top:14px"><button class="btn ${canListen ? 'ghost' : 'primary'} block reveal">${isRepeat ? 'Skip' : 'Show a sample answer'}</button></div>`;
    wireSpeak(body);
    if (isRepeat) setTimeout(() => speak(it.fr), 300);
    let rec = null, score = 0;
    const mic = $('.mic', body);
    if (mic) mic.onclick = async () => {
      if (rec) { rec.stop(); return; }
      mic.classList.add('rec'); $('.heard', body).innerHTML = '<span class="muted small">Listening…</span>';
      rec = listen();
      try {
        const { text, alts } = await rec.promise;
        const best = Math.max(0, ...[text, ...alts].map(t => similarity(t, target)));
        score = Math.max(score, Math.min(1, best));
        $('.heard', body).innerHTML = text ? `<div class="small muted">I heard:</div><div class="fr">${esc(text)}</div>
          ${isRepeat ? `<div style="margin-top:6px"><span class="tag ${score >= .85 ? 'good' : score >= .6 ? 'warn' : 'accent'}">${Math.round(score * 100)}% match</span></div>` : ''}` : '<span class="small muted">Didn’t catch that — try again.</span>';
        if (!isRepeat && text) $('.reveal', body).classList.replace('ghost', 'primary');
        if (isRepeat && text) { const r = $('.reveal', body); r.textContent = 'Continue'; r.classList.replace('ghost', 'accent'); }
      } catch (e) {
        $('.heard', body).innerHTML = `<span class="small muted">Microphone unavailable (${esc(e.error || e.message || 'error')}). Check the browser’s mic permission.</span>`;
      } finally { mic.classList.remove('rec'); rec = null; }
    };
    const rv = $('.reveal', body);
    rv.onclick = () => {
      if (isRepeat || rv.dataset.shown) { sum += isRepeat ? score : (+rv.dataset.self || 0); return next(); }
      rv.dataset.shown = 1;
      $('.fb', body).innerHTML = `<div class="feedback ok"><strong>Sample answer</strong><div class="row" style="flex-wrap:nowrap;margin-top:6px">${speakBtn(it.sample)}<span class="fr">${esc(it.sample)}</span></div>${it.sampleEn ? `<div class="small muted">${esc(it.sampleEn)}</div>` : ''}
        <div class="small" style="margin-top:10px">How did you do?</div>
        <div class="row" style="margin-top:6px"><button class="btn sm" data-self="0.3">Struggled</button><button class="btn sm" data-self="0.7">OK</button><button class="btn sm" data-self="1">Nailed it</button></div></div>`;
      wireSpeak(body);
      $$('[data-self]', body).forEach(b => b.onclick = () => { sum += +b.dataset.self; next(); });
      rv.classList.add('hidden');
    };
  };
  next();
}

function writingView(u, exit, markDone) {
  const w = u.writing;
  const saved = S().writing[w.id];
  view.innerHTML = `<div class="stack">
    <div class="row between"><a class="ex-close" href="${exit}" aria-label="Back">✕</a><span class="tag">Week ${u.week}</span></div>
    <div class="eyebrow">Writing</div>
    <h1>${esc(w.title)}</h1>
    <div class="card"><p class="fr" style="font-weight:500">${esc(w.prompt)}</p><p class="small muted" style="margin:0">${esc(w.promptEn)}</p></div>
    <details class="card"><summary>Useful words & structures</summary><ul>${w.useful.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>
    <div><textarea class="text" lang="fr" spellcheck="false" placeholder="Écrivez ici… (${w.minWords}+ words)">${esc(saved?.text || '')}</textarea>
      <div class="row between small muted" style="margin-top:4px"><span class="wc"></span><span>Draft saves automatically</span></div></div>
    <div class="fb"></div>
    <div class="stack actions">
      <button class="btn primary block check">I’m done — check it</button>
    </div>
  </div>`;
  const ta = $('.text', view);
  ta.after(accentKeys(ta));
  const wc = () => { const n = ta.value.trim().split(/\s+/).filter(Boolean).length; $('.wc', view).textContent = `${n} words`; return n; };
  wc();
  let t;
  ta.oninput = () => { wc(); clearTimeout(t); t = setTimeout(() => { S().writing[w.id] = { text: ta.value, at: Date.now(), u: Date.now() }; store.save('writing'); }, 800); };
  $('.check', view).onclick = () => {
    if (wc() < 5) { toast('Write a few sentences first'); return; }
    S().writing[w.id] = { text: ta.value, at: Date.now(), u: Date.now() }; store.save('writing');
    $('.fb', view).innerHTML = `<div class="card stack">
      <h3>Check yourself</h3>
      ${w.checklist.map((c, i) => `<label style="font-weight:500;display:flex;gap:10px;align-items:flex-start"><input type="checkbox" data-c="${i}" style="margin-top:4px"> ${esc(c)}</label>`).join('')}
      <hr style="margin:6px 0">
      <h3>Model answer</h3>
      <div class="row" style="flex-wrap:nowrap;align-items:flex-start">${speakBtn(w.model)}<p class="fr" style="font-weight:500;margin:0">${esc(w.model)}</p></div>
      <p class="small muted">${esc(w.modelEn)}</p>
      <hr style="margin:6px 0">
      <p class="small">Want real corrections? Copy your text with a ready-made prompt and paste it into Claude.</p>
      <button class="btn block copy">Copy for correction</button>
      <button class="btn accent block finish">Finish</button>
    </div>`;
    wireSpeak(view);
    $('.copy', view).onclick = async () => {
      const prompt = `I'm learning French (aiming for B1). Please correct this short text. Show the corrected version, then list each mistake with a one-line explanation in English, then give me 3 tips for next time.\n\nTask: ${w.prompt}\n\nMy text:\n${ta.value}`;
      try { await navigator.clipboard.writeText(prompt); toast('Copied — paste it into Claude'); } catch { toast('Could not copy'); }
    };
    $('.finish', view).onclick = () => {
      const ticks = $$('[data-c]', view).filter(x => x.checked).length;
      markDone(`writing:${w.id}`, ticks / w.checklist.length);
      finishScreen({ title: 'Texte écrit', lines: [`${wc()} words · ${ticks}/${w.checklist.length} checklist items.`], actions: [['Back to today', '#/', 'primary']] });
    };
  };
}

// ---------------------------------------------------------------- READING (unit text or civics text)
async function readingView(unitId, which) {
  await primeUnits();
  const u = unitCache[unitId];
  const r = which === 'civics' ? u.civicsReading : u.reading;
  const vocabGloss = Object.fromEntries(Object.values(C.index.vocab).map(v => [v.fr.replace(/^(le |la |les |l’|l'|un |une |se |s’|s')/i, '').toLowerCase(), v.en]));
  const gloss = { ...vocabGloss, ...Object.fromEntries(Object.entries(r.gloss || {}).map(([k, v]) => [k.toLowerCase(), v])) };
  const paras = r.text.split('\n').filter(Boolean);
  const wordify = p => p.split(/(\s+)/).map(tok => {
    if (/^\s+$/.test(tok)) return tok;
    const m = tok.match(/^([«"(]*)(.*?)([.,;:!?»")]*)$/);
    const core = m[2];
    const key = core.toLowerCase().replace(/^(l|d|j|n|s|c|m|t|qu)['’]/, '');
    const hit = gloss[core.toLowerCase()] || gloss[key];
    return `${esc(m[1])}<span class="w ${hit ? 'gloss' : ''}" data-g="${esc(hit || '')}">${esc(core)}</span>${esc(m[3])}`;
  }).join('');
  view.innerHTML = `<div class="stack">
    <div class="row between"><a class="ex-close" href="${which === 'civics' ? '#/civics' : '#/practice'}" aria-label="Back">✕</a><span class="tag ${which === 'civics' ? 'accent' : ''}">${which === 'civics' ? 'Civics · ' : ''}Week ${u.week}</span></div>
    <h1>${esc(r.title)}</h1>
    <div class="row">${r.text.length < 2500 ? `<button class="btn sm play">▶ Listen</button><button class="btn sm ghost stop">■</button>` : ''}<span class="small muted">Tap a dotted word for its meaning.</span></div>
    <div class="card reading-text">${paras.map(p => `<p>${wordify(p)}</p>`).join('')}</div>
    <details class="card"><summary>English translation</summary><div style="margin-top:8px">${r.en.split('\n').filter(Boolean).map(p => `<p class="small">${esc(p)}</p>`).join('')}</div></details>
    <h2>Questions</h2>
    <div class="qs"></div>
  </div>`;
  const pop = document.createElement('div'); pop.className = 'gloss-pop hidden'; document.body.appendChild(pop);
  const hide = () => pop.classList.add('hidden');
  $$('.w', view).forEach(w => w.onclick = e => {
    const g = w.dataset.g;
    if (!g) { speak(w.textContent); hide(); return; }
    speak(w.textContent);
    pop.textContent = g; pop.classList.remove('hidden');
    const rc = w.getBoundingClientRect();
    pop.style.left = Math.min(innerWidth - 270, Math.max(8, rc.left)) + 'px';
    pop.style.top = (rc.bottom + 6) + 'px';
    clearTimeout(pop._t); pop._t = setTimeout(hide, 2500);
    e.stopPropagation();
  });
  addEventListener('hashchange', () => pop.remove(), { once: true });
  addEventListener('scroll', hide, { passive: true });
  const playBtn = $('.play', view);
  if (playBtn) {
    let playing = false;
    playBtn.onclick = async () => {
      playing = true;
      const sentences = r.text.replace(/\n/g, ' ').match(/[^.!?]+[.!?»]*/g) || [r.text];
      for (const s of sentences) { if (!playing) break; await speak(s.trim()); }
    };
    $('.stop', view).onclick = () => { playing = false; stopAudio(); };
  }
  const qs = $('.qs', view);
  let right = 0, answered = 0;
  qs.innerHTML = r.questions.map((q, qi) => `<div class="card" data-q="${qi}"><div style="font-weight:600;margin-bottom:10px">${esc(q.q)}</div>
    <div class="choices">${q.opts.map((o, oi) => `<button class="choice" data-o="${oi}">${esc(o)}</button>`).join('')}</div></div>`).join('') +
    `<button class="btn accent block finish" style="margin-top:14px">Finish</button>`;
  $$('[data-q]', qs).forEach(card => {
    const q = r.questions[+card.dataset.q];
    $$('.choice', card).forEach(b => b.onclick = () => {
      if (card.dataset.done) return; card.dataset.done = 1; answered++;
      const ok = +b.dataset.o === q.a; if (ok) right++;
      $$('.choice', card).forEach(x => { x.disabled = true; if (+x.dataset.o === q.a) x.classList.add('right'); });
      if (!ok) b.classList.add('wrong');
    });
  });
  $('.finish', qs).onclick = () => {
    const s = S(); const id = `${which}:${unitId}`;
    const prev = s.practice[id] || {};
    s.practice[id] = { last: Date.now(), best: Math.max(prev.best || 0, right / r.questions.length), u: Date.now() };
    store.bump(which === 'civics' ? 'civics' : 'practice', which === 'civics' ? 0 : 1);
    finishScreen({ title: 'Lecture finie', lines: [`${right}/${r.questions.length} questions right.`], actions: [['Back to today', '#/', 'primary']] });
  };
}

// ---------------------------------------------------------------- COURSE / UNIT
async function courseView() {
  await primeUnits();
  const c = await C.course();
  const cw = currentWeek();
  view.innerHTML = `<div class="stack">
    <h1>Your year</h1>
    <p class="muted">${esc(c.summary)}</p>
    ${c.months.map(m => `<section class="month">
      <div class="row between"><h2 style="margin:0">Month ${m.n} · ${esc(m.title)}</h2><span class="tag ${m.level.startsWith('B1') ? 'accent' : ''}">${esc(m.level)}</span></div>
      <div class="card list-card" style="margin-top:10px">${m.weeks.map(w => {
        const u = w.unit && unitCache[w.unit];
        const p = u ? unitProgress(u) : null;
        const cls = !u ? '' : p.done === p.total ? 'complete available' : w.w === cw ? 'current available' : 'available';
        const inner = `<div class="num">${p && p.done === p.total ? '✓' : w.w}</div><div class="meta"><div class="title">${esc(w.title)}</div><div class="sub">${esc(w.grammar)}${w.civics ? ' · ⚑ ' + esc(w.civics) : ''}</div></div>
          ${u ? `<span class="small muted">${p.done}/${p.total}</span>` : '<span class="small muted">soon</span>'}`;
        return u ? `<a class="week ${cls}" href="#/unit/${u.id}">${inner}</a>` : `<div class="week">${inner}</div>`;
      }).join('')}</div></section>`).join('')}
  </div>`;
}

async function unitView(id) {
  await primeUnits();
  const u = unitCache[id];
  if (!u) throw new Error('Unit not found');
  const p = unitProgress(u);
  const cards = S().cards;
  view.innerHTML = `<div class="stack">
    <div class="eyebrow">Week ${u.week} · ${esc(u.level)} · ${esc(u.theme)}</div>
    <h1>${esc(u.title)}</h1>
    <p>${md(u.intro)}</p>
    <div class="bar good"><span style="width:${(p.done / p.total) * 100}%"></span></div>

    <h2>Lessons</h2>
    <div class="card list-card">${u.lessons.map((l, i) => {
      const done = S().lessons[l.id]?.done;
      return `<a class="week available ${done ? 'complete' : ''}" href="#/lesson/${l.id}"><div class="num">${done ? '✓' : i + 1}</div><div class="meta"><div class="title">${esc(l.title)}</div><div class="sub">${l.vocab.length} words${l.grammar ? ' · grammar' : ''}</div></div></a>`;
    }).join('')}</div>

    <h2>Practise this unit</h2>
    <div class="grid2">
      ${['drills', 'dictation', 'speaking', 'writing'].map(k => `<a class="card link" href="#/practice/${k}/${u.id}"><div style="font-size:1.3rem">${PRACTICE[k].ico}</div><strong>${PRACTICE[k].name}</strong></a>`).join('')}
      <a class="card link" href="#/read/${u.id}/reading"><div style="font-size:1.3rem">📖</div><strong>${esc(u.reading.title)}</strong><div class="small muted">Reading</div></a>
      <a class="card link" href="#/read/${u.id}/civics"><div style="font-size:1.3rem">⚑</div><strong>${esc(u.civicsReading.title)}</strong><div class="small muted">Civics reading</div></a>
    </div>

    <h2>Grammar notes</h2>
    ${u.grammar.map(g => `<details class="card"><summary>${esc(g.title)}</summary><div style="margin-top:10px">${grammarHTML(g)}</div></details>`).join('')}

    <h2>Vocabulary (${u.vocab.length})</h2>
    <div class="card"><ul class="ex-list">${u.vocab.map(v => {
      const c = cards[`v:${v.id}:p`];
      const st = !c ? '' : c.ivl >= 21 ? '<span class="tag good">known</span>' : '<span class="tag">learning</span>';
      return `<li>${speakBtn(v.fr)}<div style="flex:1"><div class="fr ${genderClass(v)}">${esc(v.fr)}</div><div class="en">${esc(v.en)}</div></div>${st}</li>`;
    }).join('')}</ul></div>
  </div>`;
  wireSpeak(view);
}

// ---------------------------------------------------------------- CIVICS
async function civicsHub() {
  await primeUnits();
  const cv = await C.civics();
  const st = S().civics;
  const byTheme = cv.themes.map(t => {
    const qs = cv.questions.filter(q => q.theme === t.id);
    const seen = qs.filter(q => st[q.id]);
    const solid = qs.filter(q => st[q.id] && st[q.id].r > st[q.id].w && st[q.id].last);
    return { ...t, total: qs.length, seen: seen.length, solid: solid.length };
  });
  const mocks = S().mocks.slice(-5).reverse();
  view.innerHTML = `<div class="stack">
    <h1>Examen civique</h1>
    <p class="muted">${esc(cv.intro)}</p>
    <div class="grid2">
      <a class="card link" href="#/civics/practice"><div class="eyebrow">Practice</div><strong>10 questions</strong><div class="small muted">Weighted towards ones you got wrong</div></a>
      <a class="card link" href="#/civics/mock"><div class="eyebrow">Mock exam</div><strong>40 questions · 45 min</strong><div class="small muted">Pass mark: ${cv.passMark}/40</div></a>
    </div>
    ${mocks.length ? `<div class="card"><div class="eyebrow">Recent mock exams</div>${mocks.map(m => `<div class="row between"><span>${new Date(m.at).toLocaleDateString('fr-FR')}</span><span class="tag ${m.score >= cv.passMark * m.total / 40 ? 'good' : 'accent'}">${m.score}/${m.total}</span></div>`).join('')}</div>` : ''}
    <h2>Themes</h2>
    <div class="card list-card">${byTheme.map(t => `<a class="week available" href="#/civics/theme/${t.id}"><div class="num">${t.icon}</div><div class="meta"><div class="title">${esc(t.title)}</div><div class="sub">${esc(t.en)}</div></div><span class="small muted">${t.solid}/${t.total}</span></a>`).join('')}</div>
    <h2>Civics readings</h2>
    <div class="card list-card">${Object.values(unitCache).map(u => `<a class="week available" href="#/read/${u.id}/civics"><div class="num">${u.week}</div><div class="meta"><div class="title">${esc(u.civicsReading.title)}</div></div></a>`).join('')}</div>
    <p class="small muted">${cv.disclaimer}</p>
  </div>`;
}

async function civicsRun(mode, theme) {
  const cv = await C.civics();
  const st = S().civics;
  let qs;
  if (mode === 'mock') {
    // Same theme balance as the real exam, as far as the bank allows.
    qs = cv.themes.flatMap(t => sample(cv.questions.filter(q => q.theme === t.id), t.mockCount));
    if (qs.length < 40) qs.push(...sample(cv.questions.filter(q => !qs.includes(q)), 40 - qs.length));
    qs = shuffle(qs).slice(0, 40).map(q => {
      const order = shuffle(q.opts.map((o, k) => k));
      return { ...q, opts: order.map(k => q.opts[k]), a: order.indexOf(q.a) };
    });
  } else {
    const pool = theme ? cv.questions.filter(q => q.theme === theme) : cv.questions;
    const weight = q => { const s = st[q.id]; if (!s) return 3; return 1 + Math.max(0, s.w * 2 - s.r); };
    const weighted = pool.flatMap(q => new Array(Math.min(6, weight(q))).fill(q));
    const picked = new Set(); const want = mode === 'daily' ? 5 : 10;
    for (const q of shuffle(weighted)) { if (picked.size >= Math.min(want, pool.length)) break; picked.add(q); }
    qs = [...picked];
  }
  const record = (q, ok) => {
    const s = st[q.id] || { r: 0, w: 0 };
    if (ok) s.r++; else s.w++;
    s.last = ok; s.u = Date.now(); st[q.id] = s;
  };

  if (mode !== 'mock') {
    const steps = qs.map(q => ({ t: 'choice', kind: cv.themes.find(t => t.id === q.theme).title, q: q.q, opts: q.opts, a: q.a, why: q.en + (q.why ? ` — ${q.why}` : ''), _q: q }));
    return runQueue({
      steps, exitHref: '#/civics', requeue: false,
      onStep: (step, res) => { record(step._q, res.ok); store.bump('civics'); },
      onFinish: ({ right, scored }) => finishScreen({ icon: '⚑', title: 'Civique', lines: [`${right}/${scored} right.`], actions: [['Back to today', '#/', 'primary'], ['More questions', `#/civics/practice?r=${Date.now()}`, '']] }),
    });
  }

  // Mock exam: timed, no feedback until the end.
  const answers = new Array(qs.length).fill(null);
  const endAt = Date.now() + 45 * 60000;
  let i = 0, timer;
  const render = () => {
    const q = qs[i];
    view.innerHTML = `<div class="ex-head"><a class="ex-close" href="#/civics" aria-label="Quit">✕</a><div class="bar"><span style="width:${(i / qs.length) * 100}%"></span></div><span class="timer small"></span></div>
      <div class="ex-kind">Question ${i + 1} / ${qs.length}</div>
      <div class="ex-prompt">${esc(q.q)}</div>
      <div class="choices">${q.opts.map((o, k) => `<button class="choice ${answers[i] === k ? 'right' : ''}" data-k="${k}">${esc(o)}</button>`).join('')}</div>
      <div class="row between" style="margin-top:16px"><button class="btn prev" ${i === 0 ? 'disabled' : ''}>← Back</button>
        ${i === qs.length - 1 ? '<button class="btn accent submit">Submit exam</button>' : '<button class="btn primary nextq">Next →</button>'}</div>`;
    $$('.choice', view).forEach(b => b.onclick = () => { answers[i] = +b.dataset.k; if (i < qs.length - 1) { i++; render(); } else render(); });
    $('.prev', view).onclick = () => { i--; render(); };
    const nq = $('.nextq', view); if (nq) nq.onclick = () => { i++; render(); };
    const sb = $('.submit', view); if (sb) sb.onclick = finish;
    tick();
  };
  const tick = () => {
    const left = Math.max(0, endAt - Date.now());
    const el = $('.timer', view);
    if (el) el.textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
    if (left <= 0) finish();
  };
  timer = setInterval(tick, 1000);
  addEventListener('hashchange', () => clearInterval(timer), { once: true });
  function finish() {
    clearInterval(timer);
    let score = 0;
    qs.forEach((q, k) => { const ok = answers[k] === q.a; if (ok) score++; record(q, ok); });
    S().mocks.push({ at: Date.now(), score, total: qs.length });
    store.bump('civics', qs.length);
    store.save('mock');
    const pass = score >= Math.ceil(qs.length * cv.passMark / 40);
    view.innerHTML = `<div class="stack">
      <div class="done-screen"><div class="big">${pass ? '✅' : '📚'}</div><h1>${score}/${qs.length}</h1><p class="muted">${pass ? 'Pass — you need 80%.' : `Not yet — you need ${Math.ceil(qs.length * 0.8)}.`}</p></div>
      <h2>Review your answers</h2>
      ${qs.map((q, k) => `<div class="card"><div style="font-weight:600">${k + 1}. ${esc(q.q)}</div>
        <div class="small" style="margin-top:6px">${answers[k] === q.a ? '<span class="tag good">right</span>' : `<span class="tag accent">wrong</span> You: ${esc(q.opts[answers[k]] ?? '—')}`}</div>
        <div class="small" style="margin-top:4px">Answer: <strong>${esc(q.opts[q.a])}</strong></div>
        <div class="small muted">${esc(q.en)}${q.why ? ' — ' + esc(q.why) : ''}</div></div>`).join('')}
      <a class="btn primary block" href="#/civics">Done</a></div>`;
  }
  render();
}

// ---------------------------------------------------------------- SETTINGS
async function settingsView() {
  const s = S().settings;
  const voices = frenchVoices();
  const unitIds = C.availableUnitIds();
  const anyRecorded = (await C.allUnits()).some(u => hasRecorded(u.vocab[0]?.fr || ''));
  view.innerHTML = `<div class="stack">
    <h1>Settings</h1>

    <section class="card stack">
      <h2>Sync between devices</h2>
      <div class="sync-box"></div>
    </section>

    <section class="card stack">
      <h2>Daily goal</h2>
      <div class="row"><input type="number" class="goal" min="10" max="180" step="5" value="${s.goal}" style="width:110px"><span class="muted">minutes per day</span></div>
    </section>

    <section class="card stack">
      <h2>Voice</h2>
      <p class="small muted">${anyRecorded ? 'Recorded neural audio is installed and used where available; the device voice covers anything else.' : 'No recorded audio yet — using your device’s French voice. Run <code>scripts/generate_audio.py</code> to add natural voices.'}</p>
      <label for="voice">Device voice (fallback)</label>
      <select id="voice"><option value="">Automatic (best available)</option>${voices.map(v => `<option ${v.name === s.voice ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
      <label for="rate">Speed: <span class="rate-val">${s.rate}×</span></label>
      <input type="range" id="rate" min="0.6" max="1.2" step="0.05" value="${s.rate}" style="width:100%">
      <button class="btn test-voice">🔊 Test: « Je voudrais une baguette, s’il vous plaît. »</button>
    </section>

    <section class="card stack">
      <h2>Appearance</h2>
      <select class="theme"><option value="auto">Match device</option><option value="light">Light</option><option value="dark">Dark</option></select>
    </section>

    <section class="card stack">
      <h2>Backup</h2>
      <div class="row"><button class="btn export">Export progress</button><label class="btn" style="margin:0">Import<input type="file" accept="application/json" class="import hidden"></label></div>
      <p class="small muted">${unitIds.length} units available · ${Object.keys(S().cards).length} cards · started ${new Date(S().startedAt).toLocaleDateString('fr-FR')}</p>
    </section>
  </div>`;
  renderSyncBox();
  $('.goal', view).onchange = e => { store.setSetting('goal', Math.max(10, Math.min(180, +e.target.value || 45))); updateTopbar(); };
  $('#voice', view).onchange = e => store.setSetting('voice', e.target.value);
  $('#rate', view).oninput = e => { $('.rate-val', view).textContent = e.target.value + '×'; store.setSetting('rate', +e.target.value); };
  $('.test-voice', view).onclick = () => speak('Je voudrais une baguette, s’il vous plaît.');
  const th = $('.theme', view); th.value = s.theme; th.onchange = () => { store.setSetting('theme', th.value); applyTheme(); };
  $('.export', view).onclick = () => {
    const blob = new Blob([JSON.stringify(S(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `en-route-b1-${todayKey()}.json`; a.click();
  };
  $('.import', view).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const data = JSON.parse(await f.text()); store.replace(store.merge(S(), data)); toast('Progress imported and merged'); settingsView(); }
    catch { toast('That file could not be read'); }
  };
}

function renderSyncBox() {
  const box = $('.sync-box', view); if (!box) return;
  if (sync.isConnected()) {
    box.innerHTML = `<p>Connected. Progress is saved to a private Gist on your GitHub account and merged automatically on every device you connect.</p>
      <div class="row"><button class="btn primary now">Sync now</button><button class="btn ghost off">Disconnect this device</button></div>
      <p class="small muted status"></p>`;
    const un = sync.onStatus((st, d) => { const el = $('.status', box); if (!el) return un(); el.textContent = st === 'error' ? `Error: ${d}` : st === 'idle' ? `Last sync ${new Date(sync.lastSync || Date.now()).toLocaleTimeString('fr-FR')}` : st; });
    $('.now', box).onclick = () => sync.syncNow();
    $('.off', box).onclick = () => { sync.disconnect(); renderSyncBox(); };
  } else {
    box.innerHTML = `<p class="small">Progress is stored on this device. To share it between your phone and laptop, connect a GitHub token that can only touch Gists.</p>
      <ol class="small" style="padding-left:18px;margin:0">
        <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Fine-grained tokens → New</a>.</li>
        <li>Name it “En route B1”, pick an expiry (1 year), Repository access: <em>Public repositories</em>.</li>
        <li>Under <strong>Account permissions</strong>, set <strong>Gists</strong> to <em>Read and write</em>. Nothing else.</li>
        <li>Generate, copy, paste below. Do the same paste on your other device.</li>
      </ol>
      <input type="password" class="tok" placeholder="github_pat_…" autocomplete="off">
      <button class="btn primary connect">Connect</button>
      <p class="small muted">The token is kept only in this browser. It is never added to the repo.</p>`;
    $('.connect', box).onclick = async () => {
      const t = $('.tok', box).value.trim(); if (!t) return;
      $('.connect', box).disabled = true; $('.connect', box).textContent = 'Connecting…';
      try { await sync.connect(t); toast('Connected — progress synced'); renderSyncBox(); }
      catch (e) { toast(e.message); sync.disconnect(); renderSyncBox(); }
    };
  }
}

boot();
