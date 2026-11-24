/* Cultidelta · Localitzador Solsó — service worker
 * Permet obrir el localitzador sense cobertura:
 *  - La pàgina (index.html): primer la xarxa, i si no respon en 4 s o no hi ha connexió, la còpia guardada.
 *    Així, amb cobertura sempre es veu la versió nova.
 *  - Foto aèria, icones i manifest: es serveixen de la còpia i s'actualitzen en segon pla.
 *  - Llibreries de Firebase i tipografies: es guarden la primera vegada (tenen URL amb versió).
 *  - Les dades de Firebase (base de dades i sessió de Google) NO passen per aquí: les gestiona la pàgina.
 * En publicar una versió nova de l'app, cal canviar VERSIO perquè es renovi la còpia.
 */
const VERSIO = 'solso-v5.29';
const INDEX = new URL('./index.html', self.registration.scope).href;

const PROPIS = ['./', './index.html', './orto.jpg', './manifest.json', './icon-192.png', './icon-512.png']
  .map(u => new URL(u, self.registration.scope).href);
const EXTERNS = [
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Jost:wght@300;400;500;600;700&display=swap'
];
const HOSTS_ESTATICS = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSIO);
    // Cada fitxer per separat: si un no existeix (p. ex. icon-512.png), la resta es guarda igualment
    await Promise.allSettled([
      ...PROPIS.map(async u => {
        const r = await fetch(u, {cache: 'reload'});
        if (r.ok) await c.put(u === PROPIS[0] ? INDEX : u, r);
      }),
      ...EXTERNS.map(async u => {
        const r = await fetch(u, {mode: 'no-cors'});
        if (r.ok || r.type === 'opaque') await c.put(u, r);
      })
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const claus = await caches.keys();
    await Promise.all(claus.filter(k => k.startsWith('solso-') && k !== VERSIO).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Pàgina: xarxa primer (amb límit de temps), còpia si no hi ha cobertura. Serveix també els enllaços dels QR (?s=...)
  if (req.mode === 'navigate' || (url.origin === location.origin && /\/(index\.html)?$/.test(url.pathname))) {
    e.respondWith(pagina(req, e));
    return;
  }
  // Fitxers propis (foto aèria, icones, manifest): còpia primer i actualització en segon pla
  if (url.origin === location.origin) {
    e.respondWith(copiaIActualitza(req, e));
    return;
  }
  // Llibreries i tipografies externes: còpia si n'hi ha; si no, xarxa i es guarda
  if (HOSTS_ESTATICS.includes(url.hostname)) {
    e.respondWith(copiaPrimer(req));
  }
  // La resta (base de dades de Firebase, sessió de Google...) va directament a la xarxa
});

async function pagina(req, e) {
  const c = await caches.open(VERSIO);
  const xarxa = fetch(req.url, {cache: 'no-cache', credentials: 'same-origin'})
    .then(r => { if (r.ok) c.put(INDEX, r.clone()); return r; });
  e.waitUntil(xarxa.catch(() => {}));
  const copia = await c.match(INDEX);
  if (!copia) return xarxa; // primera visita: no hi ha alternativa
  const espera = new Promise(res => setTimeout(() => res(null), 4000));
  try {
    const r = await Promise.race([xarxa, espera]);
    return r && r.ok ? r : copia;
  } catch (err) {
    return copia;
  }
}

async function copiaIActualitza(req, e) {
  const c = await caches.open(VERSIO);
  const copia = await c.match(req, {ignoreSearch: true});
  const xarxa = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; });
  if (copia) { e.waitUntil(xarxa.catch(() => {})); return copia; }
  return xarxa;
}

async function copiaPrimer(req) {
  const c = await caches.open(VERSIO);
  const copia = await c.match(req);
  if (copia) return copia;
  const r = await fetch(req);
  if (r.ok || r.type === 'opaque') c.put(req, r.clone());
  return r;
}
