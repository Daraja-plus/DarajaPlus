/* Test de fumée navigateur : ouvre chaque page de chaque espace avec un compte factice et un réseau simulé
   (aucun appel à Supabase). Deux passes : « vide » (aucune donnée) puis « données » (jeu d’essai en mémoire,
   avec filtres PostgREST simplifiés). Signale toute exception JavaScript et toute page d’erreur inattendue.

   Usage :
     1) servir le dossier :  python3 -m http.server 8765 --directory /chemin/vers/DarajaPlus
     2) lancer le test   :  node tests/smoke.js            (variable BASE pour une autre adresse)
   Prérequis : Playwright avec Chromium installé (pas besoin de « playwright install » si Chromium est déjà présent). */

const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const SB = 'https://nfcfwvrllacpvlcsoycp.supabase.co';
const NOW = '2026-11-10T10:00:00Z';
const BEN_ID = '22222222-2222-4222-8222-222222222222';
const HOST_ID = '33333333-3333-4333-8333-333333333333';
const AGENT_ID = '44444444-4444-4444-8444-444444444444';
const PARTNER_ID = '55555555-5555-4555-8555-555555555555';
const ADMIN_ID = '66666666-6666-4666-8666-666666666666';
const BENEF_ID = '77777777-7777-4777-8777-777777777777';

const PROFILES = {
  admin: { id: ADMIN_ID, role: 'admin', status: 'active', prenom: 'Admin', nom: 'Test', email: 'admin@test.local', code: 'ADM' },
  host: { id: HOST_ID, role: 'host', status: 'active', prenom: 'Hôte', nom: 'Test', email: 'hote@test.local', code: 'AH1', zone_id: 1 },
  agent: { id: AGENT_ID, role: 'agent', status: 'active', prenom: 'Agent', nom: 'Test', email: 'agent@test.local', code: 'AH1A1', zone_id: 1, host_id: HOST_ID, quartier_id: 1 },
  beneficiary: { id: BENEF_ID, role: 'beneficiary', status: 'active', prenom: 'Bénéf', nom: 'Test', email: 'ben@test.local', code: 'AH1A1Bb1', category: 'bb', agent_id: AGENT_ID },
  partner: { id: PARTNER_ID, role: 'partner', status: 'active', prenom: 'Partenaire', nom: 'Test', email: 'part@test.local' }
};

