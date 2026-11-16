/* Test de « Présenter mon projet » (espace bénéficiaire) — réponses simulées, aucun appel réel à Supabase :
   Une présentation par projet : elle s'ouvre depuis « Mes projets et besoins » (#/espace/presentation/<projet>).
   1) accueil, catégorie non acceptée : bouton bleu « Présenter mon projet » sous le bouton vert « Ouvrir Ma catégorie » ;
   2) accueil, catégorie acceptée : carte « Vos projets et leurs présentations » avec le bouton bleu « Présenter mon projet » ;
   3) présentation du projet : 11 rubriques, chacune avec une aide et un exemple ; 4 emplacements photo ;
   4) titre trop long : message, aucune demande envoyée ;
   5) « Enregistrer comme brouillon » : texte et photo envoyés (dossier du bénéficiaire), statut « brouillon » ;
   6) « Publier » incomplet : refusé, les rubriques manquantes sont nommées, rien n’est envoyé ;
   7) « Publier » complet : statut « publiée » envoyé, bannière « Publiée le » à la nouvelle visite ;
   8) nouvelle visite : les réponses et la photo enregistrées sont réaffichées ;
   9) aucune erreur JavaScript et aucun « undefined », « null » ou « NaN » ;
   10) « Présenter mon projet » : montant obligatoire, puis création du projet (fonction de la base) et redirection ;
   11) « Présenter mon projet » reprend une présentation rédigée sans projet ; la liste des projets le signale (12).
   Usage :
     1) servir le dossier :  python3 -m http.server 8765   (depuis le dossier DarajaPlus)
     2) lancer le test   :  node tests/presentation.js     (variable BASE pour une autre adresse)
   Prérequis : Playwright avec Chromium installé. */

const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const SB = 'https://nfcfwvrllacpvlcsoycp.supabase.co';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const AGENT_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
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

function projet(category) {
  return { id: PROJECT_ID, beneficiary_id: 'b-1', created_by: USER_ID, title: 'Kiosque solaire', sector: 'énergie',
    description: null, use_of_funds: null, amount: 3000, currency: 'USD', due_date: null, establishment_id: null,
    status: category ? 'ready' : 'draft', created_at: '2026-11-13T08:00:00Z' };
}

