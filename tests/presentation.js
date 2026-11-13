/* Test de « Présenter mon projet » (espace bénéficiaire) — réponses simulées, aucun appel réel à Supabase :
   1) accueil, catégorie non acceptée : bouton bleu « Présenter mon projet » sous le bouton vert « Ouvrir Ma catégorie » ;
   2) accueil, catégorie acceptée : carte « Votre présentation » avec le bouton bleu ;
   3) page : 11 rubriques, chacune avec une aide et un exemple ; 4 emplacements photo ;
   4) texte trop long : message, aucune demande envoyée ;
   5) enregistrement : texte et photo envoyés (dossier du bénéficiaire), message de confirmation ;
   6) nouvelle visite : les réponses et la photo enregistrées sont réaffichées ;
   7) aucune erreur JavaScript et aucun « undefined », « null » ou « NaN ».
   Usage :
     1) servir le dossier :  python3 -m http.server 8765   (depuis le dossier DarajaPlus)
     2) lancer le test   :  node tests/presentation.js     (variable BASE pour une autre adresse)
   Prérequis : Playwright avec Chromium installé. */

const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const SB = 'https://nfcfwvrllacpvlcsoycp.supabase.co';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const AGENT_ID = '33333333-3333-4333-8333-333333333333';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const BAD = /\b(undefined|null|NaN)\b/;
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SECTIONS = ['Titre', 'Problème', 'Solution', 'Produit ou service', 'Marché', 'Modèle économique', 'Concurrence', 'Go-to-market', 'Équipe', 'Demande', 'Vision et contact'];

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra ? '  [' + extra + ']' : ''));
}

function profile() {
  return { id: USER_ID, role: 'beneficiary', status: 'active', email: 'ben@test.local', nom: 'Test', postnom: 'Demo',
    prenom: 'Bénéf', phone: '+243800000000', photo_path: null, code: null, category: null, created_at: '2026-11-12T08:00:00Z' };
}
function ben(category) {
  return { id: 'b-1', user_id: USER_ID, nom: 'Test', postnom: 'Demo', prenom: 'Bénéf', phone: '+243800000000',
    email: 'ben@test.local', status: category ? 'active' : 'draft', category: category || null, code: category ? 'AH1A1Bg1Ba1' : null,
    agent_id: category ? AGENT_ID : null, host_id: null, sponsor_id: null, quartier_id: null, created_at: '2026-11-12T08:00:00Z' };
}

/* opts : { category, row } ; context.__state.row = fiche enregistrée (ou null) ; context.__log = requêtes */
async function openContext(browser, opts) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const state = { row: (opts && opts.row) || null };
  context.__state = state;
  context.__log = [];
  await context.addInitScript((s) => {
    try { localStorage.setItem('daraja.session.v1', JSON.stringify(s)); } catch (e) { /* ignoré */ }
  }, { access_token: 'test-token', refresh_token: 'test-refresh', expires_at: 4102444800, user: { id: USER_ID, email: 'ben@test.local' } });
  await context.route(SB + '/**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const m = req.method();
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    context.__log.push({ method: m, path: p, body: req.postData() || '' });
    const reply = (body) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/auth/v1/user') return reply({ id: USER_ID, email: 'ben@test.local', aud: 'authenticated' });
    if (p === '/rest/v1/profiles') return m === 'PATCH' ? reply([{}]) : reply([profile()]);
    if (p === '/rest/v1/beneficiaries') return reply([ben(opts && opts.category)]);
    if (p === '/rest/v1/rpc/beneficiary_category_state') return reply({});
    if (p === '/rest/v1/presentations') {
      if (m === 'GET') return reply(state.row ? [state.row] : []);
      if (m === 'PATCH') return reply(state.row ? [{}] : []);
      if (m === 'POST') {
        state.row = Object.assign({ user_id: USER_ID }, JSON.parse(req.postData() || '{}'));
        return reply([{}]);
      }
    }
    if (p.indexOf('/storage/v1/object/sign/') === 0) return reply({ signedURL: '/object/sign/visuels/photo.png?token=t' });
    if (p.indexOf('/storage/v1/object/visuels/') === 0) return reply({ Key: 'visuels' + p.slice('/storage/v1/object/visuels'.length) });
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
  await page.waitForTimeout(400);
  const text = await page.evaluate(() => (document.querySelector('#view') || document.body).innerText).catch(() => '');
  return { page, errors, text };
}

async function until(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText).catch(() => '');
}