/* Jeu d’essai : une ligne représentative par table, cohérente entre les tables (mêmes identifiants). */
const FIXTURE = {
  profiles: Object.keys(PROFILES).map(function (k) { return Object.assign({ created_at: NOW, phone: null, zone_id: null, host_id: null, agent_id: null, quartier_id: null, rejection_reason: null }, PROFILES[k]); }),
  zones: [1, 2, 3, 4, 5].map(function (i) { return { id: i, name: 'Zone ' + i }; }),
  quartiers: [{ id: 1, zone_id: 1, name: 'Quartier 1' }, { id: 2, zone_id: 1, name: 'Quartier 2' }],
  beneficiaries: [
    { id: BEN_ID, code: 'AH1A1Bb1', category: 'bb', nom: 'Nom', postnom: 'Post', prenom: 'Pré', phone: '+243000', email: null, agent_id: AGENT_ID, host_id: HOST_ID, quartier_id: 1, sponsor_id: null, user_id: BENEF_ID, agent_seq: 1, status: 'active', created_by: AGENT_ID, created_at: NOW, updated_at: NOW },
    { id: 'b-ba', code: 'AH1A1Ba1', category: 'ba', nom: 'Ba', postnom: 'Post', prenom: 'Un', phone: null, email: null, agent_id: AGENT_ID, host_id: HOST_ID, quartier_id: null, sponsor_id: BEN_ID, user_id: null, agent_seq: 2, status: 'to_verify', created_by: AGENT_ID, created_at: NOW, updated_at: NOW },
    { id: 'b-bg', code: 'AH1A1Bg1', category: 'bg', nom: 'Bg', postnom: 'Post', prenom: 'Deux', phone: null, email: null, agent_id: AGENT_ID, host_id: HOST_ID, quartier_id: null, sponsor_id: null, user_id: null, agent_seq: 3, status: 'draft', created_by: AGENT_ID, created_at: NOW, updated_at: NOW }
  ],
  projects: [{ id: 'p-1', beneficiary_id: BEN_ID, establishment_id: null, title: 'Achat de matériel', sector: 'Commerce', description: 'Description du projet', amount: 1500, currency: 'USD', use_of_funds: 'Stock', due_date: '2027-03-01', status: 'ready', created_by: BENEF_ID, created_at: NOW, updated_at: NOW }],
  connection_requests: [
    { id: 'c-1', project_id: 'p-1', partner_id: PARTNER_ID, requested_by: BENEF_ID, motive: 'Motif suffisamment long pour le test', status: 'approved_admin', admin_reason: null, created_at: NOW, updated_at: NOW },
    { id: 'c-2', project_id: 'p-1', partner_id: PARTNER_ID, requested_by: BENEF_ID, motive: 'Deuxième demande de test, plus de vingt caractères', status: 'requested', admin_reason: null, created_at: NOW, updated_at: NOW }
  ],
  partners: [{ id: PARTNER_ID, profile_id: PARTNER_ID, category: 'institution_financiere', legal_name: 'Banque Test', representative: 'Directeur', contact_email: 'p@test.local', phone: '+243', description: 'Présentation', sectors: 'Agriculture', geography: 'Kinshasa', ticket_min: 100, ticket_max: 5000, created_at: NOW }],
  offers: [
    { id: 'o-1', author_id: PARTNER_ID, author_kind: 'partner', partner_id: PARTNER_ID, title: 'Appel à projets', offer_type: 'appel_projets', description: 'Description', target_category: 'all', sector: 'Agri', zone_id: null, amount_min: 100, amount_max: 900, currency: 'USD', deadline: '2027-01-01', is_paid: false, price_fc: null, status: 'published', created_at: NOW, publication_month: '2026-11' },
    { id: 'o-2', author_id: AGENT_ID, author_kind: 'agent', partner_id: null, title: 'Formation', offer_type: 'programme_accompagnement', description: 'Formation', target_category: 'bb', sector: null, zone_id: 1, amount_min: null, amount_max: null, currency: 'USD', deadline: null, is_paid: false, price_fc: null, status: 'published', created_at: NOW, publication_month: '2026-11' }
  ],
  carrefours: [{ id: 'car-1', name: 'Carrefour test', objective: 'Objectif', organizer_id: AGENT_ID, zone_id: 1, contribution_amount: 5000, currency: 'FC', frequency: 'mensuelle', max_members: 10, duration_cycles: 10, rotation_mode: 'ordre_inscription', rules: 'Règles', status: 'open', created_at: NOW }],
  carrefour_members: [{ carrefour_id: 'car-1', beneficiary_id: BEN_ID, status: 'requested', rank: null, requested_at: NOW, decided_at: null, decided_by: null }],
  announcements: [{ id: 'an-1', author_id: ADMIN_ID, audience: 'all', zone_id: null, agent_id: null, title: 'Bienvenue', body: 'Texte d’annonce', status: 'visible', created_at: NOW }],
  documents: [{ id: 'd-1', owner_beneficiary_id: BEN_ID, project_id: 'p-1', doc_type: 'identite', storage_path: BENEF_ID + '/x.pdf', file_name: 'x.pdf', confidentiality: 'confidentiel', version: 1, verified: false, uploaded_by: BENEF_ID, created_at: NOW }],
  document_shares: [],
  funding_outcomes: [{ id: 'fo-1', connection_id: 'c-1', result_type: 'financement_accorde', amount: 500, currency: 'USD', outcome_date: '2026-11-01', proof_ref: 'PV-1', declared_by: PARTNER_ID, declared_at: NOW, validated: false, validated_by: null, validated_at: null }],
  commission_entries: [{ id: 'ce-1', outcome_id: 'fo-1', host_id: HOST_ID, base_amount: 500, currency: 'USD', rate_total: 0.1, rate_darajaplus: 0.07, rate_host: 0.03, rate_agent: 0, amount_total: 50, amount_darajaplus: 35, amount_host: 15, amount_agent: 0, status: 'simulee', created_at: NOW }],
  visibility_orders: [{ id: 'v-1', owner_id: BENEF_ID, beneficiary_id: BEN_ID, category: 'bb', days: 30, rate_fc: 150, amount_fc: 4500, starts_on: '2026-11-01', ends_on: '2026-11-30', status: 'pending_payment', created_at: NOW, activated_at: null }],
  payments: [{ id: 'pay-1', order_id: 'v-1', amount_fc: 4500, provider: 'manuel', reference: null, status: 'en_attente', created_at: NOW }],
  messages: [{ id: 'm-1', thread_user_id: BENEF_ID, from_user_id: BENEF_ID, from_admin: false, body: 'Bonjour', read_by_admin: false, read_by_user: true, created_at: NOW }],
  notifications: [{ id: 'n-1', recipient_id: ADMIN_ID, kind: 'account', title: 'Nouveau compte', body: 'Un compte attend validation.', link: '#/admin/comptes', read_at: null, created_at: NOW }],
  contact_requests: [{ id: 'k-1', name: 'Jean Test', email: 'jean@test.local', phone: null, subject: 'Information', message: 'Bonjour, je voudrais des informations.', status: 'new', created_at: NOW }],
  audit_logs: [{ id: 1, actor_id: ADMIN_ID, actor_role: 'admin', action: 'UPDATE', table_name: 'profiles', object_id: 'x', before_data: { a: 1 }, after_data: { a: 2 }, reason: null, created_at: NOW }],
  settings: [
    { key: 'agent_free_offers_per_month', value: 5 }, { key: 'exchange_rate_fc_per_usd', value: 2300 },
    { key: 'carrefour_enabled', value: true }, { key: 'payments_enabled', value: false },
    { key: 'visibility_rate_fc_per_day', value: { ba: 100, bb: 150, bg: 200, agent: 300 } },
    { key: 'commission_rates', value: { host: 0.03, agent: 0, total: 0.1, darajaplus: 0.07 } },
    { key: 'caps', value: { hosts: 5, agents: 50, partners: 100, ba_per_bb: 2, bb_per_bg: 3, ba_per_agent: 60, bb_per_agent: 30, bg_per_agent: 10, agents_per_host: 10 } }
  ]
};

