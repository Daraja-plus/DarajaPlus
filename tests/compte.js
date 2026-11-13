/* Test de « Mon compte » (changement d’adresse e-mail) et de l’adresse officielle (page Contact).
   Réponses simulées, aucun appel réel à Supabase :
   1) Mon compte : rubrique « Adresse e-mail » présente, adresse actuelle affichée, mot de passe toujours présent ;
   2) adresse invalide : message, aucune demande envoyée ;
   3) même adresse que l’actuelle : message, aucune demande envoyée ;
   4) adresse valide : une seule demande de changement envoyée, message de confirmation ;
   5) page Contact : adresse officielle affichée en lien « mailto » ;
   6) aucune erreur JavaScript et aucun « undefined », « null » ou « NaN ».
   Usage :
     1) servir le dossier :  python3 -m http.server 8765   (depuis le dossier DarajaPlus)
     2) lancer le test   :  node tests/compte.js           (variable BASE pour une autre adresse)
   Prérequis : Playwright avec Chromium installé. */

const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const SB = 'https://nfcfwvrllacpvlcsoycp.supabase.co';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const AGENT_ID = '33333333-3333-4333-8333-333333333333';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const BAD = /\b(undefined|null|NaN)\b/;
const OFFICIAL = 'darajaplus1@gmail.com';

const PROFILE = {
  id: USER_ID, role: 'beneficiary', status: 'active', email: 'ben@test.local',
  nom: 'Test', postnom: 'Demo', prenom: 'Bénéf', phone: '+243800000000', photo_path: null,
  code: 'AH1A1Bg1Ba1', category: 'ba', created_at: '2026-11-12T08:00:00Z'
};
const BEN = {
  id: 'b-1', user_id: USER_ID, nom: 'Test', postnom: 'Demo', prenom: 'Bénéf', phone: '+243800000000',
  email: 'ben@test.local', status: 'active', category: 'ba', code: 'AH1A1Bg1Ba1', agent_id: AGENT_ID, host_id: AGENT_ID,
  sponsor_id: null, quartier_id: null, created_at: '2026-11-12T08:00:00Z'
};

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra ? '  [' + extra + ']' : ''));
}

/* userId null = visiteur sans session */
async function openContext(browser, userId) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.__log = [];
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
    if (p === '/rest/v1/profiles') return m === 'PATCH' ? reply([{}]) : reply(userId ? [PROFILE] : []);
    if (p === '/rest/v1/beneficiaries') return reply(userId ? [BEN] : []);
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

async function until(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function isEmailChange(entry) {
  return entry.method === 'PUT' && entry.path === '/auth/v1/user' && entry.body.indexOf('"email"') !== -1;
}

(async () => {
  const browser = await chromium.launch();
  try {
    /* 1) Mon compte : rubrique « Adresse e-mail » */
    const ctx = await openContext(browser, USER_ID);
    const mc = await visit(ctx, '#/mon-compte');
    const page = mc.page;
    check('mon compte : rubrique « Adresse e-mail » présente', (await page.locator('#f-email').count()) === 1);
    check('mon compte : adresse actuelle affichée', mc.text.indexOf('ben@test.local') !== -1);
    check('mon compte : l’e-mail n’est plus dans « Informations »', !/Adresse e-mail : /.test(mc.text));
    check('mon compte : changement de mot de passe toujours présent', (await page.locator('#f-pw').count()) === 1);

    /* 2) adresse invalide */
    await page.locator('#f-email input[name="email"]').fill('pas-un-courriel');
    await page.locator('#f-email button[type="submit"]').click();
    const invalid = await until(async () => /Adresse e-mail invalide/.test(await bodyText(page)), 5000);
    check('e-mail invalide : message affiché', invalid);
    check('e-mail invalide : aucune demande envoyée', ctx.__log.filter(isEmailChange).length === 0);

    /* 3) même adresse que l’actuelle */
    await page.locator('#f-email input[name="email"]').fill('ben@test.local');
    await page.locator('#f-email button[type="submit"]').click();
    const same = await until(async () => /déjà la vôtre/.test(await bodyText(page)), 5000);
    check('même adresse : message affiché', same);
    check('même adresse : aucune demande envoyée', ctx.__log.filter(isEmailChange).length === 0);

    /* 4) adresse valide */
    await page.locator('#f-email input[name="email"]').fill('nouveau@test.local');
    await page.locator('#f-email button[type="submit"]').click();
    const sent = await until(async () => /lien de confirmation/.test(await bodyText(page)), 8000);
    check('adresse valide : message de confirmation affiché', sent);
    const changes = ctx.__log.filter(isEmailChange);
    check('adresse valide : une seule demande de changement envoyée', changes.length === 1, String(changes.length));
    check('adresse valide : la demande contient la nouvelle adresse', changes.length === 1 && changes[0].body.indexOf('nouveau@test.local') !== -1);
    const mcText = await bodyText(page);
    check('mon compte : aucune erreur JavaScript', mc.errors.length === 0, mc.errors.join(' | '));
    check('mon compte : aucun « undefined », « null » ou « NaN »', !BAD.test(mcText));

    /* 5) page Contact : adresse officielle */
    const anon = await openContext(browser, null);
    const ct = await visit(anon, '#/contact');
    const mailLinks = await ct.page.locator('a[href="mailto:' + OFFICIAL + '"]').count();
    check('contact : adresse officielle affichée en lien « mailto »', mailLinks >= 1, OFFICIAL);
    check('contact : aucune erreur JavaScript', ct.errors.length === 0, ct.errors.join(' | '));
    check('contact : aucun « undefined », « null » ou « NaN »', !BAD.test(ct.text));
  } catch (e) {
    failures++;
    console.log('FAIL exception : ' + (e && e.message ? e.message : e));
  } finally {
    await browser.close();
  }
  console.log(failures ? failures + ' contrôle(s) en échec.' : 'Tous les contrôles sont passés.');
  process.exit(failures ? 1 : 0);
})();
