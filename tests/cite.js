/* Test de la visite de la Cité 1 (« Visiter la Cité 1 DarajaPlus » et « Voir les autres établissements »).
   Réseau simulé : aucun appel à Supabase. 1 200 emplacements factices (12 quartiers), dont 3 occupés.
   Vérifie :
   - chaque rôle voit le bon bouton de menu et la page, avec le code, la catégorie et le statut ;
   - seul l’Administrateur voit les totaux exacts, les noms et les propriétaires ;
   - non-Administrateur : la table etablissements n’est jamais lue (réponse 403 simulée) ;
   - la lecture se fait par tranches de 1 000 : les 1 200 emplacements apparaissent.

   Usage :
     1) servir le dossier :  python3 -m http.server 8765 --directory /chemin/vers/DarajaPlus
     2) lancer le test   :  node tests/cite.js            (variable BASE pour une autre adresse)
   Prérequis : Playwright avec Chromium installé. */

const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const SB = 'https://nfcfwvrllacpvlcsoycp.supabase.co';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS'
};
const NOW = '2026-11-10T10:00:00Z';

const PROFILES = {
  admin: { id: '66666666-6666-4666-8666-666666666666', role: 'admin', status: 'active', province: 'Kinshasa', localite_type: 'ville', localite_nom: 'Gombe', prenom: 'Admin', nom: 'Test', email: 'admin@test.local', code: 'ADM', created_at: NOW },
  host: { id: '33333333-3333-4333-8333-333333333333', role: 'host', status: 'active', province: 'Kinshasa', localite_type: 'ville', localite_nom: 'Gombe', prenom: 'Hôte', nom: 'Test', email: 'hote@test.local', code: 'AH1', zone_id: 1, created_at: NOW },
  agent: { id: '44444444-4444-4444-8444-444444444444', role: 'agent', status: 'active', province: 'Kinshasa', localite_type: 'ville', localite_nom: 'Gombe', prenom: 'Agent', nom: 'Test', email: 'agent@test.local', code: 'AH1A1', zone_id: 1, quartier_id: 1, created_at: NOW },
  beneficiary: { id: '77777777-7777-4777-8777-777777777777', role: 'beneficiary', status: 'active', province: 'Kinshasa', localite_type: 'ville', localite_nom: 'Gombe', prenom: 'Bénéf', nom: 'Test', email: 'ben@test.local', code: 'AH1A1Bb1', category: 'bb', created_at: NOW },
  partner: { id: '55555555-5555-4555-8555-555555555555', role: 'partner', status: 'active', province: 'Kinshasa', localite_type: 'ville', localite_nom: 'Gombe', prenom: 'Partenaire', nom: 'Test', email: 'part@test.local', created_at: NOW }
};

/* Cité 1 : 2 zones (Hôtes), 6 quartiers par zone (Agents), 100 emplacements par quartier. */
const ZONES = [{ id: 1, name: 'Zone 1' }, { id: 2, name: 'Zone 2' }];
const QUARTIERS = [];
for (let i = 1; i <= 12; i++) {
  QUARTIERS.push({ id: i, zone_id: i <= 6 ? 1 : 2, name: 'Quartier ' + i, rang: i <= 6 ? i : i - 6 });
}

/* Trois emplacements occupés, avec leur propriétaire (visibles seulement par l’Administrateur). */
const OCCUPES = {
  '1-1-1': { prenom: 'Jean', nom: 'Dupont', email: 'jean@test.local', code: 'AH1A1Bg1', nom_etab: 'Boutique Dupont' },
  '1-2-1': { prenom: 'Marie', nom: 'Test', email: 'marie@test.local', code: 'AH1A1Bb1', nom_etab: 'Atelier Marie' },
  '7-3-1': { prenom: 'Paul', nom: 'Demo', email: 'paul@test.local', code: 'AH2A1Ba1', nom_etab: null }
};
const RUES = [{ rue: 1, categorie: 'bg', nombre: 10 }, { rue: 2, categorie: 'bb', nombre: 30 }, { rue: 3, categorie: 'ba', nombre: 60 }];
const LIBELLE = { bg: 'Bg', bb: 'Bb', ba: 'Ba' };