const ROUTES = {
  public: ['/', '/fonctionnement', '/beneficiaires', '/partenaires', '/carrefours', '/tarifs', '/faq', '/contact', '/a-propos', '/mentions', '/connexion', '/inscription', '/mot-de-passe-oublie', '/en-attente'],
  admin: ['/admin', '/admin/comptes', '/admin/comptes?statut=active', '/admin/hotes', '/admin/agents', '/admin/beneficiaires', '/admin/beneficiaires?categorie=bb', '/admin/partenaires', '/admin/projets', '/admin/presentations', '/admin/ponts', '/admin/resultats', '/admin/offres', '/admin/carrefours', '/admin/annonces', '/admin/finances', '/admin/messages', '/admin/messages/' + BENEF_ID, '/admin/contacts', '/admin/territoires', '/admin/audit', '/admin/configuration', '/notifications', '/mon-compte'],
  host: ['/hote', '/hote/agents', '/hote/beneficiaires', '/hote/dossiers', '/hote/ponts', '/hote/carrefours', '/hote/annonces', '/messages', '/notifications', '/mon-compte'],
  agent: ['/agent', '/agent/categories', '/agent/beneficiaires', '/agent/beneficiaires/nouveau', '/agent/beneficiaires/' + BEN_ID, '/agent/projets', '/agent/offres', '/agent/carrefours', '/agent/annonces', '/agent/visibilite', '/messages', '/notifications', '/mon-compte'],
  beneficiary: ['/espace', '/espace/categorie', '/espace/profil', '/espace/entreprises', '/espace/projets', '/espace/dossiers', '/espace/opportunites', '/espace/carrefours', '/espace/visibilite', '/espace/presentation', '/messages', '/notifications', '/mon-compte'],
  partner: ['/partenaire', '/partenaire/profil', '/partenaire/offres', '/partenaire/recherche', '/partenaire/dossiers', '/partenaire/resultats', '/messages', '/notifications', '/mon-compte']
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS'
};

/* Filtres PostgREST simplifiés : eq., neq., in.(…), is.null. Les autres paramètres (select, order, limit) sont ignorés. */
function applyFilters(rows, q) {
  var out = rows.slice();
  q.forEach(function (val, col) {
    if (['select', 'order', 'limit', 'offset'].indexOf(col) !== -1) return;
    if (val.indexOf('eq.') === 0) { var v = val.slice(3); out = out.filter(function (r) { return String(r[col]) === v; }); }
    else if (val.indexOf('neq.') === 0) { var n = val.slice(4); out = out.filter(function (r) { return String(r[col]) !== n; }); }
    else if (val.indexOf('in.(') === 0) { var list = val.slice(4, -1).split(','); out = out.filter(function (r) { return list.indexOf(String(r[col])) !== -1; }); }
    else if (val === 'is.null') { out = out.filter(function (r) { return r[col] === null || r[col] === undefined; }); }
  });
  return out;
}

