/* Test du parcours « validation de compte » avec des données simulées (aucun appel réel à Supabase) :
   1) un compte validé voit la confirmation avec la date et l’heure en haut de son espace, et peut la fermer ;
   2) une personne qui attend sa validation voit, sans recharger la page, la confirmation dès que le compte est validé.
   Usage :
     1) servir le dossier :  python3 -m http.server 8765   (depuis le dossier DarajaPlus)
     2) lancer le test   :  node tests/validation.js        (variable BASE pour une autre adresse)
   Prérequis : Playwright avec Chromium installé. */

const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const SB = 'https://nfcfwvrllacpvlcsoycp.supabase.co';
const BEN_ID = '22222222-2222-4222-8222-222222222222';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra ? '  [' + extra + ']' : ''));
}

function profileRow(status, validatedAt) {
  return { id: BEN_ID, role: 'beneficiary', status: status, prenom: 'Bénéf', nom: 'Test', email: 'ben@test.local',
    code: null, category: null, requested_role: 'beneficiary', validated_at: validatedAt, created_at: '2026-11-10T10:00:00Z',
    phone: null, zone_id: null, host_id: null, agent_id: null, quartier_id: null, rejection_reason: null };
}

async function openContext(browser, state) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript((s) => {
    try { localStorage.setItem('daraja.session.v1', JSON.stringify(s)); } catch (e) { /* ignoré */ }
  }, { access_token: 'test-token', refresh_token: 'test-refresh', expires_at: 4102444800, user: { id: BEN_ID, email: 'ben@test.local' } });

  await context.route(SB + '/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (body) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (p === '/auth/v1/user') return reply({ id: BEN_ID, email: 'ben@test.local', aud: 'authenticated' });
    if (p === '/rest/v1/profiles') return reply([state.profile]);
    if (p === '/rest/v1/notifications' && req.method() === 'GET') {
      const unread = url.searchParams.get('read_at') === 'is.null';
      const kind = url.searchParams.get('kind');
      return reply(state.notifs.filter(function (n) {
        return (!unread || !n.read_at) && (!kind || kind === 'eq.' + n.kind);
      }));
    }
    if (p === '/rest/v1/notifications' && req.method() === 'PATCH') {
      const id = (url.searchParams.get('id') || '').replace('eq.', '');
      const patch = JSON.parse(req.postData() || '{}');
      state.notifs.forEach(function (n) { if (n.id === id) Object.assign(n, patch); });
      return reply(state.notifs.filter(function (n) { return n.id === id; }));
    }
    if (p.indexOf('/rest/v1/rpc/') === 0) return reply({});
    return reply([]);
  });
  return context;
}

async function scenarioBanner(browser) {
  console.log('\n— Scénario 1 : confirmation dans l’espace');
  const state = {
    profile: profileRow('active', '2026-11-12T08:30:00Z'),
    notifs: [{ id: 'nv-1', kind: 'compte_valide', title: 'Votre compte est validé',
      body: 'Validé le 12/11/2026 à 09:30 (heure de Kinshasa). Consultez votre fiche. Commencez dès maintenant.',
      link: '#/espace', read_at: null, created_at: '2026-11-12T08:30:00Z' }]
  };
  const context = await openContext(browser, state);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });

  await page.goto(BASE + '#/espace', { waitUntil: 'load' });
  await page.waitForSelector('.validation-banner', { timeout: 10000 }).catch(function () {});
  const count = await page.locator('.validation-banner').count();
  const text = count ? await page.locator('.validation-banner').innerText() : '';
  check('la confirmation s’affiche en haut de l’espace', count === 1 && text.indexOf('Validé le 12/11/2026') !== -1, text.replace(/\s+/g, ' ').slice(0, 110));

  if (count) {
    await page.click('[data-ack-validation]');
    await page.waitForSelector('.validation-banner', { state: 'detached', timeout: 5000 }).catch(function () {});
  }
  check('« J’ai compris » ferme la confirmation et marque la notification comme lue',
    state.notifs[0].read_at != null && (await page.locator('.validation-banner').count()) === 0);

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  check('pas de confirmation après rechargement', (await page.locator('.validation-banner').count()) === 0);
  check('aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
  await context.close();
}

async function scenarioPending(browser) {
  console.log('\n— Scénario 2 : passage automatique de « en attente » à « validé »');
  const state = { profile: profileRow('pending', null), notifs: [] };
  const context = await openContext(browser, state);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });

  await page.goto(BASE + '#/en-attente', { waitUntil: 'load' });
  await page.waitForSelector('text=en attente de validation', { timeout: 8000 }).catch(function () {});
  check('la page indique que le compte attend la validation', (await page.locator('text=en attente de validation').count()) > 0);

  // L’administrateur valide le compte : la page doit le voir toute seule (contrôle toutes les 15 secondes).
  state.profile = profileRow('active', '2026-11-12T08:30:00Z');
  await page.waitForSelector('text=Votre compte est validé', { timeout: 25000 }).catch(function () {});
  const body = await page.locator('#view').innerText().catch(function () { return ''; });
  check('la confirmation apparaît sans recharger la page', body.indexOf('Votre compte est validé') !== -1, body.replace(/\s+/g, ' ').slice(0, 110));
  check('la confirmation indique la date de validation', body.indexOf('Validé le') !== -1 && body.indexOf('2026') !== -1);
  const href = await page.locator('#view a.btn-primary').first().getAttribute('href').catch(function () { return null; });
  check('le bouton « Commencer » mène au choix de catégorie', href === '#/espace/categorie', String(href));
  check('aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  await scenarioBanner(browser);
  await scenarioPending(browser);
  await browser.close();
  console.log('\nÉchecs : ' + failures);
  process.exitCode = failures ? 1 : 0;
})().catch(function (e) { console.error(e); process.exit(2); });
