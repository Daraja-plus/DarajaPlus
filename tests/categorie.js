/* Test des écrans « catégorie » avec des réponses simulées des fonctions métier (aucun appel réel à Supabase) :
   1) bénéficiaire pas encore affecté : choix possible, mention « attend la validation de votre Agent » ;
   2) bénéficiaire affecté avec une proposition : rang, places restantes, boutons Accepter et Refuser, étape 1 à l’accueil ;
   3) bénéficiaire validé : catégorie et code affichés, plus de choix ;
   4) profil : identifiant affiché ; entreprises : liste vide et formulaire présent ;
   5) agent : tableau des fiches en attente et ouverture de la proposition ;
   6) aucune page ne montre « undefined », « null » ou « NaN », et aucune erreur JavaScript.
   Usage :
     1) servir le dossier :  python3 -m http.server 8765   (depuis le dossier DarajaPlus)
     2) lancer le test   :  node tests/categorie.js        (variable BASE pour une autre adresse)
   Prérequis : Playwright avec Chromium installé. */

const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const SB = 'https://nfcfwvrllacpvlcsoycp.supabase.co';
const BEN_ID = '22222222-2222-4222-8222-222222222222';
const AGENT_ID = '33333333-3333-4333-8333-333333333333';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const BAD = /\b(undefined|null|NaN)\b/;

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra ? '  [' + extra + ']' : ''));
}

function benRow(over) {
  return Object.assign({ id: 'b-1', user_id: BEN_ID, nom: 'Test', postnom: 'Demo', prenom: 'Bénéf', phone: '+243800000000',
    email: 'ben@test.local', status: 'draft', category: null, code: null, agent_id: null, host_id: null, sponsor_id: null,
    quartier_id: null, created_at: '2026-11-12T08:00:00Z' }, over || {});
}

/* state : { profile, ben, cstate, board, pageErrors } */
async function openContext(browser, state, userId, role) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript((s) => {
    try { localStorage.setItem('daraja.session.v1', JSON.stringify(s)); } catch (e) { /* ignoré */ }
  }, { access_token: 'test-token', refresh_token: 'test-refresh', expires_at: 4102444800, user: { id: userId, email: 'test@test.local' } });

  await context.route(SB + '/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (body) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (p === '/auth/v1/user') return reply({ id: userId, email: 'test@test.local', aud: 'authenticated' });
    if (p === '/rest/v1/profiles') return reply([state.profile]);
    if (p === '/rest/v1/beneficiaries') return reply(state.ben ? [state.ben] : []);
    if (p === '/rest/v1/notifications') return reply([]);
    if (p === '/rest/v1/rpc/beneficiary_category_state') return reply(state.cstate || {});
    if (p === '/rest/v1/rpc/agent_category_board') return reply(state.board || { quota: {}, waiting: [], sponsors: [] });
    if (p.indexOf('/rest/v1/rpc/') === 0) return reply({});
    return reply([]);
  });
  context.__role = role;
  return context;
}

async function visit(context, hash) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  await page.goto(BASE + hash, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const v = document.querySelector('#view');
    return v && v.innerText.trim().length > 60;
  }, null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
  const text = await page.locator('#view').innerText().catch(() => '');
  return { page, errors, text };
}