/* Réponses simulées. Mode « vide » : seul le profil de l’utilisateur est renvoyé. Mode « données » : jeu d’essai. */
function fakeResponse(req, role, withData) {
  const url = new URL(req.url());
  const p = url.pathname;
  const q = url.searchParams;
  const me = PROFILES[role];
  if (req.method() === 'OPTIONS') return { status: 204, body: '' };
  if (p === '/auth/v1/user') return { id: me.id, email: me.email, aud: 'authenticated' };
  if (p === '/rest/v1/rpc/admin_stats') return { comptes_en_attente: 2, bg: 1, bb: 3, ba: 5, hotes_actifs: 1, agents_actifs: 2, partenaires_actifs: 1, partenaires_en_attente: 0, ponts_a_valider: 1, ponts_en_cours: 0, resultats_a_valider: 0, dossiers_prets: 1, messages_non_lus: 0, commissions_simulees_fc: 0, commissions_simulees_usd: 0, visibilites_a_payer: 0 };
  if (p === '/rest/v1/rpc/admin_utilisateurs_par_categorie') return { administrateur: 1, hotes: 2, agents: 1, bg: 1, bb: 3, ba: 5, attente: 4, partenaires: 1, autres: 0, total: 18 };
  if (p === '/rest/v1/rpc/agent_quota') return { bg: 1, bb: 2, ba: 3, total: 6, caps: { bg: 10, bb: 30, ba: 60, total: 100 }, free_offers_used: 1, free_offers_quota: 5 };
  if (p === '/rest/v1/rpc/refresh_visibility') return 2;
  if (p.indexOf('/rest/v1/rpc/') === 0) return {};
  if (p.indexOf('/rest/v1/') === 0 && req.method() === 'GET') {
    const table = p.slice('/rest/v1/'.length);
    const data = withData ? FIXTURE : { profiles: FIXTURE.profiles };
    return applyFilters(data[table] || [], q);
  }
  return [];
}

async function runRole(browser, role, routes, withData) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const session = role === 'public' ? null : { access_token: 'test-token', refresh_token: 'test-refresh', expires_at: 4102444800, user: { id: PROFILES[role].id, email: PROFILES[role].email } };
  await context.addInitScript((s) => {
    try { localStorage.setItem('daraja.session.v1', JSON.stringify(s)); } catch (e) { /* ignoré */ }
  }, session);

  await context.route(SB + '/**', async (route) => {
    const req = route.request();
    const body = fakeResponse(req, role, withData);
    if (body && body.status === 204) return route.fulfill({ status: 204, headers: CORS, body: '' });
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  });

  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push({ kind: 'exception', msg: e.message }));
  page.on('console', (m) => { if (m.type() === 'error') problems.push({ kind: 'console', msg: m.text() }); });

  await page.goto(BASE + '#/', { waitUntil: 'load' });
  await page.waitForTimeout(400);

  const results = [];
  for (const r of routes) {
    problems.length = 0;
    await page.evaluate((h) => { location.hash = h; }, r);
    await page.waitForTimeout(450);
    await page.waitForFunction(() => !document.querySelector('#view .loading'), null, { timeout: 4000 }).catch(() => {});
    const info = await page.evaluate(() => {
      const v = document.getElementById('view');
      const bad = v ? v.querySelector('.alert-bad') : null;
      return {
        hash: location.hash,
        empty: !v || v.innerHTML.trim() === '',
        alert: bad ? bad.textContent.replace(/\s+/g, ' ').trim().slice(0, 140) : null
      };
    });
    results.push({ route: r, final: info.hash, empty: info.empty, alert: info.alert, problems: problems.slice() });
  }
  await context.close();
  return results;
}

(async () => {
  const browser = await chromium.launch();
  let failures = 0;
  for (const withData of [false, true]) {
    console.log('\n########## Passe : ' + (withData ? 'avec données (jeu d’essai)' : 'sans données'));
    for (const g of Object.keys(ROUTES)) {
      const res = await runRole(browser, g, ROUTES[g], withData);
      console.log('\n=== ' + g + ' (' + res.length + ' pages)');
      for (const r of res) {
        const exc = r.problems.filter((x) => x.kind === 'exception');
        const con = r.problems.filter((x) => x.kind === 'console');
        const flag = exc.length || r.empty ? 'FAIL' : (con.length ? 'WARN' : 'ok  ');
        if (exc.length || r.empty) failures++;
        const redirected = r.final !== '#' + r.route && r.final !== '#' + r.route.split('?')[0];
        console.log(flag + ' ' + r.route + (redirected ? '  -> redirigé vers ' + r.final : ''));
        if (r.alert) console.log('       message : ' + r.alert);
        exc.forEach((x) => console.log('       EXCEPTION : ' + x.msg));
        con.slice(0, 2).forEach((x) => console.log('       console : ' + x.msg.slice(0, 160)));
      }
    }
  }
  await browser.close();
  console.log('\nPages en échec (exception ou écran vide) : ' + failures);
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