(async () => {
  const browser = await chromium.launch();
  try {
    /* 1) Accueil : catégorie non acceptée */
    const c1 = await openContext(browser, { category: null });
    const h1 = await visit(c1, '#/espace');
    const blue1 = h1.page.locator('a.btn-blue[href="#/espace/presentation"]');
    /* Le bouton vert de la carte « Étape 1 » (et non le lien « Ma catégorie » des accès rapides) */
    const green1 = h1.page.locator('a.btn-primary:has-text("Ouvrir « Ma catégorie »")');
    check('accueil (catégorie non acceptée) : bouton bleu « Présenter mon projet » présent', (await blue1.count()) === 1);
    check('accueil : bouton bleu affiché sous le bouton vert « Ouvrir Ma catégorie »',
      (await blue1.count()) === 1 && (await green1.count()) === 1 &&
      (await blue1.boundingBox()).y > (await green1.boundingBox()).y);
    check('accueil : aucune erreur JavaScript', h1.errors.length === 0, h1.errors.join(' | '));
    check('accueil : aucun « undefined », « null » ou « NaN »', !BAD.test(h1.text));

    /* 2) Accueil : catégorie acceptée (la carte « Étape 1 » disparaît) */
    const c2 = await openContext(browser, { category: 'ba' });
    const h2 = await visit(c2, '#/espace');
    check('accueil (catégorie acceptée) : carte « Votre présentation » avec le bouton bleu',
      (await h2.page.locator('a.btn-blue[href="#/espace/presentation"]').count()) === 1 && h2.text.indexOf('Votre présentation') !== -1);

    /* 3) Page : rubriques, exemples, photos */
    const c3 = await openContext(browser, { category: 'ba' });
    const p3 = await visit(c3, '#/espace/presentation');
    const titlesOk = SECTIONS.every((label, i) => p3.text.indexOf((i + 1) + '. ' + label) !== -1);
    check('page : les 11 rubriques sont affichées dans l’ordre', titlesOk);
    check('page : un exemple (fictif) sous chaque rubrique', (await p3.page.locator('#f-pres .example').count()) === 11);
    check('page : 4 emplacements pour les photos', (await p3.page.locator('#f-pres [data-photo]').count()) === 4);
    check('page : aucune erreur JavaScript', p3.errors.length === 0, p3.errors.join(' | '));

    /* 4) Texte trop long */
    await p3.page.locator('#f-pres input[name="titre"]').fill('x'.repeat(130));
    await p3.page.locator('#f-pres button[type="submit"]').click();
    const tooLong = await until(async () => (await bodyText(p3.page)).indexOf('dépasse 120 caractères') !== -1, 5000);
    check('titre trop long : message affiché', tooLong);
    check('titre trop long : rien n’est envoyé', c3.__log.filter((e) => e.path === '/rest/v1/presentations' && e.method !== 'GET').length === 0);

    /* 5) Enregistrement avec une photo */
    await p3.page.locator('#f-pres input[name="titre"]').fill('Kiosque test');
    await p3.page.locator('#f-pres textarea[name="probleme"]').fill('Problème de recharge pour les commerçants.');
    await p3.page.locator('#pres-photo-0 [data-photo-input]').setInputFiles({ name: 'prototype.png', mimeType: 'image/png', buffer: TINY_PNG });
    await p3.page.locator('#f-pres button[type="submit"]').click();
    const saved = await until(async () => (await bodyText(p3.page)).indexOf('Présentation enregistrée') !== -1, 15000);
    check('enregistrement : message de confirmation affiché', saved);
    const writes = c3.__log.filter((e) => e.path === '/rest/v1/presentations' && (e.method === 'POST' || e.method === 'PATCH'));
    check('enregistrement : la fiche est envoyée à la base', writes.length >= 1, writes.map((w) => w.method).join(','));
    const withText = writes.filter((w) => w.body.indexOf('Kiosque test') !== -1 && w.body.indexOf('Problème de recharge') !== -1);
    check('enregistrement : les réponses sont dans la fiche', withText.length >= 1);
    check('enregistrement : la photo est rangée dans le dossier du bénéficiaire',
      withText.length >= 1 && withText[withText.length - 1].body.indexOf('"photos":["' + USER_ID + '/photo-') !== -1);
    check('enregistrement : aucune erreur JavaScript', p3.errors.length === 0, p3.errors.join(' | '));

    /* 6) Nouvelle visite : les réponses et la photo sont réaffichées */
    const p6 = await visit(c3, '#/espace/presentation');
    const titreValue = await p6.page.locator('#f-pres input[name="titre"]').inputValue().catch(() => '');
    check('nouvelle visite : le titre enregistré est réaffiché', titreValue === 'Kiosque test', titreValue);
    check('nouvelle visite : la photo enregistrée est réaffichée', (await p6.page.locator('#pres-photo-0 img').count()) >= 1);
    check('nouvelle visite : aucune erreur JavaScript', p6.errors.length === 0, p6.errors.join(' | '));
    check('nouvelle visite : aucun « undefined », « null » ou « NaN »', !BAD.test(p6.text));
  } catch (e) {
    failures++;
    console.log('FAIL exception : ' + (e && e.message ? e.message : e));
  } finally {
    await browser.close();
  }
  console.log(failures ? failures + ' contrôle(s) en échec.' : 'Tous les contrôles sont passés.');
  process.exit(failures ? 1 : 0);
})();
