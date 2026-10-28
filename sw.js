// Rondje! — service worker (sinds v1.57.0).
// Doel: de app moet ook opstarten als er op de baan even geen bereik is.
// Werkwijze "eerst het netwerk": met bereik krijg je altijd de nieuwste versie
// van de app (net als voorheen) en wordt er stilletjes een kopie bewaard. Lukt
// het netwerk niet (of duurt het langer dan 6 seconden), dan gebruikt hij die
// bewaarde kopie. Gegevens uit de database (Supabase) worden NOOIT bewaard:
// die gaan altijd rechtstreeks naar het netwerk.
const CACHE = 'rondje-app-v1';
const WACHTTIJD_MS = 6000;

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const namen = await caches.keys();
    await Promise.all(namen.filter(n => n.startsWith('rondje-') && n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

function magBewaren(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return false;
  // De app zelf (zelfde website) en de vaste bibliotheken (Supabase-client, PDF).
  return url.origin === self.location.origin || url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'cdnjs.cloudflare.com';
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!magBewaren(request)) { event.respondWith(fetch(request)); return; }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const netwerk = fetch(request).then(antwoord => {
      if (antwoord && antwoord.ok) cache.put(request, antwoord.clone()).catch(() => {});
      return antwoord;
    });
    try {
      return await Promise.race([
        netwerk,
        new Promise((_, nee) => setTimeout(() => nee(new Error('te traag')), WACHTTIJD_MS))
      ]);
    } catch (e) {
      const bewaard = await cache.match(request, { ignoreSearch: request.mode === 'navigate' })
        || (request.mode === 'navigate' ? (await cache.match('./') || await cache.match('./index.html')) : null);
      if (bewaard) return bewaard;
      // Niets bewaard: dan toch op het netwerk wachten (als dat er nog aankomt).
      return netwerk;
    }
  })());
});
