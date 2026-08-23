const CACHE_NAME = 'someday-static-v1';
const SHARE_CACHE = 'someday-shared-v1';

const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.pathname.includes('share-target')) {
    event.respondWith(handleShareTarget(event));
    return;
  }

  if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});

async function handleShareTarget(event) {
  try {
    const formData = await event.request.formData();
    const file = formData.get('images');
    const text = formData.get('text') || '';
    const urlParam = formData.get('url') || '';
    const title = formData.get('title') || '';
    const base = event.request.url.split('share-target')[0];

    if (file && file.size > 0) {
      const cache = await caches.open(SHARE_CACHE);
      await cache.put('shared-image', new Response(file));
      return Response.redirect(base + 'index.html?shared=1', 303);
    }

    const combinedText = [title, text, urlParam].filter(Boolean).join(' ');
    if (combinedText) {
      return Response.redirect(base + 'index.html?text=' + encodeURIComponent(combinedText), 303);
    }

    return Response.redirect(base + 'index.html', 303);
  } catch (err) {
    const base = event.request.url.split('share-target')[0];
    return Response.redirect(base + 'index.html', 303);
  }
}
