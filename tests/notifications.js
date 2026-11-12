/* Test des notifications sur téléphone (Web Push) avec des données simulées : aucun appel réel à Supabase
   ni aux services de notification du navigateur (l'abonnement est remplacé par un faux abonnement).
   Vérifie : activation, désactivation, données envoyées (clé VAPID, appareil), et message affiché selon
   la situation (navigateur non compatible, iPhone hors application installée, notifications bloquées).
   Usage :
     1) servir le dossier :  python3 -m http.server 8765   (depuis le dossier DarajaPlus)
     2) lancer le test   :  node tests/notifications.js     (variable BASE pour une autre adresse)
   Prérequis : Playwright avec Chromium installé. */

const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const SB = 'https://nfcfwvrllacpvlcsoycp.supabase.co';
const BEN_ID = '22222222-2222-4222-8222-222222222222';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/test-appareil-1';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra ? '  [' + extra + ']' : ''));
}

/* Faux abonnement du navigateur : enregistre la clé VAPID demandée et le désabonnement. */
const FAKE_PUSH = `
  (() => {
    let sub = null;
    window.__push = { keyLength: 0, keyFirstByte: null, unsubscribed: false };
    PushManager.prototype.getSubscription = async function () { return sub; };
    PushManager.prototype.subscribe = async function (opts) {
      const key = new Uint8Array(opts.applicationServerKey);
      window.__push.keyLength = key.length;
      window.__push.keyFirstByte = key[0];
      sub = {
        endpoint: ${JSON.stringify(ENDPOINT)},
        toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'ClePlaceholder', auth: 'AuthPlaceholder' } }; },
        async unsubscribe() { window.__push.unsubscribed = true; sub = null; return true; }
      };
      return sub;
    };
  })();`;

function profileRow() {
  return { id: BEN_ID, role: 'beneficiary', status: 'active', prenom: 'Bénéf', nom: 'Test', email: 'ben@test.local',
    code: 'AH1A1Bb1', category: 'bb', requested_role: 'beneficiary', validated_at: '2026-11-10T10:00:00Z',
    created_at: '2026-11-10T10:00:00Z', phone: null, zone_id: null, host_id: null, agent_id: null, quartier_id: null, rejection_reason: null };
}

async function openContext(browser, { userAgent, extraInit } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('daraja.session.v1', JSON.stringify({ access_token: 'test-token', refresh_token: 'test-refresh',
        expires_at: 4102444800, user: { id: '22222222-2222-4222-8222-222222222222', email: 'ben@test.local' } }));
    } catch (e) { /* ignoré */ }
  });
  await context.addInitScript(FAKE_PUSH);
  if (extraInit) await context.addInitScript(extraInit);

  const calls = { rpc: [], deletes: [] };
  await context.route(SB + '/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (body) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (p === '/auth/v1/user') return reply({ id: BEN_ID, email: 'ben@test.local', aud: 'authenticated' });
    if (p === '/rest/v1/profiles') return reply([profileRow()]);
    if (p === '/rest/v1/notifications') return reply([]);
    if (p === '/rest/v1/rpc/push_register_subscription') {
      calls.rpc.push(JSON.parse(req.postData() || '{}'));
      return reply(null);
    }
    if (p === '/rest/v1/push_subscriptions' && req.method() === 'DELETE') {
      calls.deletes.push(url.searchParams.get('endpoint'));
      return reply([]);
    }
    return reply([]);
  });
  return { context, calls };
}

async function openAccount(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '#/mon-compte');
  await page.waitForSelector('#push-box p', { timeout: 15000 });
  return { page, errors };
}

/* Permission simulée : « pas encore décidée », puis « accordée » après la demande (le navigateur de test refuse par défaut). */
const PERMISSION_ASK_THEN_GRANT = `
  (() => {
    let perm = 'default';
    Object.defineProperty(Notification, 'permission', { get: () => perm, configurable: true });
    Notification.requestPermission = async () => { perm = 'granted'; return 'granted'; };
  })();`;

