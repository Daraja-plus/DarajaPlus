/* Test de la localisation obligatoire (province, puis ville ou village).
   Réponses simulées, aucun appel réel à Supabase :
   1) inscription : menu des 26 provinces, type ville/village et nom présents ;
   2) inscription sans province : message, aucune demande d'inscription envoyée ;
   3) inscription complète : la localisation part avec la demande ;
   4) compte actif sans localisation : l'espace renvoie vers « Mon compte » avec le bandeau ;
   5) compte en attente sans localisation : « en attente » renvoie aussi vers « Mon compte » ;
   6) Mon compte : localisation partielle refusée, aucune écriture envoyée ;
   7) Mon compte : localisation complète enregistrée, puis retour vers l'espace ;
   8) pages publiques (contact) accessibles sans localisation ;
   9) aucune erreur JavaScript et aucun « undefined », « null » ou « NaN ».
   Usage :
     1) servir le dossier :  python3 -m http.server 8765   (depuis le dossier DarajaPlus)
     2) lancer le test   :  node tests/localisation.js     (variable BASE pour une autre adresse)
   Prérequis : Playwright avec Chromium installé. */

const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const SB = 'https://nfcfwvrllacpvlcsoycp.supabase.co';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const BAD = /\b(undefined|null|NaN)\b/;

function profileSansLocalisation(extra) {
  return Object.assign({
    id: USER_ID, role: 'beneficiary', status: 'active', email: 'ben@test.local',
    nom: 'Test', postnom: 'Demo', prenom: 'Bénéf', phone: '+243800000000', photo_path: null,
    code: 'AH1A1Bb1', category: 'bb', created_at: '2026-11-12T08:00:00Z',
    province: null, localite_type: null, localite_nom: null
  }, extra || {});
}

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra ? '  [' + extra + ']' : ''));
}

/* profile : ligne renvoyée pour le compte connecté ; une écriture (PATCH) la met à jour, comme la base. */
async function openContext(browser, userId, profile) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.__log = [];
  const state = { profile: profile ? Object.assign({}, profile) : null };
  if (userId) {
    await context.addInitScript((s) => {
      try { localStorage.setItem('daraja.session.v1', JSON.stringify(s)); } catch (e) { /* ignoré */ }
    }, { access_token: 'test-token', refresh_token: 'test-refresh', expires_at: 4102444800, user: { id: userId, email: 'ben@test.local' } });
  }
  await context.route(SB + '/**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const m = req.method();
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    context.__log.push({ method: m, path: p, body: req.postData() || '' });
    const reply = (body) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/auth/v1/user') return reply({ id: userId, email: 'ben@test.local', aud: 'authenticated' });
    if (p === '/auth/v1/signup') return reply({});
    if (p === '/rest/v1/profiles') {
      if (m === 'PATCH') {
        if (state.profile) Object.assign(state.profile, JSON.parse(req.postData() || '{}'));
        return reply([{}]);
      }
      return reply(userId && state.profile ? [state.profile] : []);
    }
    if (p.indexOf('/rest/v1/rpc/') === 0) return reply({});
    return reply([]);
  });
  return context;
}

async function visit(context, hash) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await page.goto(BASE + hash, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const v = document.querySelector('#view') || document.body;
    return v.innerText.trim().length > 60;
  }, null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
  const text = await bodyText(page);
  return { page, errors, text };
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText).catch(() => '');
}

async function hashOf(page) {
  return page.evaluate(() => location.hash).catch(() => '');
}

/* Garde dans la page chaque notification dès son apparition : elle ne peut plus disparaître avant le contrôle. */
async function garderNotifications(page) {
  await page.evaluate(() => {
    window.__notifs = [];
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType === 1 && n.classList && n.classList.contains('toast')) window.__notifs.push(n.textContent);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  });
}

async function notificationAttendue(page, regex) {
  return page.waitForFunction((src) => new RegExp(src).test(window.__notifs.join(' | ')), regex.source, { timeout: 15000 }).then(() => true, () => false);
}

