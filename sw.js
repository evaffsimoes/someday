const CACHE_NAME = 'cue-v13';
const SHARE_CACHE = 'someday-shared-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(['/', '/index.html', '/manifest.json'])));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (url.pathname.endsWith('/share-target')) {
    e.respondWith(handleShareTarget(e));
    return;
  }

  e.respondWith(caches.match(e.request).then((res) => res || fetch(e.request)));
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