function construireEtablissements() {
  const lignes = [];
  const ordre = { bg: 0, bb: 0, ba: 0 };
  for (const q of QUARTIERS) {
    for (const r of RUES) {
      for (let place = 1; place <= r.nombre; place++) {
        ordre[r.categorie]++;
        const code = 'DP-C1-Z' + q.zone_id + 'Q' + q.rang + 'R' + r.rue + 'P' + place + '-H' + q.zone_id + 'A' + q.rang + LIBELLE[r.categorie] + ordre[r.categorie];
        const cle = q.id + '-' + r.rue + '-' + place;
        const o = OCCUPES[cle] || null;
        lignes.push({
          code, zone_id: q.zone_id, quartier_id: q.id, quartier_rang: q.rang, rue: r.rue, categorie: r.categorie,
          place, ordre: ordre[r.categorie], statut: o ? 'occupe' : 'libre',
          nom: o ? o.nom_etab : null,
          owner: o ? { prenom: o.prenom, nom: o.nom, email: o.email, code: o.code } : null
        });
      }
    }
  }
  return lignes;
}
const ETABLISSEMENTS = construireEtablissements();

/* Lignes de la vue (sans nom ni propriétaire), comme le serveur les renvoie aux non-Administrateurs. */
const VISITE = ETABLISSEMENTS.map(function (e) {
  return { code: e.code, zone_id: e.zone_id, quartier_id: e.quartier_id, quartier_rang: e.quartier_rang, rue: e.rue, categorie: e.categorie, place: e.place, ordre: e.ordre, statut: e.statut };
});

function tranche(rows, url) {
  const debut = Number(url.searchParams.get('offset') || 0);
  const taille = Math.min(Number(url.searchParams.get('limit') || 1000), 1000);
  return rows.slice(debut, debut + taille);
}

async function repondre(route, role) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const json = (status, body) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
  if (p === '/auth/v1/user') return json(200, { id: PROFILES[role].id, email: PROFILES[role].email, aud: 'authenticated' });
  if (p.indexOf('/rest/v1/rpc/') === 0) return json(200, {});
  if (p === '/rest/v1/profiles') return json(200, [PROFILES[role]]);
  if (p === '/rest/v1/zones') return json(200, ZONES);
  if (p === '/rest/v1/quartiers') return json(200, QUARTIERS.map(function (q) { return { id: q.id, zone_id: q.zone_id, name: q.name }; }));
  if (p === '/rest/v1/etablissements_visite') return json(200, tranche(VISITE, url));
  if (p === '/rest/v1/etablissements') {
    if (role !== 'admin') return json(403, { code: '42501', message: 'permission denied for table etablissements' });
    return json(200, tranche(ETABLISSEMENTS, url));
  }
  if (p.indexOf('/rest/v1/') === 0) return json(200, []);
  return json(200, []);
}

/* Rôle, adresse à visiter, lien de menu attendu. */
const CAS = [
  { role: 'admin', chemin: '#/cite', lien: '#/cite', admin: true },
  { role: 'host', chemin: '#/cite', lien: '#/cite', admin: false },
  { role: 'agent', chemin: '#/cite', lien: '#/cite', admin: false },
  { role: 'partner', chemin: '#/cite', lien: '#/cite', admin: false },
  { role: 'beneficiary', chemin: '#/espace/etablissements', lien: '#/espace/etablissements', admin: false }
];