async function until(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function remplirInscription(page) {
  await page.locator('input[name="nom"]').fill('Test');
  await page.locator('input[name="postnom"]').fill('Demo');
  await page.locator('input[name="prenom"]').fill('Bénéf');
  await page.locator('input[name="email"]').fill('nouveau@test.local');
  await page.locator('input[name="password"]').fill('motdepasse1');
  await page.locator('input[name="confirm"]').fill('motdepasse1');
  await page.locator('#f-consent').check();
}

(async () => {
  const browser = await chromium.launch();
  try {
    /* 1) Inscription : champs présents */
    const v = await openContext(browser, null, null);
    const ins = await visit(v, '#/inscription');
    const provinces = await ins.page.locator('select[name="province"] option').evaluateAll((opts) => opts.filter((o) => o.value).length);
    check('inscription : menu des 26 provinces', provinces === 26, String(provinces));
    check('inscription : choix ville ou village présent', (await ins.page.locator('select[name="localite_type"]').count()) === 1);
    check('inscription : nom de la ville ou du village présent', (await ins.page.locator('input[name="localite_nom"]').count()) === 1);

    /* 2) Inscription sans province : refusée, aucune demande envoyée */
    await remplirInscription(ins.page);
    await ins.page.locator('input[name="localite_nom"]').fill('Kikwit');
    await ins.page.locator('select[name="localite_type"]').selectOption('village');
    /* Le message reste 4,3 s : il est gardé dans la page dès son apparition (voir garderNotifications). */
    await garderNotifications(ins.page);
    await ins.page.locator('#f-signup button[type="submit"]').click();
    const refusee = await notificationAttendue(ins.page, /Choisissez votre province/);
    check('sans province : message affiché', refusee);
    check('sans province : aucune demande d’inscription envoyée', v.__log.filter((e) => e.path === '/auth/v1/signup').length === 0);

    /* 3) Inscription complète : la localisation part avec la demande */
    await ins.page.locator('select[name="province"]').selectOption('Kwilu');
    await ins.page.locator('#f-signup button[type="submit"]').click();
    const envoyee = await until(async () => v.__log.some((e) => e.path === '/auth/v1/signup'), 8000);
    const corps = (v.__log.find((e) => e.path === '/auth/v1/signup') || {}).body || '';
    check('inscription complète : demande envoyée', envoyee);
    check('inscription complète : province transmise', corps.indexOf('"province":"Kwilu"') !== -1);
    check('inscription complète : ville ou village et nom transmis', corps.indexOf('"localite_type":"village"') !== -1 && corps.indexOf('"localite_nom":"Kikwit"') !== -1);

    /* 4) Compte actif sans localisation : l'espace renvoie vers Mon compte */
    const a = await openContext(browser, USER_ID, profileSansLocalisation());
    const espace = await visit(a, '#/espace');
    const renvoye = await espace.page.waitForFunction(() => location.hash.indexOf('mon-compte') !== -1, null, { timeout: 20000 }).then(() => true, () => false);
    check('compte actif sans localisation : renvoyé vers Mon compte', renvoye, await hashOf(espace.page));
    check('compte actif sans localisation : message « Complétez votre profil » affiché', /Complétez votre profil/.test(espace.text));

    /* 5) Compte en attente sans localisation : la page « en attente » renvoie aussi vers Mon compte */
    const e = await openContext(browser, USER_ID, profileSansLocalisation({ status: 'pending' }));
    const attente = await visit(e, '#/en-attente');
    const renvoyeAttente = await attente.page.waitForFunction(() => location.hash.indexOf('mon-compte') !== -1, null, { timeout: 20000 }).then(() => true, () => false);
    check('compte en attente sans localisation : renvoyé vers Mon compte', renvoyeAttente, await hashOf(attente.page));

    /* 6) Mon compte : localisation partielle refusée, aucune écriture */
    const p1 = await openContext(browser, USER_ID, profileSansLocalisation());
    const mc = await visit(p1, '#/mon-compte?localisation=1');
    /* Attendre que la page soit stable (rendus tardifs terminés) avant de remplir le formulaire. */
    await mc.page.waitForLoadState('networkidle').catch(() => {});
    await mc.page.waitForTimeout(500);
    await mc.page.locator('#f-loc select[name="province"]').selectOption('Kinshasa');
    await mc.page.locator('#f-loc select[name="localite_type"]').selectOption('ville');
    await garderNotifications(mc.page);
    await mc.page.locator('#f-loc button[type="submit"]').click();
    const sansNom = await notificationAttendue(mc.page, /Indiquez le nom de votre ville ou de votre village/);
    check('localisation partielle : message affiché', sansNom);
    check('localisation partielle : aucune écriture envoyée', p1.__log.filter((x) => x.method === 'PATCH' && x.path === '/rest/v1/profiles').length === 0);

    /* 7) Mon compte : localisation complète enregistrée, puis retour vers l'espace */
    await mc.page.locator('#f-loc input[name="localite_nom"]').fill('Gombe');
    await mc.page.locator('#f-loc button[type="submit"]').click();
    const ecrite = await until(async () => p1.__log.some((x) => x.method === 'PATCH' && x.path === '/rest/v1/profiles'), 8000);
    const patch = (p1.__log.find((x) => x.method === 'PATCH' && x.path === '/rest/v1/profiles') || {}).body || '';
    check('localisation complète : écriture envoyée', ecrite);
    check('localisation complète : province, type et nom transmis',
      patch.indexOf('"province":"Kinshasa"') !== -1 && patch.indexOf('"localite_type":"ville"') !== -1 && patch.indexOf('"localite_nom":"Gombe"') !== -1);
    const retour = await mc.page.waitForFunction(() => location.hash.indexOf('mon-compte') === -1, null, { timeout: 20000 }).then(() => true, () => false);
    check('localisation complète : retour vers l’espace', retour, await hashOf(mc.page));
    const bandeauParti = await mc.page.waitForFunction(() => !/Complétez votre profil/.test(document.body.innerText), null, { timeout: 15000 }).then(() => true, () => false);
    check('localisation complète : bandeau disparu', bandeauParti);

    /* 8) Pages publiques accessibles sans localisation */
    const q = await openContext(browser, USER_ID, profileSansLocalisation());
    const contact = await visit(q, '#/contact');
    await new Promise((r) => setTimeout(r, 500));
    check('page publique (contact) accessible sans localisation', (await hashOf(contact.page)).indexOf('contact') !== -1, await hashOf(contact.page));

    /* 9) Erreurs JavaScript et textes parasites */
    const toutes = [ins, espace, attente, mc, contact];
    const erreurs = toutes.reduce((n, x) => n + x.errors.length, 0);
    check('aucune erreur JavaScript', erreurs === 0, String(erreurs));
    check('aucun « undefined », « null » ou « NaN » affiché', !toutes.some((x) => BAD.test(x.text)));
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? '\nTous les contrôles sont passés.' : '\n' + failures + ' contrôle(s) en échec.');
  process.exit(failures === 0 ? 0 : 1);
})();
