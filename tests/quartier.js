/* Test du quartier attribué automatiquement (aucun appel réel à Supabase) :
   1) Agent, « Nouveau bénéficiaire » : plus de champ Quartier ; l’enregistrement n’envoie pas p_quartier ;
   2) Agent, fiche d’un bénéficiaire : plus de champ Quartier ; l’enregistrement n’envoie pas quartier_id ;
   3) aucune erreur JavaScript, aucun « undefined », « null » ou « NaN » sur ces écrans.
   Usage :
     1) servir le dossier :  python3 -m http.server 8765 --bind 127.0.0.1 --directory /chemin/vers/DarajaPlus
     2) lancer le test   :  node tests/quartier.js        (variable BASE pour une autre adresse)
   Prérequis : Playwright avec Chromium installé. */

const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const SB = 'https://nfcfwvrllacpvlcsoycp.supabase.co';
const AGENT_ID = '33333333-3333-4333-8333-333333333333';
const HOST_ID = '44444444-4444-4444-8444-444444444444';
const BEN_ID = '22222222-2222-4222-8222-222222222222';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const BAD = /\b(undefined|null|NaN)\b/;

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra ? '  [' + extra + ']' : ''));
}

function agentProfile() {
  return { id: AGENT_ID, role: 'agent', status: 'active', province: 'Kinshasa', localite_type: 'ville', localite_nom: 'Gombe', prenom: 'Agent', nom: 'Test', email: 'agent@test.local',
    code: 'AH1A1', host_id: HOST_ID, zone_id: 1, quartier_id: 1, created_at: '2026-11-12T08:00:00Z' };
}

function benRow(over) {
  return Object.assign({ id: BEN_ID, code: 'AH1A1Bb1', category: 'bb', nom: 'Nom', postnom: 'Post', prenom: 'Pré',
    phone: '+243000', email: null, agent_id: AGENT_ID, host_id: HOST_ID, quartier_id: 1, sponsor_id: null,
    user_id: null, agent_seq: 1, status: 'active', created_at: '2026-11-12T08:00:00Z' }, over || {});
}

/* state : { ben } ; state.calls reçoit chaque écriture (méthode, chemin, corps). */
async function openContext(browser, state) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript((s) => {
    try { localStorage.setItem('daraja.session.v1', JSON.stringify(s)); } catch (e) { /* ignoré */ }
  }, { access_token: 'test-token', refresh_token: 'test-refresh', expires_at: 4102444800, user: { id: AGENT_ID, email: 'agent@test.local' } });
  state.calls = [];
  await context.route(SB + '/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (body) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (req.method() !== 'GET') state.calls.push({ method: req.method(), path: p, body: req.postData() || '' });
    if (p === '/auth/v1/user') return reply({ id: AGENT_ID, email: 'agent@test.local', aud: 'authenticated' });
    if (p === '/rest/v1/profiles') return reply([agentProfile()]);
    if (p === '/rest/v1/beneficiaries') return reply(url.searchParams.get('id') && state.ben ? [state.ben] : []);
    if (p === '/rest/v1/rpc/agent_quota') return reply({ bg: 1, bb: 2, ba: 3, caps: { bg: 10, bb: 30, ba: 60 } });
    if (p.indexOf('/rest/v1/rpc/') === 0) return reply({});
    return reply([]);
  });
  return context;
}

async function visit(context, hash, waitFor) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  await page.goto(BASE + hash, { waitUntil: 'load' });
  await page.waitForSelector(waitFor, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
  const text = await page.locator('#view').innerText().catch(() => '');
  return { page, errors, text };
}

(async () => {
  const browser = await chromium.launch();
  try {
    /* 1) Nouveau bénéficiaire par l’Agent */
    let state = { ben: null };
    let ctx = await openContext(browser, state);
    let r = await visit(ctx, '#/agent/beneficiaires/nouveau', '#f-new');
    check('nouveau : formulaire présent', (await r.page.locator('#f-new').count()) === 1);
    check('nouveau : aucun champ Quartier', (await r.page.locator('#f-new [name=quartier]').count()) === 0);
    check('nouveau : le quartier est annoncé comme automatique', r.text.indexOf('automatiquement celui de votre Agent') !== -1, r.text.replace(/\s+/g, ' ').slice(0, 160));
    await r.page.selectOption('#f-new [name=category]', 'bg');
    await r.page.fill('#f-new [name=nom]', 'Nom');
    await r.page.fill('#f-new [name=postnom]', 'Post');
    await r.page.fill('#f-new [name=prenom]', 'Pré');
    await r.page.click('#f-new button[type=submit]');
    await r.page.waitForTimeout(600);
    const create = state.calls.find((c) => c.path === '/rest/v1/rpc/create_beneficiary');
    check('nouveau : l’enregistrement appelle create_beneficiary', !!create);
    const createBody = create ? JSON.parse(create.body || '{}') : {};
    check('nouveau : l’appel n’envoie pas p_quartier', create && !Object.prototype.hasOwnProperty.call(createBody, 'p_quartier'), Object.keys(createBody).join(', '));
    check('nouveau : l’appel rattache le bénéficiaire à l’Agent connecté', createBody.p_agent === AGENT_ID);
    check('nouveau : aucune erreur JavaScript', r.errors.length === 0, r.errors.join(' | '));
    check('nouveau : aucun « undefined », « null » ou « NaN »', !BAD.test(r.text), (r.text.match(BAD) || [''])[0]);
    await ctx.close();

    /* 2) Fiche d’un bénéficiaire, modifiée par l’Agent */
    state = { ben: benRow({}) };
    ctx = await openContext(browser, state);
    r = await visit(ctx, '#/agent/beneficiaires/' + BEN_ID, '#f-ben');
    check('fiche : formulaire présent', (await r.page.locator('#f-ben').count()) === 1);
    check('fiche : aucun champ Quartier', (await r.page.locator('#f-ben [name=quartier]').count()) === 0);
    await r.page.click('#f-ben button[type=submit]');
    await r.page.waitForTimeout(600);
    const patch = state.calls.find((c) => c.method === 'PATCH' && c.path === '/rest/v1/beneficiaries');
    check('fiche : la mise à jour est envoyée', !!patch);
    const patchBody = patch ? JSON.parse(patch.body || '{}') : {};
    check('fiche : la mise à jour n’envoie pas quartier_id', patch && !Object.prototype.hasOwnProperty.call(patchBody, 'quartier_id'), Object.keys(patchBody).join(', '));
    check('fiche : la mise à jour garde le nom', patchBody.nom === 'Nom', String(patchBody.nom));
    check('fiche : aucune erreur JavaScript', r.errors.length === 0, r.errors.join(' | '));
    check('fiche : aucun « undefined », « null » ou « NaN »', !BAD.test(r.text), (r.text.match(BAD) || [''])[0]);
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log(failures ? '\nÉchecs : ' + failures : '\nTous les contrôles sont passés.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
