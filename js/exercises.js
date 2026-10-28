// Renders one exercise step and reports the outcome.
// Every renderer: (el, step, done) -> void, where done({ ok, result, given })
import { esc, shuffle, checkAnswer, md, $, $$, tidy, stripAccents } from './util.js';
import { speak } from './speech.js';

const ACCENTS = ['é', 'è', 'ê', 'à', 'â', 'ç', 'ô', 'î', 'ù', 'û', 'ë', 'ï', 'œ'];

export function speakBtn(text, label = 'Listen', opts = {}) {
  return `<button class="icon-btn" data-say="${esc(text)}" ${opts.slow ? 'data-slow="1"' : ''} aria-label="${esc(label)}" title="${esc(label)}">${opts.slow ? '🐢' : '🔊'}</button>`;
}

export function wireSpeak(root) {
  $$('[data-say]', root).forEach(b => b.addEventListener('click', e => {
    e.preventDefault();
    speak(b.dataset.say, { slow: !!b.dataset.slow, voice: b.dataset.voice });
  }));
}

export function accentKeys(input) {
  const wrap = document.createElement('div');
  wrap.className = 'accent-keys';
  wrap.innerHTML = ACCENTS.map(a => `<button type="button" tabindex="-1">${a}</button>`).join('');
  wrap.addEventListener('pointerdown', e => e.preventDefault()); // keep focus in the input
  wrap.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const s = input.selectionStart ?? input.value.length, en = input.selectionEnd ?? s;
    input.value = input.value.slice(0, s) + b.textContent + input.value.slice(en);
    input.focus(); input.setSelectionRange(s + 1, s + 1);
    input.dispatchEvent(new Event('input'));
  });
  return wrap;
}

function feedbackHTML(kind, title, body = '') {
  return `<div class="feedback ${kind}"><strong>${title}</strong>${body}</div>`;
}

const RESULT_TEXT = {
  ok: ['ok', 'Correct'],
  accent: ['close', 'Almost — check the accents'],
  typo: ['close', 'Almost — small typo'],
  article: ['close', 'Watch the article'],
  wrong: ['bad', 'Not quite'],
};

