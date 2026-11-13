/* Test de « Présenter mon projet » (espace bénéficiaire) — réponses simulées, aucun appel réel à Supabase :
   1) accueil, catégorie non acceptée : bouton bleu « Présenter mon projet » sous le bouton vert « Ouvrir Ma catégorie » ;
   2) accueil, catégorie acceptée : carte « Votre présentation » avec le bouton bleu ;
   3) page : 11 rubriques, chacune avec une aide et un exemple ; 4 emplacements photo ;
   4) titre trop long : message, aucune demande envoyée ;
   5) « Enregistrer comme brouillon » : texte et photo envoyés (dossier du bénéficiaire), statut « brouillon » ;
   6) « Publier » incomplet : refusé, les rubriques manquantes sont nommées, rien n’est envoyé ;
   7) « Publier » complet : statut « publiée » envoyé, bannière « Publiée le » à la nouvelle visite ;
   8) nouvelle visite : les réponses et la photo enregistrées sont réaffichées ;
   9) aucune erreur JavaScript et aucun « undefined », « null » ou « NaN ».
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
const REPONSES = {
  solution: 'Un kiosque solaire loue des batteries chargées.',
  produit: 'Prototype en bois, testé pendant un mois.',
  marche: 'TAM : 40 000 commerçants. SAM : 8 000. SOM : 800 clients.',
  modele: 'Location à l’heure et abonnement mensuel.',
  concurrence: 'Les groupes électrogènes coûtent plus cher.',
  go_to_market: 'Partenariat avec trois marchés.',
  equipe: 'Nous sommes trois.',
  demande: '3 000 USD pour dix kiosques.',
  vision: 'Dans trois ans : quarante kiosques dans deux villes.'
};

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
      if (m === 'PATCH') {
        /* Comme la base : la mise à jour fusionne les champs, et la date de publication suit le statut. */
        if (!state.row) return reply([]);
        const patch = JSON.parse(req.postData() || '{}');
        state.row = Object.assign({}, state.row, patch);
        if (patch.statut === 'publiee') state.row.publiee_at = '2026-11-13T09:00:00Z';
        return reply([state.row]);
      }
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
    check('page : deux boutons, « Enregistrer comme brouillon » et « Publier »',
      (await p3.page.locator('#f-pres button[data-cible="brouillon"]').count()) === 1 &&
      (await p3.page.locator('#f-pres button[data-cible="publiee"]').count()) === 1);
    check('page : aucune erreur JavaScript', p3.errors.length === 0, p3.errors.join(' | '));

    /* 4) Titre trop long */
    await p3.page.locator('#f-pres input[name="titre"]').fill('x'.repeat(130));
    await p3.page.locator('#f-pres button[data-cible="brouillon"]').click();
    const tooLong = await until(async () => (await bodyText(p3.page)).indexOf('dépasse 120 caractères') !== -1, 5000);
    check('titre trop long : message affiché', tooLong);
    check('titre trop long : rien n’est envoyé', c3.__log.filter((e) => e.path === '/rest/v1/presentations' && e.method !== 'GET').length === 0);

    /* 5) Enregistrement comme brouillon, avec une photo */
    await p3.page.locator('#f-pres input[name="titre"]').fill('Kiosque test');
    await p3.page.locator('#f-pres textarea[name="probleme"]').fill('Problème de recharge pour les commerçants.');
    await p3.page.locator('#pres-photo-0 [data-photo-input]').setInputFiles({ name: 'prototype.png', mimeType: 'image/png', buffer: TINY_PNG });
    await p3.page.locator('#f-pres button[data-cible="brouillon"]').click();
    const saved = await until(async () => (await bodyText(p3.page)).indexOf('Brouillon enregistré') !== -1, 15000);
    check('brouillon : message de confirmation affiché', saved);
    const writes = c3.__log.filter((e) => e.path === '/rest/v1/presentations' && (e.method === 'POST' || e.method === 'PATCH'));
    check('brouillon : la fiche est envoyée à la base', writes.length >= 1, writes.map((w) => w.method).join(','));
    const withText = writes.filter((w) => w.body.indexOf('Kiosque test') !== -1 && w.body.indexOf('Problème de recharge') !== -1);
    check('brouillon : les réponses sont dans la fiche', withText.length >= 1);
    const dernier = withText.length ? withText[withText.length - 1].body : '';
    check('brouillon : statut « brouillon » envoyé', dernier.indexOf('"statut":"brouillon"') !== -1);
    check('brouillon : la photo est rangée dans le dossier du bénéficiaire', dernier.indexOf('"photos":["' + USER_ID + '/photo-') !== -1);
    check('brouillon : aucune erreur JavaScript', p3.errors.length === 0, p3.errors.join(' | '));

    /* 6) Publication incomplète : refusée, les rubriques manquantes sont nommées, rien n’est envoyé */
    const avant = c3.__log.length;
    await p3.page.locator('#f-pres button[data-cible="publiee"]').click();
    const refus = await until(async () => (await bodyText(p3.page)).indexOf('Pour publier, remplissez encore') !== -1, 5000);
    check('publier incomplet : message avec les rubriques manquantes', refus);
    check('publier incomplet : rien n’est envoyé', c3.__log.slice(avant).filter((e) => e.method !== 'GET').length === 0);

    /* 7) Publication complète */
    for (const k of Object.keys(REPONSES)) {
      await p3.page.locator('#f-pres textarea[name="' + k + '"]').fill(REPONSES[k]);
    }
    await p3.page.locator('#f-pres button[data-cible="publiee"]').click();
    const publie = await until(async () => (await bodyText(p3.page)).indexOf('Présentation publiée') !== -1, 15000);
    check('publier complet : message de confirmation affiché', publie);
    const pub = c3.__log.filter((e) => e.path === '/rest/v1/presentations' && e.method === 'PATCH' && e.body.indexOf('"statut":"publiee"') !== -1);
    check('publier complet : statut « publiee » envoyé', pub.length >= 1);
    check('publier complet : les rubriques sont envoyées', pub.length >= 1 && pub[pub.length - 1].body.indexOf('quarante kiosques') !== -1);

    /* 8) Nouvelle visite : les réponses, la photo et la bannière « Publiée » sont réaffichées */
    const p8 = await visit(c3, '#/espace/presentation');
    const titreValue = await p8.page.locator('#f-pres input[name="titre"]').inputValue().catch(() => '');
    check('nouvelle visite : le titre enregistré est réaffiché', titreValue === 'Kiosque test', titreValue);
    check('nouvelle visite : la photo enregistrée est réaffichée', (await p8.page.locator('#pres-photo-0 img').count()) >= 1);
    check('nouvelle visite : bannière « Publiée le » affichée', p8.text.indexOf('Publiée le') !== -1);
    check('nouvelle visite : aucune erreur JavaScript', p8.errors.length === 0, p8.errors.join(' | '));
    check('nouvelle visite : aucun « undefined », « null » ou « NaN »', !BAD.test(p8.text));
  } catch (e) {
    failures++;
    console.log('FAIL exception : ' + (e && e.message ? e.message : e));
  } finally {
    await browser.close();
  }
  console.log(failures ? failures + ' contrôle(s) en échec.' : 'Tous les contrôles sont passés.');
  process.exit(failures ? 1 : 0);
})();
