// Progress sync through a private GitHub Gist.
// The token lives only in this browser's localStorage. It is never written to the repo.
import { get, replace, merge, onChange, flush } from './store.js';

const TOKEN_KEY = 'erb1.ghToken';
const GIST_KEY = 'erb1.gistId';
const FILE = 'en-route-b1-progress.json';
const DESC = 'En route B1 — progress (do not edit)';
const API = 'https://api.github.com';

let status = 'off';           // off | idle | syncing | error | offline
const statusListeners = new Set();
export const onStatus = fn => (statusListeners.add(fn), fn(status), () => statusListeners.delete(fn));
function setStatus(s, detail) { status = s; statusListeners.forEach(fn => fn(s, detail)); }

function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
function gistId() { try { return localStorage.getItem(GIST_KEY) || ''; } catch { return ''; } }
export const isConnected = () => !!token();

async function gh(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!r.ok) {
    const msg = r.status === 401 ? 'Token rejected (401). Check it has the Gists permission.' :
      r.status === 404 ? 'Gist not found (404).' : `GitHub error ${r.status}`;
    const err = new Error(msg); err.status = r.status; throw err;
  }
  return r.status === 204 ? null : r.json();
}

async function findOrCreateGist() {
  let id = gistId();
  if (id) return id;
  for (let page = 1; page <= 5; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    const hit = list.find(g => g.files && g.files[FILE]);
    if (hit) { id = hit.id; break; }
    if (list.length < 100) break;
  }
  if (!id) {
    const created = await gh('/gists', {
      method: 'POST',
      body: JSON.stringify({ description: DESC, public: false, files: { [FILE]: { content: JSON.stringify(get()) } } }),
    });
    id = created.id;
  }
  localStorage.setItem(GIST_KEY, id);
  return id;
}

async function readRemote(id) {
  const g = await gh(`/gists/${id}`);
  const f = g.files?.[FILE];
  if (!f) return null;
  let text = f.content;
  if (f.truncated && f.raw_url) {
    const r = await fetch(f.raw_url);
    text = await r.text();
  }
  try { return JSON.parse(text); } catch { return null; }
}

let busy = false, pending = false;
export async function syncNow() {
  if (!token()) { setStatus('off'); return; }
  if (!navigator.onLine) { setStatus('offline'); return; }
  if (busy) { pending = true; return; }
  busy = true; setStatus('syncing');
  try {
    const id = await findOrCreateGist();
    const remote = await readRemote(id);
    const merged = remote ? merge(get(), remote) : get();
    replaceQuiet(merged);
    await gh(`/gists/${id}`, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(merged) } } }) });
    lastSync = Date.now();
    setStatus('idle');
  } catch (e) {
    if (e.status === 404) localStorage.removeItem(GIST_KEY);
    setStatus('error', e.message);
  } finally {
    busy = false;
    if (pending) { pending = false; setTimeout(syncNow, 500); }
  }
}

let suppress = false;
function replaceQuiet(next) { suppress = true; replace(next); flush(); suppress = false; }

export let lastSync = 0;

export async function connect(tok) {
  localStorage.setItem(TOKEN_KEY, tok.trim());
  localStorage.removeItem(GIST_KEY);
  await syncNow();
  if (status === 'error') throw new Error('Could not sync with that token.');
}

export function disconnect() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(GIST_KEY);
  setStatus('off');
}

// Auto-sync: on start, when a change settles, when the tab hides, and every 5 min.
let debounce;
export function startAutoSync() {
  if (!token()) { setStatus('off'); return; }
  syncNow();
  onChange(reason => {
    if (suppress || reason === 'tick') return;
    clearTimeout(debounce);
    debounce = setTimeout(syncNow, 20000);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { flush(); syncNow(); }
    else if (Date.now() - lastSync > 60000) syncNow();
  });
  addEventListener('online', syncNow);
  setInterval(syncNow, 5 * 60000);
}
