// sw.js — ZERO DAY · MUSIC EXPLOITS
// Service worker único para los 5 instrumentos (SPEC R2). Vive en la raíz
// del sitio y se registra desde cada descargable como:
//   navigator.serviceWorker.register('../sw.js', { scope: '../' })
// así su scope queda en /instruments/ sin importar desde qué instrumento
// se registre primero. Ojo: ese es el scope del SERVICE WORKER. El scope de
// cada manifest es otra cosa y es el de su propio archivo (manifests/*.webmanifest,
// "scope": "../descargables/<Archivo>.html"): si compartieran "../", en Android
// la app instalada de uno capturaba los links a los otros 4. Ver docs/pwa.md
// para eso, las condiciones de activación (bloque zd-pwa) y el contrato del
// postMessage de "nueva versión".
//
// No cachea descargables-zeroday.zip a propósito: es pesado, cambia cuando
// cambia cualquier instrumento y no hace falta offline.

const VERSION = 'zd-v7';
const CACHE_NAME = `zd-cache-${VERSION}`;

const PRECACHE_URLS = [
  'descargables/Acid_Bass-303.html',
  'descargables/CronBeat-808.html',
  'descargables/J4-Sirens_Station.html',
  'descargables/MonoMoon70.html',
  'descargables/Nebularp_2035.html',

  'manifests/acid-bass.webmanifest',
  'manifests/cronbeat.webmanifest',
  'manifests/j4-sirens.webmanifest',
  'manifests/monomoon.webmanifest',
  'manifests/nebularp.webmanifest',

  'icons/acid-bass-192.png',
  'icons/acid-bass-512.png',
  'icons/acid-bass-512-maskable.png',
  'icons/acid-bass-apple-touch-180.png',
  'icons/cronbeat-192.png',
  'icons/cronbeat-512.png',
  'icons/cronbeat-512-maskable.png',
  'icons/cronbeat-apple-touch-180.png',
  'icons/j4-sirens-192.png',
  'icons/j4-sirens-512.png',
  'icons/j4-sirens-512-maskable.png',
  'icons/j4-sirens-apple-touch-180.png',
  'icons/monomoon-192.png',
  'icons/monomoon-512.png',
  'icons/monomoon-512-maskable.png',
  'icons/monomoon-apple-touch-180.png',
  'icons/nebularp-192.png',
  'icons/nebularp-512.png',
  'icons/nebularp-512-maskable.png',
  'icons/nebularp-apple-touch-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('zd-cache-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
      .then(() => notifyClients())
  );
});

async function notifyClients() {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'zd-sw-updated', version: VERSION });
  }
}

function isHTMLRequest(request) {
  if (request.mode === 'navigate') return true;
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/html');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('.zip')) return; // nunca cachear el ZIP

  if (isHTMLRequest(request)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    return Response.error();
  }
}
