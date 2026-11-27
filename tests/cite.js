/* Test de la visite de la Cité 1 (« Visiter la Cité 1 DarajaPlus » et « Voir les autres établissements »).
   Réseau simulé : aucun appel à Supabase. 1 200 emplacements factices : 2 zones, 6 quartiers par zone,
   100 emplacements par quartier, dont 3 occupés (Jean Dupont, Marie Test, Paul Demo).
   Règles vérifiées (réponses du promoteur, 26 et 27 nov.) :
   - Administrateur : toute la Cité, totaux exacts, propriétaires, colonne « Rendu public » ; il peut publier
     un établissement (appel recordé) ;
   - Hôte : sa zone seulement ; Agent : son quartier seulement ; Agent sans quartier : rien ;
   - Bénéficiaire : toute la Cité 1 ;
   - Partenaire : seulement les établissements rendus publics ; sans publication, un message dédié ;
   - aucun non-Administrateur ne lit la table etablissements ni n’appelle la publication ;
   - aucun non-Administrateur ne voit de propriétaire.

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

const PROFILS = {
  admin: { id: '66666666-6666-4666-8666-666666666666', role: 'admin', status: 'active', prenom: 'Admin', nom: 'Test', email: 'admin@test.local', code: 'ADM', created_at: NOW },
  host: { id: '33333333-3333-4333-8333-333333333333', role: 'host', status: 'active', prenom: 'Hôte', nom: 'Test', email: 'hote@test.local', code: 'AH1', zone_id: 1, created_at: NOW },
  agent: { id: '44444444-4444-4444-8444-444444444444', role: 'agent', status: 'active', prenom: 'Agent', nom: 'Test', email: 'agent@test.local', code: 'AH1A1', zone_id: 1, quartier_id: 1, created_at: NOW },
  beneficiary: { id: '77777777-7777-4777-8777-777777777777', role: 'beneficiary', status: 'active', prenom: 'Bénéf', nom: 'Test', email: 'ben@test.local', code: 'AH1A1Bb1', category: 'bb', created_at: NOW },
  partner: { id: '55555555-5555-4555-8555-555555555555', role: 'partner', status: 'active', prenom: 'Partenaire', nom: 'Test', email: 'part@test.local', created_at: NOW }
};
PROFILS.agent_sans = Object.assign({}, PROFILS.agent, {
  id: '88888888-8888-4888-8888-888888888888', email: 'agent-sans@test.local', code: 'AH1A0', quartier_id: null
});
/* Localisation obligatoire dans le profil : sans elle, l’application renvoie vers « Mon compte ». */
for (const k of Object.keys(PROFILS)) {
  Object.assign(PROFILS[k], { province: 'Kinshasa', localite_type: 'ville', localite_nom: 'Gombe' });
}

/* Cité de test : 2 zones, 6 quartiers par zone, 100 emplacements par quartier. */
const ZONES = [{ id: 1, name: 'Zone 1' }, { id: 2, name: 'Zone 2' }];
const QUARTIERS = [];
for (let i = 1; i <= 12; i++) {
  QUARTIERS.push({ id: i, zone_id: i <= 6 ? 1 : 2, name: 'Quartier ' + i, rang: i <= 6 ? i : i - 6 });
}

/* Occupés : quartier 1 (Bg, R1 P1 et Bb, R2 P1 : pas occupé), quartier 2 Bb, quartier 7 Ba. */
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
        const o = OCCUPES[q.id + '-' + r.rue + '-' + place] || null;
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

/* Lignes de la vue (sans nom, sans propriétaire, sans publication), comme le serveur les renvoie. */
const VISITE = ETABLISSEMENTS.map(function (e) {
  return { code: e.code, zone_id: e.zone_id, quartier_id: e.quartier_id, quartier_rang: e.quartier_rang, rue: e.rue, categorie: e.categorie, place: e.place, ordre: e.ordre, statut: e.statut };
});

