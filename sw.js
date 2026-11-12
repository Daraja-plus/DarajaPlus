/* DarajaPlus — service de cache de l'application.
   Objectif : l'application s'ouvre même avec une connexion faible ou coupée.
   Les données (Supabase et autres services externes) ne sont jamais mises en cache : elles restent en ligne. */

const CACHE = 'daraja-app-v1';
const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/config.js',
  'js/api.js',
  'js/ui.js',
  'js/app.js',
  'js/categories.js',
  'js/public.js',
  'js/admin.js',
  'js/host-agent.js',
  'js/beneficiary.js',
  'js/partner.js',
  'assets/logo-daraja.png',
  'assets/affiche-daraja-plus.webp',
  'assets/icon-192.png',
  'assets/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(SHELL); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* Page principale : en ligne d'abord (version la plus récente), sinon la copie enregistrée. */
function networkFirst(req) {
  return fetch(req)
    .then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    })
    .catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match('index.html'); });
    });
}

/* Fichiers de l'application (CSS, JavaScript, images) : affichage immédiat depuis la copie,
   puis mise à jour en arrière-plan pour la visite suivante. */
function staleWhileRevalidate(req) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(function () { return hit; });
      return hit || network;
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  /* Supabase et les autres services : pas de cache. */
  if (url.origin !== self.location.origin) return;

  var isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  event.respondWith(isPage ? networkFirst(req) : staleWhileRevalidate(req));
});