async function verifier(browser, cas) {
  const erreurs = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const session = { access_token: 'test-token', refresh_token: 'test-refresh', expires_at: 4102444800, user: { id: PROFILES[cas.role].id, email: PROFILES[cas.role].email } };
  await context.addInitScript((s) => { try { localStorage.setItem('daraja.session.v1', JSON.stringify(s)); } catch (e) { /* ignoré */ } }, session);
  await context.route(SB + '/**', (route) => repondre(route, cas.role));

  const page = await context.newPage();
  page.on('pageerror', (e) => erreurs.push('exception : ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && m.text().indexOf('403') === -1) erreurs.push('console : ' + m.text()); });

  await page.goto(BASE + '#/', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.evaluate((h) => { location.hash = h; }, cas.chemin);
  await page.waitForFunction(() => document.querySelector('#view h1') && !document.querySelector('#view .loading'), null, { timeout: 8000 });

  const titre = await page.textContent('#view h1');
  const liens = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')));

  /* Ouvre la première zone, puis le premier quartier (contenu dessiné à l’ouverture). */
  await page.click('details.cite-zone > summary');
  await page.click('details.cite-quartier > summary');
  await page.waitForSelector('.cite-corps table');

  const bilan = await page.evaluate(() => {
    const texte = document.querySelector('#view').textContent;
    const stats = Array.from(document.querySelectorAll('#view .stat-value')).map((s) => s.textContent.trim());
    const lignes = document.querySelectorAll('.cite-corps tbody tr').length;
    const entetes = Array.from(document.querySelectorAll('#view th')).map((th) => th.textContent.trim());
    return { texte, stats, lignes, entetes };
  });

  await context.close();
  return { cas, titre, liens, bilan, erreurs };
}

function verdict(r) {
  const echecs = [];
  const { cas, titre, liens, bilan } = r;
  const t = bilan.texte;
  const attendre = (ok, message) => { if (!ok) echecs.push(message); };

  attendre(titre === (cas.role === 'beneficiary' ? 'Voir les autres établissements' : 'Visiter la Cité 1 DarajaPlus'), 'titre inattendu : ' + titre);
  attendre(t.indexOf('DP-C1-Z1Q1R1P1-H1A1Bg1') !== -1, 'code d’emplacement absent');
  attendre(t.indexOf('Libre') !== -1 && t.indexOf('Occupé') !== -1, 'statuts libre / occupé absents');
  attendre(bilan.lignes === 100, 'quartier ouvert : 100 lignes attendues, trouvé ' + bilan.lignes);
  attendre(liens.indexOf(cas.lien) !== -1, 'bouton de menu absent : ' + cas.lien);
  const autre = cas.role === 'beneficiary' ? '#/cite' : '#/espace/etablissements';
  attendre(liens.indexOf(autre) === -1, 'lien interdit à ce rôle : ' + autre);
  attendre(r.erreurs.length === 0, 'erreurs JavaScript : ' + r.erreurs.join(' | '));

  if (cas.admin) {
    attendre(bilan.stats.join(',') === '1200,3,1197', 'totaux administrateur inattendus : ' + bilan.stats.join(','));
    attendre(t.indexOf('Propriétaire') !== -1 && t.indexOf('Jean Dupont') !== -1, 'propriétaire absent pour l’Administrateur');
    attendre(t.indexOf('Boutique Dupont') !== -1, 'nom d’établissement absent pour l’Administrateur');
  } else {
    attendre(bilan.stats.length === 0, 'totaux visibles pour un non-Administrateur : ' + bilan.stats.join(','));
    attendre(t.indexOf('Propriétaire') === -1, 'colonne Propriétaire visible pour un non-Administrateur');
    attendre(t.indexOf('Jean Dupont') === -1 && t.indexOf('Boutique Dupont') === -1, 'nom de propriétaire visible pour un non-Administrateur');
  }
  return echecs;
}

(async () => {
  const browser = await chromium.launch();
  let total = 0, echoues = 0;
  try {
    for (const cas of CAS) {
      const r = await verifier(browser, cas);
      const echecs = verdict(r);
      total++;
      if (echecs.length) echoues++;
      console.log((echecs.length ? 'ÉCHEC ' : 'OK    ') + cas.role.padEnd(12) + ' ' + cas.chemin);
      echecs.forEach((e) => console.log('        - ' + e));
    }
  } finally {
    await browser.close();
  }
  console.log('\n' + (total - echoues) + ' / ' + total + ' rôles conformes');
  process.exit(echoues ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