/* Ce que la vue renvoie à chaque rôle (réponses du promoteur). */
function visiblesPour(profil, etat) {
  if (profil.role === 'admin' || profil.role === 'beneficiary') return VISITE;
  if (profil.role === 'host') return VISITE.filter((e) => e.zone_id === profil.zone_id);
  if (profil.role === 'agent') return profil.quartier_id ? VISITE.filter((e) => e.quartier_id === profil.quartier_id) : [];
  if (profil.role === 'partner') return VISITE.filter((e) => etat.publies.has(e.code));
  return [];
}

function tranche(rows, url) {
  const debut = Number(url.searchParams.get('offset') || 0);
  const taille = Math.min(Number(url.searchParams.get('limit') || 1000), 1000);
  return rows.slice(debut, debut + taille);
}

async function repondre(route, profil, etat) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const json = (status, body) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
  if (p === '/auth/v1/user') return json(200, { id: profil.id, email: profil.email, aud: 'authenticated' });
  if (p === '/rest/v1/rpc/set_etablissement_publie') {
    const corps = JSON.parse(req.postData() || '{}');
    etat.appels.push(corps);
    if (profil.role !== 'admin') return json(400, { code: 'P0001', message: 'Réservé à l’Administrateur.' });
    if (corps.p_publie) etat.publies.add(corps.p_code); else etat.publies.delete(corps.p_code);
    return json(200, corps.p_publie);
  }
  if (p.indexOf('/rest/v1/rpc/') === 0) return json(200, {});
  if (p === '/rest/v1/profiles') return json(200, [profil]);
  if (p === '/rest/v1/zones') return json(200, ZONES);
  if (p === '/rest/v1/quartiers') return json(200, QUARTIERS.map(function (q) { return { id: q.id, zone_id: q.zone_id, name: q.name }; }));
  if (p === '/rest/v1/etablissements_visite') return json(200, tranche(visiblesPour(profil, etat), url));
  if (p === '/rest/v1/etablissements') {
    etat.lectureTable = true;
    if (profil.role !== 'admin') return json(403, { code: '42501', message: 'permission denied for table etablissements' });
    return json(200, tranche(ETABLISSEMENTS.map((e) => Object.assign({}, e, { publie: etat.publies.has(e.code) })), url));
  }
  if (p.indexOf('/rest/v1/') === 0) return json(200, []);
  return json(200, []);
}

/* Un cas = un rôle, la page visitée, ce qui doit apparaître ou non, et l’état de départ (établissements publiés). */
const CAS = [
  {
    nom: 'administrateur', profil: 'admin', chemin: '#/cite', lien: '#/cite', interdit: '#/espace/etablissements',
    publier: true, admin: true,
    attendu: {
      titre: 'Visiter la Cité 1 DarajaPlus', zones: 2, quartiers: 12, lignes: 100,
      intro: 'totaux exacts', presents: ['Propriétaire', 'Jean Dupont', 'Boutique Dupont', 'Rendu public'], absents: []
    }
  },
  {
    nom: 'hôte', profil: 'host', chemin: '#/cite', lien: '#/cite', admin: false,
    attendu: {
      titre: 'Visiter la Cité 1 DarajaPlus', zones: 1, quartiers: 6, lignes: 100,
      intro: 'votre zone', presents: ['Zone 1', 'Libre'], absents: ['Zone 2', 'Propriétaire', 'Jean Dupont', 'Rendu public']
    }
  },
  {
    nom: 'agent', profil: 'agent', chemin: '#/cite', lien: '#/cite', admin: false,
    attendu: {
      titre: 'Visiter la Cité 1 DarajaPlus', zones: 1, quartiers: 1, lignes: 100,
      intro: 'votre quartier', presents: ['Zone 1', 'Libre'], absents: ['Zone 2', 'Propriétaire', 'Jean Dupont', 'Rendu public']
    }
  },
  {
    nom: 'agent sans quartier', profil: 'agent_sans', chemin: '#/cite', lien: '#/cite', admin: false,
    attendu: {
      titre: 'Visiter la Cité 1 DarajaPlus', zones: 0, quartiers: 0, lignes: 0,
      message: 'Aucun quartier ne vous est encore rattaché', absents: ['Propriétaire', 'Zone 1']
    }
  },
  {
    nom: 'partenaire (rien de publié)', profil: 'partner', chemin: '#/cite', lien: '#/cite', admin: false, publies: [],
    attendu: {
      titre: 'Visiter la Cité 1 DarajaPlus', zones: 0, quartiers: 0, lignes: 0,
      message: 'Aucun établissement n’est encore rendu public par l’Administrateur.', absents: ['Propriétaire', 'Zone 1']
    }
  },
  {
    nom: 'partenaire (2 publiés)', profil: 'partner', chemin: '#/cite', lien: '#/cite', admin: false,
    publies: ['DP-C1-Z1Q1R1P1-H1A1Bg1', 'DP-C1-Z1Q1R1P2-H1A1Bg2'],
    attendu: {
      titre: 'Visiter la Cité 1 DarajaPlus', zones: 1, quartiers: 1, lignes: 2,
      presents: ['DP-C1-Z1Q1R1P1-H1A1Bg1', 'DP-C1-Z1Q1R1P2-H1A1Bg2', 'Libre', 'Occupé'],
      absents: ['Propriétaire', 'Jean Dupont', 'Boutique Dupont', 'Rendu public']
    }
  },
  {
    nom: 'bénéficiaire', profil: 'beneficiary', chemin: '#/espace/etablissements', lien: '#/espace/etablissements', interdit: '#/cite', admin: false,
    attendu: {
      titre: 'Voir les autres établissements', zones: 2, quartiers: 12, lignes: 100,
      presents: ['Libre', 'Occupé'], absents: ['Propriétaire', 'Jean Dupont', 'Rendu public']
    }
  }
];

