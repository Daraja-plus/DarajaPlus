/* Test du fil d'actualités : bloc de la page d'accueil et page « Actualités ».
   Données simulées (aucun appel réel à Supabase). Vérifie, pour un bénéficiaire Bb et un partenaire :
   - seules les annonces « visibles » et les offres « publiées » sont demandées et affichées ;
   - le bénéficiaire ne voit que les offres de sa catégorie (Bb) et celles pour toutes les catégories ;
   - le partenaire voit toutes les offres publiées ;
   - les filtres de la page (Tout, Annonces, Opportunités) fonctionnent ;
   - le menu contient « Actualités » ; aucune exception JavaScript ;
   - chaque publication affichée est comptée une seule fois (appel « enregistrer_vues »), et jamais
     une publication masquée, en brouillon ou d’une autre catégorie.

   Usage :
     1) servir le dossier :  python3 -m http.server 8765 --directory /chemin/vers/DarajaPlus
     2) lancer le test   :  node tests/actualites.js            (variable BASE pour une autre adresse)
   Prérequis : Playwright avec Chromium installé. */

const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const SB = 'https://nfcfwvrllacpvlcsoycp.supabase.co';
const NOW = '2026-11-20T10:00:00Z';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS'
};
const BEN_USER = '22222222-2222-4222-8222-222222222222';
const PART_USER = '55555555-5555-4555-8555-555555555555';
const PARTNER_ID = 'p-1';

const PROFILES = {
  beneficiary: { id: BEN_USER, role: 'beneficiary', status: 'active', prenom: 'Bénéf', nom: 'Test', email: 'ben@test.local', created_at: NOW },
  partner: { id: PART_USER, role: 'partner', status: 'active', prenom: 'Partenaire', nom: 'Test', email: 'part@test.local', created_at: NOW }
};

/* Jeu d'essai : une annonce masquée, une offre en brouillon et une offre pour la seule catégorie Ba
   doivent rester invisibles pour le bénéficiaire Bb. */
const DATA = {
  announcements: [
    { id: 'an-1', title: 'Bienvenue', body: 'Texte de bienvenue', audience: 'all', zone_id: null, agent_id: null, status: 'visible', photo_path: null, author_id: 'admin', created_at: NOW },
    { id: 'an-2', title: 'Annonce masquée', body: 'Ne doit pas apparaître', audience: 'all', zone_id: null, agent_id: null, status: 'hidden', photo_path: null, author_id: 'admin', created_at: '2026-11-19T10:00:00Z' }
  ],
  offers: [
    { id: 'o-bb', title: 'Appel Bb', offer_type: 'appel_projets', status: 'published', target_category: 'bb', author_kind: 'agent', author_id: 'agent', partner_id: null, description: 'Appel pour Bb', amount_min: 500, amount_max: 2000, currency: 'USD', sector: 'Commerce', deadline: null, created_at: '2026-11-18T10:00:00Z' },
    { id: 'o-ba', title: 'Programme Ba', offer_type: 'programme_accompagnement', status: 'published', target_category: 'ba', author_kind: 'agent', author_id: 'agent', partner_id: null, description: 'Réservé aux Ba', amount_min: null, amount_max: null, currency: 'USD', sector: null, deadline: null, created_at: '2026-11-17T10:00:00Z' },
    { id: 'o-all', title: 'Financement ouvert', offer_type: 'offre_financement', status: 'published', target_category: 'all', author_kind: 'partner', author_id: 'partner', partner_id: PARTNER_ID, description: 'Pour toutes les catégories', amount_min: 100, amount_max: 900, currency: 'USD', sector: null, deadline: '2027-03-01', created_at: '2026-11-16T10:00:00Z' },
    { id: 'o-draft', title: 'Brouillon interne', offer_type: 'appel_projets', status: 'draft', target_category: 'all', author_kind: 'agent', author_id: 'agent', partner_id: null, description: 'Non publié', amount_min: null, amount_max: null, currency: 'USD', sector: null, deadline: null, created_at: '2026-11-21T10:00:00Z' }
  ],
  partners: [{ id: PARTNER_ID, profile_id: PART_USER, legal_name: 'Banque Test', status: 'active', category: 'banque', created_at: NOW }],
  beneficiaries: [{ id: 'b-1', user_id: BEN_USER, code: 'AH1A1Bb1', category: 'bb', status: 'active', prenom: 'Bénéf', nom: 'Test', agent_id: null, host_id: null, created_at: NOW }]
};

