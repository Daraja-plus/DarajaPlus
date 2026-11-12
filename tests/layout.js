/* Mise en page des espaces privés : affichage téléphone (barre du bas, panneau Menu) et affichage
   ordinateur (menu latéral fixe). Données simulées : aucun appel réel à Supabase.
   Pour chaque rôle, vérifie : éléments affichés ou cachés selon la largeur, absence de défilement
   horizontal, panneau Menu complet, contenu centré et grille des accès rapides sur ordinateur.
   Enregistre des captures d'écran dans le dossier OUT (par défaut : le dossier de travail temporaire).
   Usage :
     1) servir le dossier :  python3 -m http.server 8765   (depuis le dossier DarajaPlus)
     2) lancer le test   :  node tests/layout.js            (variables BASE et OUT facultatives)
   Prérequis : Playwright avec Chromium installé. */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const OUT = process.env.OUT || '/tmp/claude-0/-home-claude/f217c725-45a5-57c1-8fb7-ddacafe13645/scratchpad/captures-mise-en-page';
const SB = 'https://nfcfwvrllacpvlcsoycp.supabase.co';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1366, height: 800 };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const ROLES = [
  { role: 'admin', home: '#/admin' },
  { role: 'host', home: '#/hote' },
  { role: 'agent', home: '#/agent' },
  { role: 'beneficiary', home: '#/espace' },
  { role: 'partner', home: '#/partenaire' }
];

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra ? '  [' + extra + ']' : ''));
}

function profileRow(role) {
  return { id: USER_ID, role: role, status: 'active', prenom: 'Test', nom: role, postnom: 'Essai', email: 'test@test.local',
    code: 'TST1', category: 'bb', requested_role: role, validated_at: '2026-11-10T10:00:00Z', created_at: '2026-11-10T10:00:00Z',
    phone: null, zone_id: null, host_id: null, agent_id: null, quartier_id: null, rejection_reason: null };
}

/* Session simulée et réponses vides de la base (la structure des pages est ce qui est vérifié ici). */
async function openContext(browser, role, viewport) {
  const context = await browser.newContext({ viewport: viewport });
  await context.addInitScript(`try { localStorage.setItem('daraja.session.v1', JSON.stringify({ access_token: 't', refresh_token: 'r',
    expires_at: 4102444800, user: { id: '${USER_ID}', email: 'test@test.local' } })); } catch (e) {}`);
  await context.route(SB + '/**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const reply = (body) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (p === '/auth/v1/user') return reply({ id: USER_ID, email: 'test@test.local', aud: 'authenticated' });
    if (p === '/rest/v1/profiles') return reply([profileRow(role)]);
    if (p.indexOf('/rest/v1/rpc/') === 0) return reply({});
    return reply([]);
  });
  return context;
}

async function openPage(context, hash) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + hash);
  await page.waitForSelector('#view .page-head, #view .card, #view .empty, #view .alert, #view .public-view', { timeout: 15000 });
  await page.waitForTimeout(300);
  return { page: page, errors: errors };
}

/* Un élément est « affiché » s'il existe, n'est pas masqué par le style et a une taille non nulle. */
function visible(page, selector) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  }, selector);
}

function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function scenarioPhone(browser, r) {
  const context = await openContext(browser, r.role, PHONE);
  const { page, errors } = await openPage(context, r.home);
  const tag = r.role + ' téléphone';
  check(tag + ' : barre du bas affichée', await visible(page, '.tabbar'));
  check(tag + ' : menu latéral caché', !(await visible(page, '.sidebar')));
  const tabCount = await page.locator('.tabbar > *').count();
  check(tag + ' : 5 boutons dans la barre du bas', tabCount === 5, tabCount + ' bouton(s)');
  const overflow = await horizontalOverflow(page);
  check(tag + ' : pas de défilement horizontal', overflow <= 1, 'débordement ' + overflow + ' px');

  await page.click('[data-menu-open]');
  check(tag + ' : panneau Menu ouvert', await visible(page, '#menu-sheet'));
  const sheetLinks = await page.$$eval('#menu-sheet .sheet-nav a', function (as) { return as.map(function (a) { return a.getAttribute('href'); }); });
  const sideLinks = await page.$$eval('.side-nav a', function (as) { return as.map(function (a) { return a.getAttribute('href'); }); });
  check(tag + ' : le panneau Menu reprend tous les liens du rôle', sheetLinks.length > 0 && sheetLinks.join() === sideLinks.join(),
    sheetLinks.length + ' lien(s)');
  await page.keyboard.press('Escape');
  check(tag + ' : Échap ferme le panneau', !(await visible(page, '#menu-sheet')));

  await page.screenshot({ path: path.join(OUT, r.role + '-telephone.png'), fullPage: true });
  check(tag + ' : aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
  await context.close();
}

async function scenarioDesktop(browser, r) {
  const context = await openContext(browser, r.role, DESKTOP);
  const { page, errors } = await openPage(context, r.home);
  const tag = r.role + ' ordinateur';
  check(tag + ' : menu latéral affiché', await visible(page, '.sidebar'));
  check(tag + ' : barre du bas cachée', !(await visible(page, '.tabbar')));
  const viewWidth = await page.evaluate(() => document.querySelector('.shell > .view').getBoundingClientRect().width);
  check(tag + ' : contenu limité à 1120 px', viewWidth <= 1121, Math.round(viewWidth) + ' px');
  const overflow = await horizontalOverflow(page);
  check(tag + ' : pas de défilement horizontal', overflow <= 1, 'débordement ' + overflow + ' px');
  if (await page.locator('.quick-links').count()) {
    const cols = await page.$eval('.quick-links', function (el) { return getComputedStyle(el).gridTemplateColumns.split(' ').length; });
    check(tag + ' : accès rapides sur 3 colonnes', cols === 3, cols + ' colonne(s)');
  } else {
    console.log('note ' + tag + ' : pas d’accès rapides affichés sur cette page (données vides simulées)');
  }
  await page.screenshot({ path: path.join(OUT, r.role + '-ordinateur.png'), fullPage: true });
  check(tag + ' : aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
  await context.close();
}

/* Les pages publiques (accueil) ne reçoivent ni barre du bas ni menu privé. */
async function scenarioPublicPhone(browser) {
  const context = await browser.newContext({ viewport: PHONE });
  await context.route(SB + '/**', (route) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '[]' }));
  const page = await context.newPage();
  await page.goto(BASE + '#/');
  await page.waitForSelector('#view', { timeout: 15000 });
  await page.waitForTimeout(300);
  check('accueil public téléphone : pas de barre du bas', (await page.locator('.tabbar').count()) === 0);
  check('accueil public téléphone : pas de défilement horizontal', (await horizontalOverflow(page)) <= 1);
  await context.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const r of ROLES) {
      await scenarioPhone(browser, r);
      await scenarioDesktop(browser, r);
    }
    await scenarioPublicPhone(browser);
  } finally {
    await browser.close();
  }
  console.log('Captures : ' + OUT);
  console.log(failures ? failures + ' vérification(s) en échec' : 'Toutes les vérifications de mise en page sont passées.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
