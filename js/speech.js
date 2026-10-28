// Audio: pre-generated neural MP3s when available, device French voice otherwise.
// Speech recognition: Web Speech API (Chrome, Edge, Safari, Android).
import { get } from './store.js';

let manifest = null;   // text -> file
let current = null;

export async function loadAudioManifest() {
  try {
    const r = await fetch('content/audio/index.json', { cache: 'no-cache' });
    if (r.ok) manifest = await r.json();
  } catch { manifest = null; }
}

export function audioKey(text) { return String(text).replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim(); }

export function hasRecorded(text) { return !!manifest?.[audioKey(text)]; }

export function stop() {
  if (current) { current.pause(); current = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

// opts: { slow: bool, voice: 'f' | 'm' }
export function speak(text, opts = {}) {
  stop();
  const rate = (opts.slow ? 0.7 : 1) * (get().settings.rate || 1);
  const entry = manifest?.[audioKey(text)];
  if (entry) {
    const file = typeof entry === 'string' ? entry : (opts.voice === 'm' && entry.m) || entry.f || entry.m;
    if (file) {
      return new Promise(resolve => {
        const a = new Audio(`content/audio/${file}`);
        a.playbackRate = rate; a.preservesPitch = true;
        a.onended = a.onerror = () => resolve();
        current = a;
        a.play().catch(() => { speakTTS(text, rate, opts).then(resolve); });
      });
    }
  }
  return speakTTS(text, rate, opts);
}

let voices = [];
function loadVoices() { voices = ('speechSynthesis' in window) ? speechSynthesis.getVoices().filter(v => /^fr(-|_|$)/i.test(v.lang)) : []; }
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

export function frenchVoices() { loadVoices(); return voices; }

function pickVoice(pref) {
  if (!voices.length) loadVoices();
  const chosen = get().settings.voice;
  if (chosen) { const v = voices.find(v => v.name === chosen); if (v) return v; }
  const frFR = voices.filter(v => /fr[-_]FR/i.test(v.lang));
  const pool = frFR.length ? frFR : voices;
  const ranked = [...pool].sort((a, b) => score(b) - score(a));
  if (pref === 'm') return ranked.find(v => /thomas|henri|paul|daniel|male|homme/i.test(v.name)) || ranked[0];
  return ranked[0];
  function score(v) {
    let s = 0;
    if (/natural|neural|online|premium|enhanced/i.test(v.name)) s += 5;
    if (/google/i.test(v.name)) s += 3;
    if (/amélie|amelie|audrey|denise|marie|thomas/i.test(v.name)) s += 2;
    if (v.localService) s += 1;
    return s;
  }
}

function speakTTS(text, rate, opts) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    const v = pickVoice(opts.voice);
    if (v) u.voice = v;
    u.rate = rate;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

// --- Recognition ----------------------------------------------------------------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!SR;

// Returns { stop(), promise } — promise resolves to transcript ('' if nothing heard).
export function listen() {
  if (!SR) return { stop() {}, promise: Promise.reject(new Error('unsupported')) };
  stop();
  const rec = new SR();
  rec.lang = 'fr-FR';
  rec.interimResults = false;
  rec.maxAlternatives = 3;
  rec.continuous = false;
  let finalText = '';
  const promise = new Promise((resolve, reject) => {
    rec.onresult = e => {
      const alts = [...e.results[e.results.length - 1]].map(a => a.transcript);
      finalText = alts[0] || '';
      rec._alts = alts;
    };
    rec.onerror = e => (e.error === 'no-speech' || e.error === 'aborted') ? resolve({ text: '', alts: [] }) : reject(e);
    rec.onend = () => resolve({ text: finalText, alts: rec._alts || [] });
  });
  try { rec.start(); } catch (e) { return { stop() {}, promise: Promise.reject(e) }; }
  return { stop: () => { try { rec.stop(); } catch { } }, promise };
}
