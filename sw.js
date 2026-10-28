// Offline support. App files and course content: network first, cache fallback.
// Audio and fonts: cache first (they never change once published).
const VERSION = 'erb1-v1';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/srs.js', 'js/speech.js', 'js/sync.js', 'js/content.js', 'js/exercises.js',
  'content/course.json', 'content/civics.json',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    // Pre-cache every published unit so lessons work offline.
    try {
      const course = await (await fetch('content/course.json')).json();
      const units = course.months.flatMap(m => m.weeks).filter(w => w.unit).map(w => `content/units/${w.unit}.json`);
      await cache.addAll(units);
      const audio = await fetch('content/audio/index.json');
      if (audio.ok) await cache.put('content/audio/index.json', audio);
    } catch { /* offline install: shell only */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'api.github.com') return; // sync traffic: never cache
  const cacheFirst = /\/content\/audio\/.+\.mp3$/.test(url.pathname) || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  e.respondWith(cacheFirst ? fromCache(e.request) : fromNetwork(e.request));
});

async function fromCache(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') (await caches.open(VERSION)).put(req, res.clone());
  return res;
}

async function fromNetwork(req) {
  try {
    const res = await fetch(req);
    if (res.ok && new URL(req.url).origin === location.origin) (await caches.open(VERSION)).put(req, res.clone());
    return res;
  } catch {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return caches.match('index.html');
    throw new Error('offline');
  }
}