// Typed answer, used by 'type', 'cloze' and production cards.
export function typedAnswer(el, { prompt, answers, hint, why, kind, after, placeholder, instant }, done) {
  el.innerHTML = `
    <div class="ex-kind">${esc(kind || 'Type the answer')}</div>
    <div class="ex-prompt">${prompt}</div>
    ${hint ? `<p class="muted small">Hint: ${esc(hint)}</p>` : ''}
    <form class="answer-form" autocomplete="off">
      <input type="text" class="answer" autocapitalize="off" autocorrect="off" spellcheck="false" lang="fr" placeholder="${esc(placeholder || 'En français…')}">
    </form>
    <div class="fb"></div>
    <div class="row" style="margin-top:14px"><button class="btn primary block check">Check</button></div>`;
  const input = $('.answer', el), form = $('form', el), btn = $('.check', el), fb = $('.fb', el);
  form.after(accentKeys(input));
  setTimeout(() => input.focus({ preventScroll: true }), 30);
  let checked = false;
  const submit = e => {
    e?.preventDefault();
    if (checked) return;
    if (!input.value.trim()) { input.focus(); return; }
    checked = true;
    let { result, best } = checkAnswer(input.value, answers);
    // Noun typed without its article?
    if (result === 'wrong') {
      const g = stripAccents(tidy(input.value));
      if (answers.some(a => stripAccents(tidy(a)).replace(/^(le |la |les |l'|un |une |des |du |de la )/, '') === g)) result = 'article';
    }
    const [cls, title] = RESULT_TEXT[result];
    input.classList.add(cls === 'ok' ? 'ok' : cls === 'close' ? 'close' : 'bad');
    input.readOnly = true;
    const showAns = result !== 'ok' ? `<div>Answer: <span class="fr">${esc(best)}</span></div>` : '';
    fb.innerHTML = feedbackHTML(cls, title, showAns + (why ? `<div class="small" style="margin-top:6px">${md(why)}</div>` : '') + (after || ''));
    wireSpeak(fb);
    if (instant) return done({ ok: result === 'ok', result, given: input.value });
    btn.textContent = 'Continue';
    btn.classList.remove('primary'); btn.classList.add('accent');
    btn.onclick = () => done({ ok: result === 'ok', result, given: input.value });
    btn.focus();
  };
  form.addEventListener('submit', submit);
  btn.onclick = submit;
}

export function renderStep(el, step, done) {
  switch (step.t) {
    case 'choice': return choice(el, step, done);
    case 'listen': return listenChoice(el, step, done);
    case 'type': return typedAnswer(el, { prompt: md(step.q), answers: step.a, hint: step.hint, why: step.why, kind: step.kind || 'Translate' }, done);
    case 'cloze': return cloze(el, step, done);
    case 'order': return order(el, step, done);
    case 'dialogue': return dialogue(el, step, done);
    case 'note': return note(el, step, done);
    case 'learn': return learn(el, step, done);
    case 'grammar': return grammarCard(el, step, done);
    default: el.innerHTML = `<p>Unknown step ${esc(step.t)}</p>`; done({ ok: true });
  }
}

function choice(el, step, done) {
  const opts = step.opts.map((o, i) => ({ o, i }));
  const order = step.keepOrder ? opts : shuffle(opts);
  el.innerHTML = `
    <div class="ex-kind">${esc(step.kind || 'Choose')}</div>
    <div class="ex-prompt">${md(step.q).replace(/___/g, '<span class="blank"></span>')}</div>
    ${step.say ? `<div class="row" style="margin:-6px 0 14px">${speakBtn(step.say)}</div>` : ''}
    <div class="choices">${order.map(({ o, i }) => `<button class="choice" data-i="${i}">${esc(o)}</button>`).join('')}</div>
    <div class="fb"></div>
    <div class="row hidden next" style="margin-top:14px"><button class="btn accent block">Continue</button></div>`;
  wireSpeak(el);
  let answered = false;
  $$('.choice', el).forEach(b => b.onclick = () => {
    if (answered) return; answered = true;
    const i = +b.dataset.i, ok = i === step.a;
    $$('.choice', el).forEach(x => { x.disabled = true; if (+x.dataset.i === step.a) x.classList.add('right'); });
    if (!ok) b.classList.add('wrong');
    if (step.why || !ok) $('.fb', el).innerHTML = feedbackHTML(ok ? 'ok' : 'bad', ok ? 'Correct' : 'Not quite', step.why ? `<div class="small">${md(step.why)}</div>` : '');
    if (step.sayAfter) speak(step.sayAfter);
    const nx = $('.next', el); nx.classList.remove('hidden');
    const btn = $('button', nx); btn.onclick = () => done({ ok, result: ok ? 'ok' : 'wrong' }); btn.focus();
  });
  keyChoices(el);
}

function keyChoices(el) {
  const handler = e => {
    if (!document.body.contains(el)) return removeEventListener('keydown', handler);
    if (e.target.matches('input, textarea')) return;
    const n = parseInt(e.key, 10);
    const bs = $$('.choice', el);
    if (n >= 1 && n <= bs.length && !bs[0].disabled) bs[n - 1].click();
  };
  addEventListener('keydown', handler);
}

function listenChoice(el, step, done) {
  choice(el, { ...step, q: step.q || 'What did you hear?', kind: 'Listen', say: step.fr }, done);
  setTimeout(() => speak(step.fr), 250);
}

function cloze(el, step, done) {
  const prompt = esc(step.q).replace(/___/g, '<span class="blank"></span>') + (step.en ? `<div class="muted small" style="font-weight:400;margin-top:6px">${esc(step.en)}</div>` : '');
  const full = step.full || step.q.replace('___', step.a[0]);
  typedAnswer(el, { prompt, answers: step.a, hint: step.hint, why: step.why, kind: step.kind || 'Fill the gap', after: `<div class="row" style="margin-top:8px">${speakBtn(full)}<span class="fr">${esc(full)}</span></div>`, placeholder: 'Missing word(s)…' }, done);
}

function order(el, step, done) {
  const words = step.fr.replace(/([.?!])$/, ' $1').split(/\s+/).filter(Boolean);
  const target = words.join(' ');
  const bank = shuffle([...words, ...(step.extra || [])].map((w, i) => ({ w, i })));
  el.innerHTML = `
    <div class="ex-kind">Build the sentence</div>
    <div class="ex-prompt">${esc(step.en)}</div>
    <div class="tiles answer-tiles" aria-label="Your sentence"></div>
    <div class="tiles bank" style="margin-top:10px">${bank.map(({ w, i }) => `<button class="tile" data-i="${i}">${esc(w)}</button>`).join('')}</div>
    <div class="fb"></div>
    <div class="row" style="margin-top:14px"><button class="btn ghost reset">Clear</button><button class="btn primary check" style="flex:1">Check</button></div>`;
  const ans = $('.answer-tiles', el); const picked = [];
  $$('.bank .tile', el).forEach(t => t.onclick = () => {
    if (t.classList.contains('used')) return;
    t.classList.add('used'); picked.push(t);
    const c = document.createElement('button'); c.className = 'tile'; c.textContent = t.textContent;
    c.onclick = () => { if (checked) return; t.classList.remove('used'); picked.splice(picked.indexOf(t), 1); c.remove(); };
    ans.appendChild(c);
  });
  let checked = false;
  $('.reset', el).onclick = () => { if (checked) return; picked.length = 0; ans.innerHTML = ''; $$('.bank .tile', el).forEach(t => t.classList.remove('used')); };
  const btn = $('.check', el);
  btn.onclick = () => {
    if (checked) return;
    if (!picked.length) return;
    checked = true;
    const given = picked.map(t => t.textContent).join(' ');
    const ok = tidy(given) === tidy(target);
    $('.fb', el).innerHTML = feedbackHTML(ok ? 'ok' : 'bad', ok ? 'Correct' : 'Not quite', `<div class="row" style="margin-top:6px">${speakBtn(step.fr)}<span class="fr">${esc(step.fr)}</span></div>` + (step.why ? `<div class="small">${md(step.why)}</div>` : ''));
    wireSpeak(el);
    speak(step.fr);
    btn.textContent = 'Continue'; btn.classList.replace('primary', 'accent');
    btn.onclick = () => done({ ok, result: ok ? 'ok' : 'wrong' });
  };
}

function dialogue(el, step, done) {
  el.innerHTML = `
    <div class="ex-kind">Dialogue</div>
    ${step.title ? `<h2>${esc(step.title)}</h2>` : ''}
    <div class="row" style="margin-bottom:8px"><button class="btn sm play-all">▶ Play all</button><label class="small muted" style="margin:0;font-weight:500"><input type="checkbox" class="show-en"> Show English</label></div>
    <div class="card dialogue">${step.lines.map(([who, fr, en], i) => `
      <div class="line"><span class="who">${esc(who)}</span><div style="flex:1"><div class="fr" style="font-weight:500">${esc(fr)}</div><div class="en muted small hidden">${esc(en)}</div></div>
      <button class="icon-btn" data-say="${esc(fr)}" data-voice="${i % 2 ? 'm' : 'f'}" aria-label="Listen">🔊</button></div>`).join('')}
    </div>
    <div class="row" style="margin-top:14px"><button class="btn accent block cont">Continue</button></div>`;
  wireSpeak(el);
  $('.show-en', el).onchange = e => $$('.en', el).forEach(x => x.classList.toggle('hidden', !e.target.checked));
  $('.play-all', el).onclick = async () => { for (const [i, [, fr]] of step.lines.entries()) await speak(fr, { voice: i % 2 ? 'm' : 'f' }); };
  $('.cont', el).onclick = () => done({ ok: true, skip: true });
}

function note(el, step, done) {
  el.innerHTML = `<div class="ex-kind">${esc(step.kind || 'Note')}</div><div class="card grammar">${step.html}</div>
    <div class="row" style="margin-top:14px"><button class="btn accent block cont">Continue</button></div>`;
  wireSpeak(el);
  $('.cont', el).onclick = () => done({ ok: true, skip: true });
}

export function grammarHTML(g) {
  return `<div class="grammar">${g.body}</div>
    ${g.examples?.length ? `<ul class="ex-list">${g.examples.map(([fr, en]) => `<li>${speakBtn(fr)}<div><div class="fr">${esc(fr)}</div><div class="en">${esc(en)}</div></div></li>`).join('')}</ul>` : ''}`;
}

function grammarCard(el, step, done) {
  const g = step.g;
  el.innerHTML = `<div class="ex-kind">Grammar</div><h2>${esc(g.title)}</h2><div class="card">${grammarHTML(g)}</div>
    <div class="row" style="margin-top:14px"><button class="btn accent block cont">Got it</button></div>`;
  wireSpeak(el);
  $('.cont', el).onclick = () => done({ ok: true, skip: true });
}

export function genderClass(v) { return v.g === 'm' ? 'gender-m' : v.g === 'f' ? 'gender-f' : ''; }

function learn(el, step, done) {
  const v = step.v;
  el.innerHTML = `
    <div class="ex-kind">New word</div>
    <div class="card">
      <div class="learn-word">${speakBtn(v.fr)}<div class="fr ${genderClass(v)}">${esc(v.fr)}</div></div>
      <div style="font-size:1.15rem;margin:10px 0 4px">${esc(v.en)}</div>
      ${v.note ? `<p class="small muted">${md(v.note)}</p>` : ''}
      ${v.ex ? `<hr style="margin:12px 0"><div class="row" style="flex-wrap:nowrap;align-items:flex-start">${speakBtn(v.ex)}<div><div class="fr" style="font-weight:500">${esc(v.ex)}</div><div class="muted small">${esc(v.exEn || '')}</div></div></div>` : ''}
    </div>
    ${v.g ? `<p class="small muted" style="margin-top:8px">${v.g === 'm' ? '<span class="gender-m">Blue</span> = masculine' : '<span class="gender-f">Red</span> = feminine'}</p>` : ''}
    <div class="row" style="margin-top:14px"><button class="btn accent block cont">Next</button></div>`;
  wireSpeak(el);
  setTimeout(() => speak(v.fr), 200);
  $('.cont', el).onclick = () => done({ ok: true, skip: true });
}