/* opts : { category, row } ; context.__state.row = présentation enregistrée du projet (ou null) ; context.__log = requêtes */
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
    if (p === '/rest/v1/projects') return reply([projet(opts && opts.category)]);
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
    if (p === '/rest/v1/rpc/presentation_enregistrer') {
      /* Comme la base : le projet est créé (ou modifié) et sa présentation enregistrée en une seule opération. */
      const b = JSON.parse(req.postData() || '{}');
      state.row = Object.assign({}, state.row || {}, { user_id: USER_ID, project_id: PROJECT_ID, content: b.p_content,
        photos: b.p_photos, statut: b.p_statut, updated_at: '2026-11-13T09:00:00Z' });
      if (b.p_statut === 'publiee') state.row.publiee_at = '2026-11-13T09:00:00Z';
      return reply(PROJECT_ID);
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
    const blue1 = h1.page.locator('a.btn-blue[href="#/espace/presentation/nouveau"]');
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
    check('accueil (catégorie acceptée) : carte « Vos projets et leurs présentations » avec le bouton bleu « Présenter mon projet »',
      (await h2.page.locator('a.btn-blue[href="#/espace/presentation/nouveau"]').count()) === 1 && h2.text.indexOf('Vos projets et leurs présentations') !== -1);

    /* 3) Présentation du projet : rubriques, exemples, photos */
    const c3 = await openContext(browser, { category: 'ba' });
    const p3 = await visit(c3, '#/espace/presentation/' + PROJECT_ID);
    check('présentation : le titre affiche le nom du projet', p3.text.indexOf('Présentation : Kiosque solaire') !== -1);
    const titlesOk = SECTIONS.every((label, i) => p3.text.indexOf((i + 1) + '. ' + label) !== -1);
    check('page : les 11 rubriques sont affichées dans l’ordre', titlesOk);
    check('page : un exemple (fictif) sous chaque rubrique', (await p3.page.locator('#f-pres .example').count()) === 11);
    check('page : 4 emplacements pour les photos', (await p3.page.locator('#f-pres [data-photo]').count()) === 4);
    check('page : deux boutons, « Enregistrer comme brouillon » et « Publier »',
      (await p3.page.locator('#f-pres button[data-cible="brouillon"]').count()) === 1 &&
      (await p3.page.locator('#f-pres button[data-cible="publiee"]').count()) === 1);
    check('page : aucune erreur JavaScript', p3.errors.length === 0, p3.errors.join(' | '));

    /* 3 bis) « Le besoin » : montant, devise, secteur, échéance, entreprise, description, utilisation des fonds */
    check('page : « Le besoin » affiché avec le montant du projet', (await p3.page.locator('#f-pres input[name="amount"]').inputValue()) === '3000');
    check('page : « Le besoin » : tous les champs du projet présents',
      (await p3.page.locator('#f-pres select[name="currency"]').count()) === 1 &&
      (await p3.page.locator('#f-pres input[name="sector"]').count()) === 1 &&
      (await p3.page.locator('#f-pres input[name="due_date"]').count()) === 1 &&
      (await p3.page.locator('#f-pres select[name="establishment_id"]').count()) === 1 &&
      (await p3.page.locator('#f-pres textarea[name="description"]').count()) === 1 &&
      (await p3.page.locator('#f-pres textarea[name="use_of_funds"]').count()) === 1);

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
    const writes = c3.__log.filter((e) => e.path === '/rest/v1/rpc/presentation_enregistrer');
    check('brouillon : le projet et sa fiche sont enregistrés par une seule fonction de la base', writes.length >= 1, writes.length + ' appel(s)');
    const directes = c3.__log.filter((e) => e.path === '/rest/v1/presentations' && e.method !== 'GET');
    check('brouillon : aucune écriture directe dans presentations', directes.length === 0);
    const withText = writes.filter((w) => w.body.indexOf('Kiosque test') !== -1 && w.body.indexOf('Problème de recharge') !== -1);
    check('brouillon : les réponses sont dans la fiche', withText.length >= 1);
    check('brouillon : la fiche est rattachée au projet', withText.length >= 1 && withText[withText.length - 1].body.indexOf('"p_projet":"' + PROJECT_ID + '"') !== -1);
    const dernier = withText.length ? withText[withText.length - 1].body : '';
    check('brouillon : statut « brouillon » envoyé', dernier.indexOf('"p_statut":"brouillon"') !== -1);
    check('brouillon : la photo est rangée dans le dossier du bénéficiaire', dernier.indexOf('"p_photos":["' + USER_ID + '/photo-') !== -1);
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
    const pub = c3.__log.filter((e) => e.path === '/rest/v1/rpc/presentation_enregistrer' && e.body.indexOf('"p_statut":"publiee"') !== -1);
    check('publier complet : statut « publiee » envoyé', pub.length >= 1);
    check('publier complet : les rubriques sont envoyées', pub.length >= 1 && pub[pub.length - 1].body.indexOf('quarante kiosques') !== -1);

    /* 8) Nouvelle visite : les réponses, la photo et la bannière « Publiée » sont réaffichées */
    const p8 = await visit(c3, '#/espace/presentation/' + PROJECT_ID);
    const titreValue = await p8.page.locator('#f-pres input[name="titre"]').inputValue().catch(() => '');
    check('nouvelle visite : le titre enregistré est réaffiché', titreValue === 'Kiosque test', titreValue);
    check('nouvelle visite : la photo enregistrée est réaffichée', (await p8.page.locator('#pres-photo-0 img').count()) >= 1);
    check('nouvelle visite : bannière « Publiée le » affichée', p8.text.indexOf('Publiée le') !== -1);
    check('nouvelle visite : aucune erreur JavaScript', p8.errors.length === 0, p8.errors.join(' | '));
    check('nouvelle visite : aucun « undefined », « null » ou « NaN »', !BAD.test(p8.text));

    /* 9) Liste des projets : le projet affiche sa présentation et un lien « Modifier » */
    const p9 = await visit(c3, '#/espace/projets');
    const lien9 = p9.page.locator('a[href="#/espace/presentation/' + PROJECT_ID + '"]');
    check('liste des projets : le lien vers la présentation du projet est présent', (await lien9.count()) === 1);
    check('liste des projets : l’état « Publiée, à vérifier » est affiché', p9.text.indexOf('Publiée, à vérifier') !== -1);
    check('liste des projets : plus de formulaire « Nouveau projet ou besoin »',
      (await p9.page.locator('#f-proj').count()) === 0 && p9.text.indexOf('Nouveau projet ou besoin') === -1);
    check('liste des projets : bouton « Présenter mon projet » présent',
      (await p9.page.locator('a.btn-primary[href="#/espace/presentation/nouveau"]').count()) >= 1);
    check('liste des projets : aucune erreur JavaScript', p9.errors.length === 0, p9.errors.join(' | '));
    /* 10) « Présenter mon projet » : montant obligatoire, puis création du projet et redirection vers sa présentation */
    const c10 = await openContext(browser, { category: 'ba' });
    const p10 = await visit(c10, '#/espace/presentation/nouveau');
    check('nouveau : titre « Présenter mon projet »', p10.text.indexOf('Présenter mon projet') !== -1);
    check('nouveau : champs « Montant nécessaire » et « Devise » présents',
      (await p10.page.locator('#f-pres input[name="amount"]').count()) === 1 && (await p10.page.locator('#f-pres select[name="currency"]').count()) === 1);
    check('nouveau : aucune erreur JavaScript', p10.errors.length === 0, p10.errors.join(' | '));
    await p10.page.locator('#f-pres input[name="titre"]').fill('Kiosque test');
    await p10.page.locator('#f-pres button[data-cible="brouillon"]').click();
    const sansMontant = await until(async () => (await bodyText(p10.page)).indexOf('Le montant doit être supérieur à 0') !== -1, 5000);
    check('nouveau : montant vide refusé', sansMontant);
    check('nouveau : montant vide, rien n’est envoyé', c10.__log.filter((e) => e.path === '/rest/v1/rpc/presentation_enregistrer').length === 0);
    await p10.page.locator('#f-pres input[name="amount"]').fill('2500');
    await p10.page.locator('#f-pres button[data-cible="brouillon"]').click();
    const cree = await until(async () => p10.page.url().indexOf('#/espace/presentation/' + PROJECT_ID) !== -1, 15000);
    check('nouveau : après enregistrement, redirection vers la présentation du projet créé', cree, p10.page.url());
    const appel = c10.__log.filter((e) => e.path === '/rest/v1/rpc/presentation_enregistrer');
    check('nouveau : un seul appel de la fonction d’enregistrement', appel.length === 1);
    const corps = appel.length ? appel[0].body : '';
    check('nouveau : création (pas de projet existant à modifier)', corps.indexOf('"p_projet":null') !== -1, corps.slice(0, 120));
    check('nouveau : montant, devise et statut envoyés',
      corps.indexOf('"p_amount":2500') !== -1 && corps.indexOf('"p_currency":"USD"') !== -1 && corps.indexOf('"p_statut":"brouillon"') !== -1, corps.slice(0, 200));
    check('nouveau : titre envoyé dans le contenu', corps.indexOf('Kiosque test') !== -1);
    check('nouveau : aucune écriture directe dans presentations', c10.__log.filter((e) => e.path === '/rest/v1/presentations' && e.method !== 'GET').length === 0);

    /* 11) « Présenter mon projet » reprend une présentation rédigée sans projet (avant le montant) */
    const c11 = await openContext(browser, { category: 'ba', row: { user_id: USER_ID, project_id: null, statut: 'publiee',
      publiee_at: '2026-11-12T09:00:00Z', content: { titre: 'Projet en attente', probleme: 'Problème de test.' }, photos: [] } });
    const p11 = await visit(c11, '#/espace/presentation/nouveau');
    const titre11 = await p11.page.locator('#f-pres input[name="titre"]').inputValue().catch(() => '');
    check('nouveau (présentation en attente) : le titre déjà rédigé est repris', titre11 === 'Projet en attente', titre11);
    check('nouveau (présentation en attente) : message « sera reprise »', p11.text.indexOf('sera reprise pour ce projet') !== -1);
    check('nouveau (présentation en attente) : aucune erreur JavaScript', p11.errors.length === 0, p11.errors.join(' | '));

    /* 12) Liste des projets : une présentation sans projet demande le montant */
    const p12 = await visit(c11, '#/espace/projets');
    check('liste des projets : présentation sans projet signalée', p12.text.indexOf('Une présentation attend son projet') !== -1);
    check('liste des projets : lien « Indiquez le montant demandé » vers la création',
      (await p12.page.locator('a[href="#/espace/presentation/nouveau"]').count()) >= 1);
    check('liste des projets (présentation en attente) : aucune erreur JavaScript', p12.errors.length === 0, p12.errors.join(' | '));
  } catch (e) {
    failures++;
    console.log('FAIL exception : ' + (e && e.message ? e.message : e));
  } finally {
    await browser.close();
  }
  console.log(failures ? failures + ' contrôle(s) en échec.' : 'Tous les contrôles sont passés.');
  process.exit(failures ? 1 : 0);
})();
