const CACHE_NAME = 'drugcopeia-ai-shell-v203';
const APP_SHELL = ['./', './index.html', './styles.css?v=203', './ai-shell.css?v=203', './boot-theme.js?v=203', './sw-register.js?v=203', './ai-boot.js?v=203', './ai-extras.js?v=203', './ai-shell.js?v=203', './generated/privacy-config.js?v=203', './net.js?v=203', './core.js?v=203', './lab-tests.js?v=203', './clinical-tools.js?v=203', './reading.js?v=203', './news.js?v=203', './news.json', './app.js?v=203', './alt-map.js?v=203', './same-spec.js?v=203', './features.js?v=203', './assets/data/pregnancy-safety.json', './ai/text.js?v=203', './ai/search-index.js?v=203', './ai/safety.js?v=203', './ai/retrieval.js?v=203', './ai/llm-bridge.js?v=203', './ai/wasm-bridge.js?v=203', './ai/model-manager.js?v=203', './ai/pipeline.js?v=203', './ai/secure-history.js?v=203', './ai/photo-ask.js?v=203', './ai/chat-ui.js?v=203', './assets/ai/model-config.json', './assets/ai/policy-config.json', './assets/ai/messages-ar.json', './assets/ai/messages-en.json', './assets/ai/dataset-meta.json', './assets/ai/prompts/system-ar.txt', './assets/ai/prompts/system-en.txt', './assets/ai/prompts/chat-ar.txt', './assets/ai/prompts/chat-en.txt', './assets/ai/prompts/classifier.txt', './manifest.webmanifest', './assets/red-crescent-rx-96.png', './assets/red-crescent-rx-192.png', './assets/red-crescent-rx-512.png', './assets/red-crescent-rx-dark-96.png', './assets/red-crescent-rx-dark-192.png', './assets/barcode-index.json', './assets/lab-tests-content.json', './assets/conditions.json', './assets/monographs.json', './assets/egyptian-drugs.json?v=203', './assets/dawaya-mark.svg', './assets/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('drugcopeia-ai-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

// Only the app's own static files are cached. A request that carries a query
// string other than the asset revision (a search, a lookup, anything that could
// describe what the reader is doing) is never written to disk.
function isShellAsset(url) {
  if (url.origin !== self.location.origin) return false;
  return url.search === '' || /^\?v=\d+$/.test(url.search);
}

// Look only in this app's own cache. The original Drugcopeia app shares this
// origin and must never be read from or written to here.
function ownMatch(request, options) {
  return caches.open(CACHE_NAME).then(cache => cache.match(request, options));
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!isShellAsset(url) || event.request.method !== 'GET') return;
  event.respondWith(ownMatch(event.request).then(cached => cached || ownMatch(event.request, { ignoreSearch: true })).then(cached => cached || fetch(event.request).then(response => {
    if (response.status === 200 && response.type === 'basic') {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => event.request.mode === 'navigate' ? ownMatch('./index.html') : Response.error())));
});
