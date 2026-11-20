/* Test du bouton « Remplacer » sur la page Comptes à valider (aucun appel réel à Supabase) :
   1) le bouton n’apparaît que sur les comptes qui occupent un poste (Hôte avec zone, Agent avec quartier,
      bénéficiaire avec code), à côté de « Message » et « Suspendre » ;
   2) pour chaque rôle, la fenêtre ne propose que le candidat valide, et l’appel envoyé au serveur est correct ;
   3) les listes Hôtes, Agents et Bénéficiaires n’ont plus de bouton « Remplacer ».
   Usage :
     1) servir le dossier :  python3 -m http.server 8765 --bind 127.0.0.1   (depuis le dossier DarajaPlus)
     2) lancer le test   :  node tests/remplacer.js        (variable BASE pour une autre adresse)
   Prérequis : Playwright avec Chromium installé. */

const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const SB = 'https://nfcfwvrllacpvlcsoycp.supabase.co';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const H1 = '44444444-4444-4444-8444-444444444444';
const H2 = '55555555-5555-4555-8555-555555555555';
const H3 = '66666666-6666-4666-8666-666666666666';
const A1 = '33333333-3333-4333-8333-333333333333';
const A2 = '77777777-7777-4777-8777-777777777777';
const A3 = '88888888-8888-4888-8888-888888888888';
const U1 = '22222222-2222-4222-8222-222222222222';
const U2 = '99999999-9999-4999-8999-999999999999';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra ? '  [' + extra + ']' : ''));
}

function profil(over) {
  return Object.assign({ id: '', role: 'beneficiary', status: 'active', prenom: 'Prénom', nom: 'Nom', email: 'x@test.local',
    code: null, identifiant: null, zone_id: null, host_id: null, quartier_id: null, agent_id: null, category: null,
    created_at: '2026-11-10T10:00:00Z' }, over || {});
}

function donnees() {
  return {
    profiles: [
      profil({ id: ADMIN_ID, role: 'admin', prenom: 'Admin', nom: 'Test' }),
      profil({ id: H1, role: 'host', zone_id: 1, code: 'AH1', prenom: 'Hôte', nom: 'Un' }),                  // occupe la zone 1
      profil({ id: H2, role: 'host', prenom: 'Hôte', nom: 'Deux' }),                                         // sans poste : pas de bouton, candidat
      profil({ id: H3, role: 'host', zone_id: 2, code: 'AH2', prenom: 'Hôte', nom: 'Trois' }),              // occupe la zone 2
      profil({ id: A1, role: 'agent', zone_id: 1, host_id: H1, quartier_id: 1, code: 'AH1A1', prenom: 'Agent', nom: 'Un' }),
      profil({ id: A2, role: 'agent', prenom: 'Agent', nom: 'Deux' }),                                       // sans quartier : candidat
      profil({ id: A3, role: 'agent', zone_id: 1, host_id: H1, quartier_id: 3, code: 'AH1A3', prenom: 'Agent', nom: 'Trois' }),
      profil({ id: U1, role: 'beneficiary', code: 'AH1A1Bb1', agent_id: A1, quartier_id: 1, category: 'bb', prenom: 'Pré', nom: 'Bénéf' }),
      profil({ id: U2, role: 'beneficiary', prenom: 'Autre', nom: 'Bénéf' })                                // sans code : candidat
    ],
    zones: [{ id: 1, name: 'Zone 1' }, { id: 2, name: 'Zone 2' }],
    quartiers: [{ id: 1, zone_id: 1, name: 'Quartier Z1-01' }, { id: 3, zone_id: 1, name: 'Quartier Z1-03' }],
    beneficiaries: [
      { id: 'b-1', user_id: U1, code: 'AH1A1Bb1', category: 'bb', status: 'active', agent_id: A1, host_id: H1, quartier_id: 1,
        prenom: 'Pré', nom: 'Bénéf', created_at: '2026-11-10T10:00:00Z', agent_seq: 1, sponsor_id: null },
      { id: 'b-2', user_id: null, code: null, category: null, status: 'draft', agent_id: null, host_id: null, quartier_id: null,
        prenom: 'Sans', nom: 'Compte', created_at: '2026-11-11T10:00:00Z', agent_seq: null, sponsor_id: null }
    ],
    rpc: []
  };
}

/* Filtre minimal des paramètres PostgREST utilisés par les écrans testés. */
function filtrer(rows, url) {
  return rows.filter(function (r) {
    for (const [k, v] of url.searchParams) {
      if (k === 'select' || k === 'order' || k === 'limit') continue;
      if (v.indexOf('eq.') === 0) { if (String(r[k]) !== v.slice(3)) return false; }
      else if (v.indexOf('neq.') === 0) { if (String(r[k]) === v.slice(4)) return false; }
      else if (v.indexOf('in.(') === 0) { if (v.slice(4, -1).split(',').indexOf(String(r[k])) === -1) return false; }
    }
    return true;
  });
}

