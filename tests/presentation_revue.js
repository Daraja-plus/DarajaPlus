/* Test des présentations côté administrateur et partenaire — réponses simulées, aucun appel réel à Supabase :
   A) administrateur : lien « Présentations » dans le menu ; liste avec le statut « À vérifier » ;
      ouverture de la fiche (11 rubriques) ; « Rendre visible aux partenaires » après confirmation ;
      envoi de la visibilité à la base ;
   B) partenaire : bouton « Voir la présentation » seulement si la fiche est visible ; fiche ouverte avec les 11 rubriques ;
   C) aucune erreur JavaScript et aucun « undefined », « null » ou « NaN ».
   Usage :
     1) servir le dossier :  python3 -m http.server 8765   (depuis le dossier DarajaPlus)
     2) lancer le test   :  node tests/presentation_revue.js   (variable BASE pour une autre adresse)
   Prérequis : Playwright avec Chromium installé. */

const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const SB = 'https://nfcfwvrllacpvlcsoycp.supabase.co';
const NOW = '2026-11-13T09:00:00Z';
const ADMIN_ID = '66666666-6666-4666-8666-666666666666';
const BEN_ID = '22222222-2222-4222-8222-222222222222';
const PARTNER_ID = '55555555-5555-4555-8555-555555555555';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS' };
const BAD = /\b(undefined|null|NaN)\b/;