async function scenarioActive(browser) {
  const { context, calls } = await openContext(browser, { extraInit: PERMISSION_ASK_THEN_GRANT });
  const { page, errors } = await openAccount(context);

  const activate = page.locator('#push-box button[data-push="on"]');
  await activate.waitFor({ timeout: 15000 });
  check('état initial : bouton « Activer les notifications » affiché', true);
  await activate.click();
  await page.waitForSelector('#push-box button[data-push="off"]', { timeout: 10000 });

  const push = await page.evaluate(() => window.__push);
  check('abonnement : clé VAPID publique transmise au navigateur (65 octets, format non compressé)',
    push.keyLength === 65 && push.keyFirstByte === 4, 'longueur ' + push.keyLength);
  check('enregistrement : appareil envoyé à la base (endpoint et clés)',
    calls.rpc.length === 1 && calls.rpc[0].p_endpoint === ENDPOINT && calls.rpc[0].p_auth === 'AuthPlaceholder' && calls.rpc[0].p_p256dh === 'ClePlaceholder',
    'appels : ' + calls.rpc.length);
  check('après activation : bouton « Désactiver » affiché', await page.locator('#push-box button[data-push="off"]').count() === 1);

  await page.locator('#push-box button[data-push="off"]').click();
  await page.waitForSelector('#push-box button[data-push="on"]', { timeout: 10000 });
  const after = await page.evaluate(() => window.__push);
  check('désactivation : abonnement supprimé dans la base pour cet appareil',
    calls.deletes.length === 1 && calls.deletes[0] === 'eq.' + ENDPOINT, 'suppressions : ' + calls.deletes.length);
  check('désactivation : désabonnement du navigateur', after.unsubscribed === true);
  check('aucune erreur JavaScript (compte actif)', errors.length === 0, errors.join(' | '));
  await context.close();
}

async function scenarioDenied(browser) {
  const { context } = await openContext(browser, {
    extraInit: `
      Object.defineProperty(Notification, 'permission', { get: () => 'denied', configurable: true });
      Notification.requestPermission = async () => 'denied';`
  });
  const { page, errors } = await openAccount(context);
  const text = await page.locator('#push-box').innerText();
  check('notifications bloquées : message explicite', text.includes('bloquées'), text.slice(0, 80));
  check('notifications bloquées : aucun bouton d’activation', await page.locator('#push-box button').count() === 0);
  check('aucune erreur JavaScript (bloquées)', errors.length === 0, errors.join(' | '));
  await context.close();
}

async function scenarioIphone(browser) {
  const { context } = await openContext(browser, { userAgent: IPHONE_UA });
  const { page, errors } = await openAccount(context);
  const text = await page.locator('#push-box').innerText();
  check('iPhone hors application installée : explication « Sur l’écran d’accueil »', text.includes('Sur iPhone') && text.includes('écran d’accueil'), text.slice(0, 80));
  check('iPhone hors application installée : aucun bouton', await page.locator('#push-box button').count() === 0);
  check('aucune erreur JavaScript (iPhone)', errors.length === 0, errors.join(' | '));
  await context.close();
}

async function scenarioUnsupported(browser) {
  const { context } = await openContext(browser, { extraInit: 'delete window.PushManager;' });
  const { page, errors } = await openAccount(context);
  const text = await page.locator('#push-box').innerText();
  check('navigateur sans notifications : message de repli', text.includes('ne permet pas'), text.slice(0, 80));
  check('aucune erreur JavaScript (non compatible)', errors.length === 0, errors.join(' | '));
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await scenarioActive(browser);
    await scenarioDenied(browser);
    await scenarioIphone(browser);
    await scenarioUnsupported(browser);
  } finally {
    await browser.close();
  }
  console.log(failures ? failures + ' vérification(s) en échec' : 'Toutes les vérifications des notifications sont passées.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