(async () => {
  const browser = await chromium.launch();
  try {
    /* 1) Pas encore affecté, aucun choix */
    const s1 = { profile: { id: BEN_ID, role: 'beneficiary', status: 'active', identifiant: 'DP-000001', prenom: 'Bénéf', nom: 'Test', photo_path: null, validated_at: '2026-11-12T08:30:00Z' },
      ben: benRow({}), cstate: { status: 'draft', identifiant: 'DP-000001', code: null, category: null, wish: null, wish_at: null, affected: false, agent: null, places: {}, proposal: null } };
    let ctx = await openContext(browser, s1, BEN_ID, 'beneficiary');
    let r = await visit(ctx, '#/espace/categorie');
    check('non affecté : les trois catégories sont proposées', r.text.indexOf('Alpha') !== -1 && r.text.indexOf('Bêta') !== -1 && r.text.indexOf('Gamma') !== -1);
    check('non affecté : le choix attend la validation après affectation', r.text.indexOf('après votre affectation') !== -1, r.text.replace(/\s+/g, ' ').slice(0, 120));
    check('non affecté : trois boutons de choix', (await r.page.locator('[data-wish]').count()) === 3);
    check('non affecté : pas de proposition à accepter', (await r.page.locator('[data-accept]').count()) === 0);
    check('non affecté : aucune erreur JavaScript', r.errors.length === 0, r.errors.join(' | '));
    check('non affecté : aucun « undefined », « null » ou « NaN »', !BAD.test(r.text), (r.text.match(BAD) || [''])[0]);
    await ctx.close();

    /* 2) Affecté, proposition ouverte : Bêta, rang 3 sur 30 */
    const s2 = { profile: Object.assign({}, s1.profile, { wish_category: 'bb', wish_at: '2026-11-12T09:00:00Z' }),
      ben: benRow({ agent_id: AGENT_ID }),
      cstate: { status: 'draft', identifiant: 'DP-000001', code: null, category: null, wish: 'bb', wish_at: '2026-11-12T09:00:00Z', affected: true,
        agent: { name: 'Agent Test' }, places: { ba: { total: 60, taken: 10, left: 50 }, bb: { total: 30, taken: 2, left: 28 }, bg: { total: 10, taken: 9, left: 1 } },
        proposal: { id: 'p-1', category: 'bb', rank: 3, total: 30, left: 28, sponsor_code: 'AH1A1Bg1' } } };
    ctx = await openContext(browser, s2, BEN_ID, 'beneficiary');
    r = await visit(ctx, '#/espace/categorie');
    check('proposition : rang et total affichés', r.text.indexOf('rang 3 sur 30') !== -1, r.text.replace(/\s+/g, ' ').slice(0, 140));
    check('proposition : boutons Accepter et Refuser', (await r.page.locator('[data-accept]').count()) === 1 && (await r.page.locator('[data-refuse]').count()) === 1);
    check('proposition : parrain affiché', r.text.indexOf('AH1A1Bg1') !== -1);
    check('proposition : aucune erreur JavaScript', r.errors.length === 0, r.errors.join(' | '));
    check('proposition : aucun « undefined », « null » ou « NaN »', !BAD.test(r.text), (r.text.match(BAD) || [''])[0]);
    const home = await visit(ctx, '#/espace');
    check('accueil : étape 1 et proposition mentionnée', home.text.indexOf('Étape 1') !== -1 && home.text.indexOf('Bêta') !== -1, home.text.replace(/\s+/g, ' ').slice(0, 120));
    check('accueil : aucune erreur JavaScript', home.errors.length === 0, home.errors.join(' | '));
    check('accueil : aucun « undefined », « null » ou « NaN »', !BAD.test(home.text), (home.text.match(BAD) || [''])[0]);
    const prof = await visit(ctx, '#/espace/profil');
    check('profil : identifiant affiché', prof.text.indexOf('DP-000001') !== -1);
    check('profil : aucune erreur JavaScript', prof.errors.length === 0, prof.errors.join(' | '));
    check('profil : aucun « undefined », « null » ou « NaN »', !BAD.test(prof.text), (prof.text.match(BAD) || [''])[0]);
    const ent = await visit(ctx, '#/espace/entreprises');
    check('entreprises : formulaire et liste vide', (await ent.page.locator('#f-ent').count()) === 1 && ent.text.indexOf('Aucune entreprise') !== -1);
    check('entreprises : aucune erreur JavaScript', ent.errors.length === 0, ent.errors.join(' | '));
    await ctx.close();

    /* 3) Validé : catégorie Alpha, code, plus de choix */
    const s3 = { profile: Object.assign({}, s1.profile, { wish_category: 'ba' }),
      ben: benRow({ status: 'active', category: 'ba', code: 'AH1A1Bg1Ba1', agent_id: AGENT_ID, host_id: AGENT_ID }),
      cstate: { status: 'active', identifiant: 'DP-000001', code: 'AH1A1Bg1Ba1', category: 'ba', wish: 'ba', wish_at: null, affected: true, agent: { name: 'Agent Test' }, places: {}, proposal: null } };
    ctx = await openContext(browser, s3, BEN_ID, 'beneficiary');
    r = await visit(ctx, '#/espace/categorie');
    check('validé : catégorie et code affichés', r.text.indexOf('AH1A1Bg1Ba1') !== -1 && r.text.indexOf('Ba — Alpha') !== -1, r.text.replace(/\s+/g, ' ').slice(0, 120));
    check('validé : plus de bouton de choix', (await r.page.locator('[data-wish]').count()) === 0);
    check('validé : aucune erreur JavaScript', r.errors.length === 0, r.errors.join(' | '));
    check('validé : aucun « undefined », « null » ou « NaN »', !BAD.test(r.text), (r.text.match(BAD) || [''])[0]);
    await ctx.close();

    /* 5) Agent : fiche en attente et proposition */
    const sa = { profile: { id: AGENT_ID, role: 'agent', status: 'active', prenom: 'Agent', nom: 'Test', code: 'AH1A1', host_id: null, zone_id: 1 },
      board: { quota: { ba: { total: 60, taken: 10, left: 50 }, bb: { total: 30, taken: 2, left: 28 }, bg: { total: 10, taken: 9, left: 1 } },
        waiting: [{ beneficiary_id: 'b-1', identifiant: 'DP-000001', prenom: 'Bénéf', nom: 'Test', phone: '+243800000000', wish: 'bb',
          wish_at: '2026-11-12T09:00:00Z', created_at: '2026-11-12T08:00:00Z', proposal: null }],
        sponsors: [{ id: 's-1', code: 'AH1A1Bg1', category: 'bg', prenom: 'Parrain', nom: 'Un', children: 3, max: 3 },
                   { id: 's-2', code: 'AH1A1Bg2', category: 'bg', prenom: 'Parrain', nom: 'Deux', children: 0, max: 3 }] } };
    ctx = await openContext(browser, sa, AGENT_ID, 'agent');
    r = await visit(ctx, '#/agent/categories');
    check('agent : fiche en attente listée avec son identifiant', r.text.indexOf('DP-000001') !== -1, r.text.replace(/\s+/g, ' ').slice(0, 120));
    check('agent : quota affiché', r.text.indexOf('Gamma') !== -1 && r.text.indexOf('9') !== -1);
    check('agent : aucune erreur JavaScript', r.errors.length === 0, r.errors.join(' | '));
    check('agent : aucun « undefined », « null » ou « NaN »', !BAD.test(r.text), (r.text.match(BAD) || [''])[0]);
    const btn = r.page.locator('[data-propose]').first();
    if ((await btn.count()) === 1) {
      await btn.click();
      await r.page.waitForTimeout(400);
      const body = await r.page.locator('body').innerText();
      check('agent : la proposition indique le rang prévu', body.indexOf('Rang prévu') !== -1);
    } else {
      check('agent : bouton de proposition présent', false, 'absent');
    }
    check('agent : aucune erreur JavaScript après ouverture', r.errors.length === 0, r.errors.join(' | '));
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log(failures ? '\nÉchecs : ' + failures : '\nTous les contrôles sont passés.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
