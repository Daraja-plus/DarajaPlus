/* Test des photos et de la rubrique « Projets disponibles » (réponses simulées, aucun appel réel à Supabase) :
   1) compression : une image de plus de 3 Mo est réduite sous 3 Mo, au format JPEG ;
   2) inscription : champ photo présent ; photo trop lourde → proposition de compression, puis photo prête ;
   3) Mon compte : une photo compressée est validée, envoyée dans le dossier de l’utilisateur et enregistrée dans le profil ;
      une photo légère s’enregistre sur un clic ;
   4) Mes entreprises : photos d’activité avec légendes (« Sans légende » si absente) ; ajout d’une photo avec légende ;
   5) Projets disponibles (partenaire) : identifiant, projet, statut, photos avec légende ; sollicitation seulement pour
      « Prêt à présenter » ; filtre par secteur ; lien du menu ;
   6) aucune erreur JavaScript et aucun « undefined », « null » ou « NaN ».
   Usage :
     1) servir le dossier :  python3 -m http.server 8765   (depuis le dossier DarajaPlus)
     2) lancer le test   :  node tests/photos.js           (variable BASE pour une autre adresse)
   Prérequis : Playwright avec Chromium installé. */

const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const SB = 'https://nfcfwvrllacpvlcsoycp.supabase.co';
const BEN_ID = '22222222-2222-4222-8222-222222222222';
const AGENT_ID = '33333333-3333-4333-8333-333333333333';
const PARTNER_ID = '44444444-4444-4444-8444-444444444444';
const EST_ID = '55555555-5555-4555-8555-555555555555';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const BAD = /\b(undefined|null|NaN)\b/;
const MAX = 3 * 1024 * 1024;
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra ? '  [' + extra + ']' : ''));
}

function benRow(over) {
  return Object.assign({ id: 'b-1', user_id: BEN_ID, nom: 'Test', postnom: 'Demo', prenom: 'Bénéf', phone: '+243800000000',
    email: 'ben@test.local', status: 'active', category: 'ba', code: 'AH1A1Bg1Ba1', agent_id: AGENT_ID, host_id: AGENT_ID,
    sponsor_id: null, quartier_id: null, created_at: '2026-11-12T08:00:00Z' }, over || {});
}

/* state : { profile, ben, links, ents, photos, partner, projects, cstate } ; userId null = visiteur sans session */
async function openContext(browser, state, userId) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.__log = [];
  if (userId) {
    await context.addInitScript((s) => {
      try { localStorage.setItem('daraja.session.v1', JSON.stringify(s)); } catch (e) { /* ignoré */ }
    }, { access_token: 'test-token', refresh_token: 'test-refresh', expires_at: 4102444800, user: { id: userId, email: 'test@test.local' } });
  }
  await context.route(SB + '/**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const m = req.method();
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    context.__log.push({ method: m, path: p, body: req.postData() || '' });
    const reply = (body) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/auth/v1/user') return reply({ id: userId, email: 'test@test.local', aud: 'authenticated' });
    if (p.indexOf('/storage/v1/object/sign/') === 0) return reply({ signedURL: '/object/sign/visuels/photo.png?token=t' });
    if (p.indexOf('/storage/v1/object/visuels/') === 0) return reply({ Key: 'visuels' + p.slice('/storage/v1/object/visuels'.length) });
    if (p === '/rest/v1/profiles') return m === 'PATCH' ? reply([{}]) : reply(state.profile ? [state.profile] : []);
    if (p === '/rest/v1/beneficiaries') return reply(state.ben ? [state.ben] : []);
    if (p === '/rest/v1/beneficiary_establishments') return reply(state.links || []);
    if (p === '/rest/v1/establishments') return reply(state.ents || []);
    if (p === '/rest/v1/establishment_photos') {
      if (m === 'POST') return reply([Object.assign({ id: 'ph-new' }, JSON.parse(req.postData() || '{}'))]);
      return reply(state.photos || []);
    }
    if (p === '/rest/v1/partners') return reply(state.partner ? [state.partner] : []);
    if (p === '/rest/v1/rpc/partner_available_projects') return reply(state.projects || []);
    if (p === '/rest/v1/rpc/beneficiary_category_state') return reply(state.cstate || {});
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
  await page.waitForTimeout(300);
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

async function noticeText(page, scope) {
  return page.locator(scope + ' [data-photo-notice]').innerText().catch(() => '');
}

async function countOf(page, sel) {
  return page.locator(sel).count();
}

/* Image de test : JPEG de bruit (plus de 3 Mo), créé dans la page et renvoyé en base64. */
function bigJpegBase64(page) {
  return page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 2000;
    c.height = 1500;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i++) img.data[i] = (Math.random() * 256) | 0;
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 1));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
}