/* Filtres PostgREST simplifiés : eq., in.(…), is.null. Les autres paramètres (select, order, limit) sont ignorés. */
function applyFilters(rows, q) {
  var out = rows.slice();
  q.forEach(function (val, col) {
    if (['select', 'order', 'limit', 'offset'].indexOf(col) !== -1) return;
    if (val.indexOf('eq.') === 0) { var v = val.slice(3); out = out.filter(function (r) { return String(r[col]) === v; }); }
    else if (val.indexOf('in.(') === 0) { var list = val.slice(4, -1).split(','); out = out.filter(function (r) { return list.indexOf(String(r[col])) !== -1; }); }
    else if (val === 'is.null') { out = out.filter(function (r) { return r[col] === null || r[col] === undefined; }); }
  });
  return out;
}

let failures = 0;
function check(ok, label) {
  console.log((ok ? 'ok    ' : 'ECHEC ') + label);
  if (!ok) failures++;
}

async function openRole(browser, role) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const session = { access_token: 'test-token', refresh_token: 'test-refresh', expires_at: 4102444800, user: { id: PROFILES[role].id, email: PROFILES[role].email } };
  await context.addInitScript((s) => {
    try { localStorage.setItem('daraja.session.v1', JSON.stringify(s)); } catch (e) { /* ignoré */ }
  }, session);

  const requests = [];
  const rpcs = [];
  await context.route(SB + '/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const url = new URL(req.url());
    const p = url.pathname;
    let body = [];
    if (p === '/auth/v1/user') body = { id: PROFILES[role].id, email: PROFILES[role].email, aud: 'authenticated' };
    else if (p.indexOf('/rest/v1/rpc/') === 0) {
      let args = null;
      try { args = req.postDataJSON(); } catch (e) { /* pas de corps */ }
      rpcs.push({ name: p.slice('/rest/v1/rpc/'.length), args: args });
      body = {};
    }
    else if (p.indexOf('/rest/v1/') === 0) {
      const table = p.slice('/rest/v1/'.length);
      if (table === 'profiles') body = [PROFILES[role]];
      else {
        requests.push({ table: table, query: url.searchParams.toString() });
        body = applyFilters(DATA[table] || [], url.searchParams);
      }
    }
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  });

  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(BASE + '#/', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  return { context, page, requests, rpcs, problems };
}

async function goTo(page, hash, waitText) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForFunction((t) => {
    const v = document.getElementById('view');
    return v && !v.querySelector('.loading') && (!t || v.innerText.indexOf(t) !== -1);
  }, waitText || '', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(150);
  return page.evaluate(() => document.getElementById('view').innerText);
}