async function ouvrir(browser, d) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript((s) => {
    try { localStorage.setItem('daraja.session.v1', JSON.stringify(s)); } catch (e) { /* ignoré */ }
  }, { access_token: 'test-token', refresh_token: 'test-refresh', expires_at: 4102444800, user: { id: ADMIN_ID, email: 'admin@test.local' } });
  await context.route(SB + '/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (body) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (p === '/auth/v1/user') return reply({ id: ADMIN_ID, email: 'admin@test.local', aud: 'authenticated' });
    if (p === '/rest/v1/profiles') return reply(filtrer(d.profiles, url));
    if (p === '/rest/v1/zones') return reply(d.zones);
    if (p === '/rest/v1/quartiers') return reply(d.quartiers);
    if (p === '/rest/v1/beneficiaries') return reply(filtrer(d.beneficiaries, url));
    if (p === '/rest/v1/notifications') return reply([]);
    if (p.indexOf('/rest/v1/rpc/') === 0) {
      if (req.method() !== 'GET') d.rpc.push({ name: p.slice('/rest/v1/rpc/'.length), body: JSON.parse(req.postData() || '{}') });
      return reply({});
    }
    return reply([]);
  });
  return context;
}

async function options(page) {
  return page.$$eval('#rp select[name=nouveau] option', function (os) {
    return os.map(function (o) { return o.value; }).filter(function (v) { return v !== ''; });
  });
}

/* Ouvre la fenêtre « Remplacer » depuis le compte, vérifie le candidat proposé et l’appel envoyé. */
async function essai(browser, label, posteId, candidat) {
  const d = donnees();
  const ctx = await ouvrir(browser, d);
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', function (e) { erreurs.push(String(e && e.message || e)); });
  await page.goto(BASE + '#/admin/comptes?statut=active', { waitUntil: 'load' });
  await page.waitForSelector('[data-remplacer-compte="' + posteId + '"]', { timeout: 10000 }).catch(function () {});
  await page.click('[data-remplacer-compte="' + posteId + '"]');
  await page.waitForSelector('#rp', { timeout: 5000 }).catch(function () {});
  const opts = await options(page);
  check(label + ' : seul le candidat valide est proposé', opts.length === 1 && opts[0] === candidat, opts.join(', '));
  await page.selectOption('#rp select[name=nouveau]', candidat);
  await page.click('#rp button[type=submit]');
  await page.waitForTimeout(500);
  const rpc = d.rpc.find(function (c) { return c.name === 'admin_remplacer_titulaire'; });
  check(label + ' : l’appel envoie le poste et le nouveau titulaire',
    !!rpc && rpc.body.p_poste === posteId && rpc.body.p_nouveau === candidat, JSON.stringify(rpc && rpc.body));
  check(label + ' : aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    /* 1) Le bouton n’apparaît que sur les comptes qui occupent un poste, à côté de « Message » et « Suspendre » */
    const d = donnees();
    const ctx = await ouvrir(browser, d);
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', function (e) { erreurs.push(String(e && e.message || e)); });
    await page.goto(BASE + '#/admin/comptes?statut=active', { waitUntil: 'load' });
    await page.waitForSelector('[data-remplacer-compte]', { timeout: 10000 }).catch(function () {});
    const trouves = await page.$$eval('[data-remplacer-compte]', function (els) {
      return els.map(function (e) { return e.dataset.remplacerCompte; });
    });
    const attendus = [H1, H3, A1, A3, U1];
    const ok = trouves.length === attendus.length && attendus.every(function (id) { return trouves.indexOf(id) !== -1; });
    check('comptes actifs : « Remplacer » seulement sur les 5 comptes qui occupent un poste', ok, trouves.length + ' bouton(s)');
    const cellule = await page.locator('[data-remplacer-compte="' + H1 + '"]').evaluate(function (e) {
      var td = e.closest('td');
      return td ? td.textContent : e.parentElement.textContent;
    });
    check('comptes actifs : « Remplacer » figure à côté de « Message » et « Suspendre »',
      cellule.indexOf('Message') !== -1 && cellule.indexOf('Suspendre') !== -1);
    check('comptes actifs : aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
    await ctx.close();

    /* 2) Candidat et appel, pour chaque rôle */
    await essai(browser, 'hôte', H1, H2);
    await essai(browser, 'agent', A1, A2);
    await essai(browser, 'bénéficiaire', U1, U2);

    /* 3) Les anciens emplacements (zone, Agent, fiche) ne proposent plus « Remplacer » */
    const d3 = donnees();
    const ctx3 = await ouvrir(browser, d3);
    const p3 = await ctx3.newPage();
    for (const route of ['#/admin/hotes', '#/admin/agents', '#/admin/beneficiaires']) {
      await p3.goto(BASE + route, { waitUntil: 'load' });
      await p3.waitForTimeout(1200);
      const nb = await p3.locator('[data-remplacer], [data-remplacer-ben]').count();
      const charge = await p3.locator('[data-suspend], [data-status], [data-assign]').count();
      check(route + ' : pas de bouton « Remplacer »', nb === 0 && charge > 0, nb + ' bouton(s), ' + charge + ' action(s) présente(s)');
    }
    await ctx3.close();
  } finally {
    await browser.close();
  }
  console.log(failures ? '\nÉchecs : ' + failures : '\nTous les contrôles sont passés.');
  process.exit(failures ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