async function verifier(browser, cas) {
  const profil = PROFILS[cas.profil];
  const etat = { publies: new Set(cas.publies || []), appels: [], lectureTable: false };
  const erreurs = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const session = { access_token: 'test-token', refresh_token: 'test-refresh', expires_at: 4102444800, user: { id: profil.id, email: profil.email } };
  await context.addInitScript((s) => { try { localStorage.setItem('daraja.session.v1', JSON.stringify(s)); } catch (e) { /* ignoré */ } }, session);
  await context.route(SB + '/**', (route) => repondre(route, profil, etat));

  const page = await context.newPage();
  page.on('pageerror', (e) => erreurs.push('exception : ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && m.text().indexOf('403') === -1 && m.text().indexOf('400') === -1) erreurs.push('console : ' + m.text()); });

  await page.goto(BASE + '#/', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.evaluate((h) => { location.hash = h; }, cas.chemin);
  await page.waitForFunction(() => document.querySelector('#view h1') && !document.querySelector('#view .loading'), null, { timeout: 8000 });

  const titre = await page.textContent('#view h1');
  const liens = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')));
  const zones = await page.locator('details.cite-zone').count();
  const quartiers = await page.locator('details.cite-quartier').count();

  /* Ouvre la première zone, puis le premier quartier (contenu dessiné à l’ouverture). */
  let lignes = 0;
  if (zones > 0) {
    await page.click('details.cite-zone > summary');
    await page.click('details.cite-quartier > summary');
    await page.waitForSelector('.cite-corps table');
    lignes = await page.evaluate(() => Array.from(document.querySelectorAll('.cite-corps tbody tr'))
      .filter((tr) => tr.textContent.indexOf('Aucun emplacement') === -1).length);
  }

  let libelleApres = null;
  if (cas.publier) {
    try {
      await page.waitForSelector('.cite-corps button[data-publie]', { timeout: 5000 });
      await page.click('.cite-corps button[data-publie]');
      await page.waitForSelector('#toasts .toast-ok', { timeout: 5000 });
      libelleApres = await page.textContent('.cite-corps button[data-publie]');
    } catch (e) {
      const extrait = await page.evaluate(() => {
        const c = document.querySelector('.cite-corps');
        return c ? c.innerHTML.slice(0, 400) : 'pas de .cite-corps';
      });
      erreurs.push('publication impossible : ' + e.message.split('\n')[0] + ' | HTML : ' + extrait);
    }
  }

  const bilan = await page.evaluate(() => {
    const vue = document.querySelector('#view');
    return {
      texte: vue ? vue.textContent : '',
      stats: Array.from(document.querySelectorAll('#view .stat-value')).map((s) => s.textContent.trim()),
      entetes: Array.from(document.querySelectorAll('#view th')).map((th) => th.textContent.trim()),
      boutons: document.querySelectorAll('button[data-publie]').length
    };
  });

  await context.close();
  return { cas, titre, liens, zones, quartiers, lignes, libelleApres, bilan, erreurs, lectureTable: etat.lectureTable, appels: etat.appels };
}

function verdict(r) {
  const echecs = [];
  const { cas, titre, liens, bilan } = r;
  const a = cas.attendu;
  const t = bilan.texte;
  const attendre = (ok, message) => { if (!ok) echecs.push(message); };

  attendre(titre === a.titre, 'titre inattendu : ' + titre);
  attendre(liens.indexOf(cas.lien) !== -1, 'bouton de menu absent : ' + cas.lien);
  if (cas.interdit) attendre(liens.indexOf(cas.interdit) === -1, 'lien interdit à ce rôle : ' + cas.interdit);
  attendre(r.zones === a.zones, 'zones affichées : ' + r.zones + ' (attendu ' + a.zones + ')');
  attendre(r.quartiers === a.quartiers, 'quartiers affichés : ' + r.quartiers + ' (attendu ' + a.quartiers + ')');
  attendre(r.lignes === a.lignes, 'quartier ouvert : ' + r.lignes + ' emplacements (attendu ' + a.lignes + ')');
  if (a.intro) attendre(t.indexOf(a.intro) !== -1, 'texte d’introduction absent : ' + a.intro);
  if (a.message) attendre(t.indexOf(a.message) !== -1, 'message attendu absent : ' + a.message);
  (a.presents || []).forEach((m) => attendre(t.indexOf(m) !== -1, 'absent de la page : ' + m));
  (a.absents || []).forEach((m) => attendre(t.indexOf(m) === -1, 'présent alors qu’il ne doit pas l’être : ' + m));
  attendre(r.erreurs.length === 0, 'erreurs JavaScript : ' + r.erreurs.join(' | '));

  if (cas.admin) {
    attendre(bilan.stats.join(',') === '1200,3,1197', 'totaux administrateur inattendus : ' + bilan.stats.join(','));
    attendre(bilan.entetes.indexOf('Rendu public') !== -1, 'colonne « Rendu public » absente pour l’Administrateur');
    attendre(r.lectureTable === true, 'l’Administrateur doit lire la table etablissements');
  } else {
    attendre(bilan.stats.length === 0, 'totaux visibles pour un non-Administrateur : ' + bilan.stats.join(','));
    attendre(bilan.boutons === 0, 'bouton de publication visible pour un non-Administrateur');
    attendre(r.lectureTable === false, 'la table etablissements a été lue par un non-Administrateur');
    attendre(r.appels.length === 0, 'appel de publication par un non-Administrateur');
  }

  if (cas.publier) {
    attendre(r.libelleApres === 'Retirer', 'après publication, le bouton doit proposer « Retirer » : ' + r.libelleApres);
    const attendu = [{ p_code: 'DP-C1-Z1Q1R1P1-H1A1Bg1', p_publie: true }];
    attendre(JSON.stringify(r.appels) === JSON.stringify(attendu), 'appel de publication inattendu : ' + JSON.stringify(r.appels));
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
      console.log((echecs.length ? 'ÉCHEC ' : 'OK    ') + cas.nom.padEnd(26) + ' ' + cas.chemin);
      echecs.forEach((e) => console.log('        - ' + e));
    }
  } finally {
    await browser.close();
  }
  console.log('\n' + (total - echoues) + ' / ' + total + ' cas conformes');
  process.exit(echoues ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
