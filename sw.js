/* GCS offline start: keeps a copy of the app page (index.html) so it opens with no signal.
   Network first, so when there is signal the newest page always wins and publishing a new version still updates phones.
   If the network fails, or takes more than 4 seconds and a saved copy exists, the saved copy is used. With no saved copy it keeps waiting for the network.
   Only the app page is handled. card.html, the flows and everything else go straight to the network.
   To switch this off: put tools/sw-off.js in place of this file and publish. Phones then remove the worker and its saved copy the next time they open the app online.
   (Deleting this file is NOT enough: phones keep the worker they already have.) */
var CACHE = 'gcs-app-shell-1', SLOW_MS = 4000;
function pageKey() { return new URL('index.html', self.registration.scope).href; }
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  var scope = new URL(self.registration.scope).pathname;
  if (url.pathname !== scope && url.pathname !== scope + 'index.html') return;
  function keep(res) {                                                       // only a plain page from our own site is worth keeping
    if (!(res.ok && res.type === 'basic' && !res.redirected)) return Promise.resolve();
    return caches.open(CACHE).then(function (c) { return c.put(pageKey(), res); }).catch(function () {});
  }
  e.respondWith((function () {
    var net = fetch(req);
    var settled = net.then(function (res) { return { res: res }; }, function () { return { failed: true }; });
    var slow = new Promise(function (resolve) { setTimeout(function () { resolve({ slow: true }); }, SLOW_MS); });
    return Promise.race([settled, slow]).then(function (first) {
      if (first.res) { e.waitUntil(keep(first.res.clone())); return first.res; }
      return caches.match(pageKey()).then(function (hit) {
        if (hit) {
          if (first.slow) e.waitUntil(settled.then(function (late) { return late.res ? keep(late.res) : null; }));   // the late answer still refreshes the saved copy
          return hit;                                                         // network failed or is slow, and a saved copy exists
        }
        return first.slow ? net : Response.error();                           // nothing saved: keep waiting for a slow network
      });
    });
  })());
});
