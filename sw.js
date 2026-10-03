// Rondje! — minimale service worker.
// Bestaat alleen om de app op Android installeerbaar te maken (Chrome eist een
// service worker met een fetch-handler). Er wordt bewust NIETS gecachet: elk
// verzoek gaat gewoon naar het netwerk, zodat een nieuwe versie van de app
// nooit achter een oude, gecachte kopie blijft hangen.
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (event) => { event.respondWith(fetch(event.request)); });
