// Service worker: torna o app instalável e garante que sempre abre a versão mais nova do site
// (pergunta ao servidor a cada abertura; se não mudou, o servidor responde rápido "igual").
// Os documentos nunca são guardados no aparelho.
// v2
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r, { cache: 'no-cache' }).catch(() => fetch(r)));
});