async function testBeneficiary(browser) {
  console.log('\n=== Bénéficiaire Bb');
  const s = await openRole(browser, 'beneficiary');
  const home = await goTo(s.page, '#/espace', 'Fil d’actualités');
  check(home.indexOf('Fil d’actualités') !== -1, 'accueil : bloc « Fil d’actualités » affiché');
  check(home.indexOf('Bienvenue') !== -1, 'accueil : annonce visible affichée');
  check(home.indexOf('Appel Bb') !== -1, 'accueil : offre de la catégorie Bb affichée');
  check(home.indexOf('Financement ouvert') !== -1 && home.indexOf('Banque Test') !== -1, 'accueil : offre de partenaire affichée avec le nom du partenaire');
  check(home.indexOf('Programme Ba') === -1, 'accueil : offre réservée à la catégorie Ba masquée');
  check(home.indexOf('Annonce masquée') === -1, 'accueil : annonce masquée non demandée ni affichée');
  check(home.indexOf('Brouillon interne') === -1, 'accueil : offre en brouillon non affichée');
  check(home.indexOf('Voir toutes les actualités') !== -1, 'accueil : lien « Voir toutes les actualités » présent');

  const tout = await goTo(s.page, '#/actualites', 'Actualités');
  check(tout.indexOf('Appel Bb') !== -1 && tout.indexOf('Bienvenue') !== -1, 'page Actualités, filtre Tout : annonces et offres affichées');
  const ann = await goTo(s.page, '#/actualites?type=annonces', 'Bienvenue');
  check(ann.indexOf('Bienvenue') !== -1 && ann.indexOf('Appel Bb') === -1, 'filtre Annonces : seules les annonces affichées');
  const opp = await goTo(s.page, '#/actualites?type=opportunites', 'Appel Bb');
  check(opp.indexOf('Appel Bb') !== -1 && opp.indexOf('Bienvenue') === -1, 'filtre Opportunités : seules les offres affichées');

  const menu = await s.page.evaluate(() => !!document.querySelector('#app a[href="#/actualites"]'));
  check(menu, 'menu : lien « Actualités » présent');

  const annQuery = s.requests.filter(function (r) { return r.table === 'announcements'; });
  check(annQuery.length > 0 && annQuery.every(function (r) { return r.query.indexOf('status=eq.visible') !== -1; }),
    'requête annonces : limitée aux annonces « visible »');
  const offQuery = s.requests.filter(function (r) { return r.table === 'offers'; });
  check(offQuery.length > 0 && offQuery.every(function (r) { return r.query.indexOf('status=eq.published') !== -1; }),
    'requête offres : limitée aux offres « published »');

  /* Vues : chaque publication affichée à l’écran est comptée une fois, jamais une publication masquée,
     en brouillon ou d’une autre catégorie. On affiche la page complète, puis on descend en bas de page. */
  await goTo(s.page, '#/actualites', 'Bienvenue');
  await s.page.waitForTimeout(3500);
  await s.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await s.page.waitForTimeout(3500);
  const envois = s.rpcs.filter(function (r) { return r.name === 'enregistrer_vues' && r.args; });
  const idsDe = function (kind) {
    return [].concat.apply([], envois.filter(function (r) { return r.args.p_kind === kind; }).map(function (r) { return r.args.p_ids; }));
  };
  const vuesAnn = idsDe('annonce');
  const vuesOff = idsDe('offre');
  const toutes = vuesAnn.concat(vuesOff);
  check(vuesAnn.indexOf('an-1') !== -1, 'vues : l’annonce affichée est comptée');
  check(vuesOff.indexOf('o-all') !== -1, 'vues : l’offre affichée en bas de page est comptée');
  check(toutes.length === new Set(toutes).size, 'vues : une seule vue par publication (pas de doublon)');
  check(toutes.indexOf('o-ba') === -1 && toutes.indexOf('an-2') === -1 && toutes.indexOf('o-draft') === -1,
    'vues : offre Ba, annonce masquée et brouillon jamais comptées');

  check(s.problems.length === 0, 'aucune exception JavaScript' + (s.problems.length ? ' : ' + s.problems.join(' | ') : ''));
  await s.context.close();
}

async function testPartner(browser) {
  console.log('\n=== Partenaire');
  const s = await openRole(browser, 'partner');
  const home = await goTo(s.page, '#/partenaire', 'Fil d’actualités');
  check(home.indexOf('Fil d’actualités') !== -1, 'accueil : bloc « Fil d’actualités » affiché');
  check(home.indexOf('Programme Ba') !== -1 && home.indexOf('Financement ouvert') !== -1, 'accueil : toutes les offres publiées affichées (pas de filtre par catégorie)');
  check(home.indexOf('Brouillon interne') === -1 && home.indexOf('Annonce masquée') === -1, 'accueil : brouillon et annonce masquée non affichés');

  const tout = await goTo(s.page, '#/actualites', 'Actualités');
  check(tout.indexOf('Bienvenue') !== -1 && tout.indexOf('Programme Ba') !== -1, 'page Actualités : annonces et offres affichées');
  check(s.problems.length === 0, 'aucune exception JavaScript' + (s.problems.length ? ' : ' + s.problems.join(' | ') : ''));
  await s.context.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await testBeneficiary(browser);
    await testPartner(browser);
  } finally {
    await browser.close();
  }
  console.log('\n' + (failures ? failures + ' vérification(s) en échec.' : 'Toutes les vérifications du fil d’actualités sont passées.'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