(async () => {
  const browser = await chromium.launch();
  try {
    /* 1) et 2) Inscription (visiteur sans session) */
    const sg = await visit(await openContext(browser, {}, null), '#/inscription');
    check('inscription : champ photo présent', (await countOf(sg.page, '#signup-photo [data-photo-input]')) === 1);
    const b64 = await bigJpegBase64(sg.page);
    const big = Buffer.from(b64, 'base64');
    check('image de test : plus de 3 Mo', big.length > MAX, (big.length / 1048576).toFixed(1) + ' Mo');

    const unit = await sg.page.evaluate(async (data) => {
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], 'grande photo.jpg', { type: 'image/jpeg' });
      const out = await window.DP.photo.compress(file);
      return { before: file.size, after: out.size, type: out.type, name: out.name, max: window.DP.photo.MAX };
    }, b64);
    check('compression : photo réduite sous 3 Mo', unit.after <= unit.max, (unit.before / 1048576).toFixed(1) + ' Mo → ' + (unit.after / 1048576).toFixed(1) + ' Mo');
    check('compression : format JPEG, nom en .jpg', unit.type === 'image/jpeg' && /\.jpg$/.test(unit.name), unit.name);

    await sg.page.locator('#signup-photo [data-photo-input]').setInputFiles({ name: 'grande-photo.jpg', mimeType: 'image/jpeg', buffer: big });
    const offered = await until(async () => (await countOf(sg.page, '#signup-photo [data-compress]')) === 1, 5000);
    check('inscription : photo trop lourde → proposition de compression', offered, (await noticeText(sg.page, '#signup-photo')).replace(/\s+/g, ' ').slice(0, 120));
    if (offered) {
      await sg.page.locator('#signup-photo [data-compress]').click();
      const done = await until(async () => /Photo compressée/.test(await noticeText(sg.page, '#signup-photo')), 20000);
      const note = await noticeText(sg.page, '#signup-photo');
      check('inscription : photo compressée et prête pour le formulaire', done && /sera enregistrée avec le formulaire/.test(note), note.replace(/\s+/g, ' ').slice(0, 120));
    }
    await sg.page.locator('#signup-photo [data-photo-input]').setInputFiles({ name: 'petite.png', mimeType: 'image/png', buffer: TINY_PNG });
    const small = await until(async () => /Photo prête/.test(await noticeText(sg.page, '#signup-photo')), 5000);
    check('inscription : petite photo prête sans compression', small && (await countOf(sg.page, '#signup-photo [data-compress]')) === 0);
    check('inscription : aucune erreur JavaScript', sg.errors.length === 0, sg.errors.join(' | '));
    await sg.page.context().close();

    /* 3) Mon compte : photo trop lourde, compressée puis enregistrée */
    const sMC = { profile: { id: BEN_ID, role: 'beneficiary', status: 'active', identifiant: 'DP-000001', prenom: 'Bénéf', nom: 'Test', photo_path: null }, ben: benRow() };
    let ctx = await openContext(browser, sMC, BEN_ID);
    let mc = await visit(ctx, '#/mon-compte');
    check('mon compte : champ photo présent', (await countOf(mc.page, '#mc-photo [data-photo-input]')) === 1);
    await mc.page.locator('#mc-photo [data-photo-input]').setInputFiles({ name: 'grande-photo.jpg', mimeType: 'image/jpeg', buffer: big });
    const offeredMC = await until(async () => (await countOf(mc.page, '#mc-photo [data-compress]')) === 1, 5000);
    check('mon compte : photo trop lourde → proposition de compression', offeredMC);
    if (offeredMC) {
      await mc.page.locator('#mc-photo [data-compress]').click();
      const saved = await until(async () => /validée et enregistrée/.test(await noticeText(mc.page, '#mc-photo')), 25000);
      check('mon compte : photo compressée, validée et enregistrée', saved, (await noticeText(mc.page, '#mc-photo')).replace(/\s+/g, ' ').slice(0, 140));
      const upload = ctx.__log.find((e) => e.method === 'POST' && e.path.indexOf('/storage/v1/object/visuels/' + BEN_ID + '/photo-') === 0);
      check('mon compte : envoi dans le dossier de l’utilisateur', !!upload, upload ? upload.path : 'absent');
      const patch = ctx.__log.find((e) => e.method === 'PATCH' && e.path === '/rest/v1/profiles');
      check('mon compte : chemin de la photo enregistré dans le profil', !!patch && patch.body.indexOf('"photo_path":"' + BEN_ID + '/photo-') !== -1, patch ? patch.body.slice(0, 120) : 'absent');
    }
    check('mon compte : aucune erreur JavaScript', mc.errors.length === 0, mc.errors.join(' | '));
    check('mon compte : aucun « undefined », « null » ou « NaN »', !BAD.test(mc.text), (mc.text.match(BAD) || [''])[0]);
    await ctx.close();

    /* 3 bis) Mon compte : petite photo, enregistrement sur un clic */
    ctx = await openContext(browser, sMC, BEN_ID);
    mc = await visit(ctx, '#/mon-compte');
    await mc.page.locator('#mc-photo [data-photo-input]').setInputFiles({ name: 'petite.png', mimeType: 'image/png', buffer: TINY_PNG });
    const offerSave = await until(async () => (await countOf(mc.page, '#mc-photo [data-save]')) === 1, 5000);
    check('mon compte : petite photo → bouton « Enregistrer la photo »', offerSave);
    if (offerSave) {
      await mc.page.locator('#mc-photo [data-save]').click();
      const ok = await until(async () => /Photo enregistrée/.test(await noticeText(mc.page, '#mc-photo')), 15000);
      check('mon compte : photo enregistrée sur un clic', ok && ctx.__log.some((e) => e.method === 'PATCH' && e.path === '/rest/v1/profiles'));
    }
    check('mon compte (photo légère) : aucune erreur JavaScript', mc.errors.length === 0, mc.errors.join(' | '));
    await ctx.close();

    /* 4) Mes entreprises : photos d’activité avec légendes ; ajout d’une photo avec légende */
    const sE = { profile: sMC.profile, ben: benRow(), links: [{ establishment_id: EST_ID }],
      ents: [{ id: EST_ID, name: 'Atelier Test', sector: 'Commerce', address: 'Marché central', phone: '+243800000001',
        description: 'Vente de tissus', services: 'Couture ; retouches', logo_path: null, verification_status: 'to_verify', class: 'R3',
        quartier_id: null, created_at: '2026-11-12T08:00:00Z' }],
      photos: [{ id: 'ph-1', establishment_id: EST_ID, storage_path: BEN_ID + '/a.png', caption: 'Étal du marché', created_at: '2026-11-12T09:00:00Z' },
               { id: 'ph-2', establishment_id: EST_ID, storage_path: BEN_ID + '/b.png', caption: null, created_at: '2026-11-12T09:05:00Z' }] };
    ctx = await openContext(browser, sE, BEN_ID);
    const ent = await visit(ctx, '#/espace/entreprises');
    check('entreprises : sélecteur d’entreprise présent', (await countOf(ent.page, '#act-pick')) === 1);
    check('entreprises : légende affichée', ent.text.indexOf('Étal du marché') !== -1, ent.text.replace(/\s+/g, ' ').slice(0, 120));
    check('entreprises : photo sans légende signalée', ent.text.indexOf('Sans légende') !== -1);
    check('entreprises : compteur 2 / 10', /2\s*\/\s*10/.test(ent.text));
    check('entreprises : champ photo et légende du formulaire présents', (await countOf(ent.page, '#act-photo-field [data-photo-input]')) === 1 && (await countOf(ent.page, '#act-caption')) === 1);
    await ent.page.locator('#act-photo-field [data-photo-input]').setInputFiles({ name: 'vitrine.png', mimeType: 'image/png', buffer: TINY_PNG });
    await ent.page.locator('#act-caption').fill('Vitrine du magasin');
    await ent.page.locator('#f-act-photo').evaluate((f) => f.requestSubmit());
    const inserted = await until(async () => ctx.__log.some((e) => e.method === 'POST' && e.path === '/rest/v1/establishment_photos'), 10000);
    const ins = ctx.__log.find((e) => e.method === 'POST' && e.path === '/rest/v1/establishment_photos');
    check('entreprises : photo d’activité ajoutée avec sa légende', inserted && ins.body.indexOf('"caption":"Vitrine du magasin"') !== -1 && ins.body.indexOf('"establishment_id":"' + EST_ID + '"') !== -1, ins ? ins.body.slice(0, 160) : 'absent');
    check('entreprises : photo envoyée dans le dossier de l’utilisateur', ctx.__log.some((e) => e.method === 'POST' && e.path.indexOf('/storage/v1/object/visuels/' + BEN_ID + '/photo-') === 0));
    check('entreprises : aucune erreur JavaScript', ent.errors.length === 0, ent.errors.join(' | '));
    check('entreprises : aucun « undefined », « null » ou « NaN »', !BAD.test(ent.text), (ent.text.match(BAD) || [''])[0]);
    await ctx.close();

    /* 5) Partenaire : rubrique « Projets disponibles » */
    const rowA = { project_id: 'aaaaaaaa-1111-4111-8111-111111111111', reference: 'aaaaaaaa', title: 'Achat de matériel', sector: 'commerce',
      description: 'Acheter une machine à coudre', use_of_funds: 'Machine et fil', amount: 300, currency: 'USD', due_date: '2027-03-31',
      status: 'ready', created_at: '2026-11-10T08:00:00Z', beneficiary_identifiant: 'DP-000001', category: 'ba',
      establishment_name: 'Atelier Test', establishment_sector: 'Commerce', establishment_description: 'Vente de tissus', establishment_services: 'Couture',
      photos: [{ id: 'ph-1', path: BEN_ID + '/a.png', caption: 'Étal du marché' }], connection_status: null };
    const rowB = Object.assign({}, rowA, { project_id: 'bbbbbbbb-2222-4222-8222-222222222222', title: 'Stock de tissus', status: 'in_progress',
      beneficiary_identifiant: 'DP-000002', photos: [] });
    const rowC = Object.assign({}, rowA, { project_id: 'cccccccc-3333-4333-8333-333333333333', title: 'Extension du local', status: 'ready',
      connection_status: 'requested', photos: [] });
    const sP = { profile: { id: PARTNER_ID, role: 'partner', status: 'active', prenom: 'Banque', nom: 'Test', photo_path: null },
      partner: { id: 'pt-1', profile_id: PARTNER_ID, legal_name: 'Banque Test', category: 'bank', status: 'active' },
      projects: [rowA, rowB, rowC] };
    ctx = await openContext(browser, sP, PARTNER_ID);
    const pr = await visit(ctx, '#/partenaire/recherche');
    check('projets disponibles : titre de la rubrique', pr.text.indexOf('Projets disponibles') !== -1);
    check('projets disponibles : ancien libellé retiré', pr.text.indexOf('Rechercher des projets') === -1);
    check('projets disponibles : trois projets validés affichés', (await countOf(pr.page, '#results article.card')) === 3, pr.text.replace(/\s+/g, ' ').slice(0, 140));
    check('projets disponibles : identifiants des bénéficiaires affichés', pr.text.indexOf('DP-000001') !== -1 && pr.text.indexOf('DP-000002') !== -1);
    check('projets disponibles : statuts affichés', pr.text.indexOf('Prêt à présenter') !== -1 && pr.text.indexOf('En cours') !== -1);
    check('projets disponibles : photo d’activité et légende', (await countOf(pr.page, '#results .gallery-item img')) === 1 && pr.text.indexOf('Étal du marché') !== -1);
    check('projets disponibles : sollicitation seulement pour « Prêt à présenter » sans demande', (await countOf(pr.page, '#results [data-ask]')) === 1);
    check('projets disponibles : demande déjà envoyée indiquée', pr.text.indexOf('Demande de mise en relation') !== -1);
    check('projets disponibles : projet en cours sans sollicitation', /en cours d.accompagnement/.test(pr.text));
    await pr.page.locator('#f-filter input[name="sector"]').fill('commerce');
    await pr.page.locator('#f-filter').evaluate((f) => f.requestSubmit());
    const filtered = await until(async () => ctx.__log.some((e) => e.path === '/rest/v1/rpc/partner_available_projects' && e.body.indexOf('"p_sector":"commerce"') !== -1), 5000);
    check('projets disponibles : filtre par secteur envoyé', filtered);
    const menu = await pr.page.locator('a[href="#/partenaire/recherche"]').first().innerText().catch(() => '');
    check('projets disponibles : lien du menu renommé', /Projets disponibles/.test(menu), menu.trim());
    check('projets disponibles : aucune erreur JavaScript', pr.errors.length === 0, pr.errors.join(' | '));
    check('projets disponibles : aucun « undefined », « null » ou « NaN »', !BAD.test(pr.text), (pr.text.match(BAD) || [''])[0]);
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log(failures ? '\nÉchecs : ' + failures : '\nTous les contrôles sont passés.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
