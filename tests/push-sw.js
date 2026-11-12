/* Test des gestionnaires du service worker pour les notifications sur téléphone :
   - « push » : affiche une alerte générique (titre DarajaPlus, texte général, lien vers les notifications) ;
   - « notificationclick » : ouvre l’application sur la page des notifications (ou la met au premier plan).
   Le fichier sw.js est chargé dans un environnement contrôlé : aucun navigateur ni réseau n’est nécessaire.
   Usage : node tests/push-sw.js */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCOPE = 'http://127.0.0.1:8765/';
const TARGET = SCOPE + '#/notifications';
const GENERIC = { title: 'DarajaPlus', body: 'Vous avez une nouvelle notification.' };

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra ? '  [' + extra + ']' : ''));
}

function loadWorker(clients) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  const handlers = {};
  const shown = [];
  const opened = [];
  const self = {
    location: { origin: SCOPE.slice(0, -1), href: SCOPE + 'sw.js' },
    registration: { scope: SCOPE, showNotification: (title, options) => { shown.push({ title, options }); return Promise.resolve(); } },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: () => Promise.resolve(),
    clients: {
      claim: () => Promise.resolve(),
      matchAll: async () => clients,
      openWindow: async (url) => { opened.push(url); }
    }
  };
  vm.runInNewContext(src, { self, URL, Promise, console, caches: {}, fetch: () => Promise.reject(new Error('hors ligne')) }, { filename: 'sw.js' });
  return { handlers, shown, opened };
}

async function testPush() {
  // 1) Message reçu avec le contenu générique.
  let w = loadWorker([]);
  let waited = null;
  w.handlers.push({
    data: { json: () => ({ title: 'DarajaPlus', body: 'Vous avez une nouvelle notification.', url: './#/notifications' }) },
    waitUntil: (p) => { waited = p; }
  });
  await waited;
  const a = w.shown[0];
  check('push : alerte générique affichée (titre et texte)', !!a && a.title === GENERIC.title && a.options.body === GENERIC.body, a ? a.title + ' / ' + a.options.body : 'aucune alerte');
  check('push : lien de l’alerte vers la page des notifications', !!a && a.options.data.url === './#/notifications');
  check('push : alerte remplacée si une autre arrive (même étiquette)', !!a && a.options.tag === 'daraja-notification' && a.options.renotify === true);

  // 2) Message sans contenu : on affiche quand même l’alerte générique.
  w = loadWorker([]);
  waited = null;
  w.handlers.push({ data: null, waitUntil: (p) => { waited = p; } });
  await waited;
  check('push sans contenu : alerte générique de secours', w.shown[0] && w.shown[0].title === 'DarajaPlus' && w.shown[0].options.body === GENERIC.body);

  // 3) Contenu illisible : même comportement.
  w = loadWorker([]);
  waited = null;
  w.handlers.push({ data: { json: () => { throw new SyntaxError('invalide'); } }, waitUntil: (p) => { waited = p; } });
  await waited;
  check('push illisible : alerte générique de secours', w.shown[0] && w.shown[0].options.body === GENERIC.body);
}

async function testClick() {
  // 4) Aucune fenêtre ouverte : ouverture de la page des notifications.
  let w = loadWorker([]);
  let closed = false;
  let waited = null;
  w.handlers.notificationclick({
    notification: { close: () => { closed = true; }, data: { url: './#/notifications' } },
    waitUntil: (p) => { waited = p; }
  });
  await waited;
  check('clic : l’alerte se referme', closed === true);
  check('clic sans fenêtre ouverte : ouverture de la page des notifications', w.opened[0] === TARGET, w.opened[0]);

  // 5) Application déjà ouverte : mise au premier plan et navigation vers les notifications.
  let navigated = null;
  let focused = false;
  const existing = {
    url: SCOPE + '#/mon-compte',
    focus: () => { focused = true; return Promise.resolve({ navigate: async (u) => { navigated = u; } }); }
  };
  w = loadWorker([existing]);
  waited = null;
  w.handlers.notificationclick({
    notification: { close: () => {}, data: { url: './#/notifications' } },
    waitUntil: (p) => { waited = p; }
  });
  await waited;
  check('clic avec application ouverte : fenêtre mise au premier plan', focused === true);
  check('clic avec application ouverte : navigation vers les notifications', navigated === TARGET, navigated);
  check('clic avec application ouverte : pas de nouvelle fenêtre', w.opened.length === 0);
}

(async () => {
  await testPush();
  await testClick();
  console.log(failures ? failures + ' vérification(s) en échec' : 'Tous les gestionnaires du service worker sont vérifiés.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