const CONTENU = {
  titre: 'Kiosque test',
  probleme: 'Problème de recharge pour les commerçants.',
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

const PROFILES = [
  { id: ADMIN_ID, role: 'admin', status: 'active', prenom: 'Admin', nom: 'Test', email: 'admin@test.local', code: 'ADM' },
  { id: BEN_ID, role: 'beneficiary', status: 'active', prenom: 'Bénéf', nom: 'Test', email: 'ben@test.local', identifiant: 'AH1A1Bb1', category: 'bb' },
  { id: PARTNER_ID, role: 'partner', status: 'active', prenom: 'Partenaire', nom: 'Test', email: 'part@test.local' }
];

/* Filtres PostgREST simplifiés : seul « eq. » est géré ; select, order et limit sont ignorés. */
function filtrer(rows, params) {
  let out = rows.slice();
  params.forEach(function (val, col) {
    if (['select', 'order', 'limit', 'offset'].indexOf(col) !== -1) return;
    if (val.indexOf('eq.') === 0) {
      const v = val.slice(3);
      out = out.filter(function (r) { return String(r[col]) === v; });
    }
  });
  return out;
}

async function openContext(browser, role, opts) {
  const me = PROFILES.find(function (p) { return p.role === role; });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.__log = [];
  await context.addInitScript((s) => {
    try { localStorage.setItem('daraja.session.v1', JSON.stringify(s)); } catch (e) { /* ignoré */ }
  }, { access_token: 'test-token', refresh_token: 'test-refresh', expires_at: 4102444800, user: { id: me.id, email: me.email } });
  await context.route(SB + '/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const m = req.method();
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    context.__log.push({ method: m, path: p, body: req.postData() || '' });
    const reply = (body) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/auth/v1/user') return reply({ id: me.id, email: me.email, aud: 'authenticated' });
    if (p === '/rest/v1/profiles') return reply(filtrer(PROFILES, url.searchParams));
    if (p === '/rest/v1/partners') return reply([{ id: PARTNER_ID, profile_id: PARTNER_ID, legal_name: 'Banque Test', category: 'institution_financiere', status: 'active', created_at: NOW }]);
    if (p === '/rest/v1/presentations' && m === 'GET') {
      return reply([{ user_id: BEN_ID, statut: 'publiee', content: CONTENU, photos: [], publiee_at: NOW, visible_at: null, updated_at: NOW, created_at: NOW }]);
    }
    if (p === '/rest/v1/rpc/admin_set_presentation_visibility') return reply('visible');
    if (p === '/rest/v1/rpc/partner_available_projects') {
      return reply([{ project_id: 'p-1', reference: 'p-1', title: 'Achat de matériel', sector: 'Commerce', description: 'Description du projet',
        use_of_funds: 'Stock', amount: 1500, currency: 'USD', due_date: '2027-03-01', status: 'ready', created_at: NOW,
        beneficiary_identifiant: 'AH1A1Bb1', category: 'bb', establishment_name: 'Kiosque', establishment_sector: 'Commerce',
        establishment_description: null, establishment_services: null, photos: [], connection_status: null,
        presentation_visible: !!(opts && opts.visible) }]);
    }
    if (p === '/rest/v1/rpc/partner_presentation') return reply({ content: CONTENU, photos: [], visible_at: NOW });
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
    /* A) Administrateur */
    const ca = await openContext(browser, 'admin');
    const va = await visit(ca, '#/admin/presentations');
    check('admin : lien « Présentations » dans le menu', (await va.page.locator('a[href="#/admin/presentations"]').count()) >= 1);
    check('admin : liste avec l’identifiant du bénéficiaire et le statut « À vérifier »',
      va.text.indexOf('AH1A1Bb1') !== -1 && va.text.indexOf('À vérifier') !== -1);
    check('admin : aucune erreur JavaScript à l’ouverture de la liste', va.errors.length === 0, va.errors.join(' | '));

    await va.page.locator('[data-revoir]').first().click();
    const ouverte = await until(async () => (await va.page.locator('.modal .h-sub').count()) === 11, 8000);
    check('admin : la fiche s’ouvre avec les 11 rubriques', ouverte);
    const fiche = await va.page.locator('.modal').first().innerText().catch(() => '');
    check('admin : le contenu est lisible (titre et « Vision et contact »)',
      fiche.indexOf('Kiosque test') !== -1 && fiche.indexOf('Vision et contact') !== -1);

    await va.page.locator('.modal [data-set="visible"]').click();
    const demande = await until(async () => (await bodyText(va.page)).indexOf('Rendre cette présentation visible') !== -1, 5000);
    check('admin : demande de confirmation avec rappel sur « Vision et contact »',
      demande && (await bodyText(va.page)).indexOf('Vision et contact') !== -1);
    await va.page.locator('.modal [data-ok]').click();

    const appels = ca.__log.filter((e) => e.path === '/rest/v1/rpc/admin_set_presentation_visibility');
    check('admin : visibilité envoyée à la base une seule fois',
      appels.length === 1 && appels[0].body.indexOf('"p_visible":true') !== -1 && appels[0].body.indexOf('"p_user":"' + BEN_ID + '"') !== -1,
      appels.map((a) => a.body).join(' | '));
    const confirme = await until(async () => (await bodyText(va.page)).indexOf('Présentation visible des partenaires') !== -1, 5000);
    check('admin : confirmation affichée après la visibilité', confirme);
    check('admin : aucune erreur JavaScript', va.errors.length === 0, va.errors.join(' | '));
    check('admin : aucun « undefined », « null » ou « NaN »', !BAD.test(await bodyText(va.page)));

    /* B) Partenaire : bouton seulement si la fiche est visible */
    for (const visible of [true, false]) {
      const cp = await openContext(browser, 'partner', { visible: visible });
      const vp = await visit(cp, '#/partenaire/recherche');
      const bouton = vp.page.locator('[data-pres]');
      const projetAffiche = await until(async () => (await bodyText(vp.page)).indexOf('Achat de matériel') !== -1, 8000);
      check('partenaire (visible = ' + visible + ') : le projet est affiché', projetAffiche);
      if (visible) {
        check('partenaire : bouton « Voir la présentation » si la fiche est visible', (await bouton.count()) === 1);
        await bouton.click();
        const ouvert = await until(async () => (await vp.page.locator('.modal .h-sub').count()) === 11, 8000);
        check('partenaire : la fiche s’ouvre avec les 11 rubriques', ouvert);
        const texte = await vp.page.locator('.modal').first().innerText().catch(() => '');
        check('partenaire : le texte de la fiche est lisible', texte.indexOf('quarante kiosques') !== -1);
        check('partenaire : seul le projet choisi est demandé',
          cp.__log.some((e) => e.path === '/rest/v1/rpc/partner_presentation' && e.body.indexOf('"p_project":"p-1"') !== -1));
      } else {
        check('partenaire : aucun bouton si la fiche n’est pas visible', (await bouton.count()) === 0);
      }
      check('partenaire (visible = ' + visible + ') : aucune erreur JavaScript', vp.errors.length === 0, vp.errors.join(' | '));
      check('partenaire (visible = ' + visible + ') : aucun « undefined », « null » ou « NaN »', !BAD.test(await bodyText(vp.page)));
    }
  } catch (e) {
    failures++;
    console.log('FAIL exception : ' + (e && e.message ? e.message : e));
  } finally {
    await browser.close();
  }
  console.log(failures ? failures + ' contrôle(s) en échec.' : 'Tous les contrôles sont passés.');
  process.exit(failures ? 1 : 0);
})();
