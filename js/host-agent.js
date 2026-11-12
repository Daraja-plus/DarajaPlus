/* Espace Hôte (zone) et espace Agent (bénéficiaires de proximité, dossiers, offres, Carrefours, annonces, visibilité).
   Principe : le serveur contrôle chaque action (quotas, zone, rattachement) ; l’interface présente et déclenche. */
(function () {
  var DP = window.DP;
  var esc = DP.ui.esc;
  var ui = DP.ui;
  var HOST = ['host'];
  var AGENT = ['agent'];

  var CAT = [['ba', 'Ba — Alpha'], ['bb', 'Bb — Bêta'], ['bg', 'Bg — Gamma']];
  var STATUS_BEN = [['draft', 'Brouillon'], ['incomplete', 'Incomplet'], ['to_verify', 'À vérifier'], ['active', 'Actif'], ['suspended', 'Suspendu'], ['archived', 'Archivé']];
  var STATUS_BEN_AGENT = [['draft', 'Brouillon'], ['incomplete', 'Incomplet'], ['to_verify', 'À vérifier']];
  var STATUS_PROJ = [['draft', 'Brouillon'], ['incomplete', 'Incomplet'], ['to_verify', 'À vérifier'], ['ready', 'Prêt à présenter'], ['in_progress', 'En cours'], ['closed', 'Clôturé']];
  var STATUS_CARREFOUR = [['draft', 'Brouillon'], ['open', 'Ouvert'], ['full', 'Complet'], ['running', 'En cours'], ['suspended', 'Suspendu'], ['closed', 'Clôturé']];
  var OFFER_TYPES = [
    ['programme_accompagnement', 'Programme d’accompagnement'], ['appel_projets', 'Appel à projets'],
    ['offre_financement', 'Offre de financement'], ['opportunite_investissement', 'Opportunité d’investissement']
  ];
  var OFFER_TYPE_LABEL = {};
  OFFER_TYPES.forEach(function (t) { OFFER_TYPE_LABEL[t[0]] = t[1]; });
  var CONN_ACTIVE = ['approved_admin', 'consent_given', 'transmitted', 'under_study', 'complement_requested'];
  var DOC_TYPES = [['identite', 'Pièce d’identité'], ['justificatif_activite', 'Justificatif d’activité'], ['plan_financement', 'Plan de financement'], ['autre', 'Autre document']];

  /* ---------- Outils ---------- */
  function act(root, sel, fn) {
    root.querySelectorAll(sel).forEach(function (b) {
      b.addEventListener('click', async function () {
        try { await fn(b); } catch (e) { ui.toast(ui.errMsg(e), 'bad'); }
      });
    });
  }
  function unique(a) { return Array.from(new Set((a || []).filter(Boolean))); }
  function inq(ids) { ids = unique(ids); return ids.length ? 'in.(' + ids.join(',') + ')' : null; }
  function byId(rows) { var m = {}; (rows || []).forEach(function (r) { m[r.id] = r; }); return m; }
  function pname(p) { return p ? DP.app.displayName(p) : '—'; }
  function bname(b) { return b ? ([b.prenom, b.nom].filter(Boolean).join(' ') || b.code || '—') : '—'; }
  /* Libellé d’un bénéficiaire dans les tableaux : « code — nom », ou seul le nom tant que le code n’existe pas. */
  function bLabel(b) { return b ? (b.code ? b.code + ' — ' : '') + bname(b) : '—'; }
  /* Catégorie d’un bénéficiaire, ou mention d’attente tant qu’aucune proposition n’est acceptée. */
  function catHtml(cat) { return cat ? ui.categoryBadge(cat) : '<span class="muted small">En attente de catégorie</span>'; }
  function catNom(c) { return DP.categories && DP.categories[c] ? DP.categories[c].nom : (DP.labels.category[c] || c || '—'); }
  function placesLeft(n) { return n <= 0 ? 'Aucune place restante' : (n === 1 ? '1 place restante' : n + ' places restantes'); }
  function options(list, value, placeholder) {
    return (placeholder !== undefined ? '<option value="">' + esc(placeholder) + '</option>' : '') + list.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value === null || value === undefined ? '' : value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('');
  }
  function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
  function refresh() { return DP.navigate(); }
  function fileSafe(name) { return String(name || 'fichier').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80); }

  function filterBar(route, fields) {
    return '<form class="filters" data-route="' + esc(route) + '">' + fields.map(function (f) {
      return '<div class="field"><label for="flt-' + esc(f.name) + '">' + esc(f.label) + '</label>' +
        '<select class="input" id="flt-' + esc(f.name) + '" name="' + esc(f.name) + '">' + options(f.options, f.value) + '</select></div>';
    }).join('') + '<div class="field"><button class="btn btn-outline" type="submit">Filtrer</button></div></form>';
  }
  function bindFilters(el) {
    var f = el.querySelector('form.filters');
    if (!f) return;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var usp = new URLSearchParams();
      Array.prototype.forEach.call(f.elements, function (x) { if (x.name && x.value) usp.append(x.name, x.value); });
      var q = usp.toString();
      location.hash = f.dataset.route + (q ? '?' + q : '');
    });
  }

  function statusModal(title, current, list, save) {
    var m = ui.modal(title, '<form class="form" id="sm"><div class="field field-full"><label for="sm-s">Nouveau statut</label>' +
      '<select class="input" id="sm-s" name="status" required>' + options(list, current) + '</select></div>' +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer</button></div></form>');
    ui.bindForm(m.el.querySelector('#sm'), async function (d) {
      await save(d.status);
      m.close();
      refresh();
      return 'Statut mis à jour.';
    }, null);
  }

  async function openDocument(path) {
    var url = await DP.api.signedUrl(path, 300);
    window.open(url, '_blank', 'noopener');
  }

  function docsTable(docs, label) {
    return ui.table([
      { label: 'Document', render: function (d) { return '<strong>' + esc(d.file_name || 'Pièce') + '</strong><div class="small muted">' + esc(DOC_TYPES.filter(function (t) { return t[0] === d.doc_type; })[0] ? DOC_TYPES.filter(function (t) { return t[0] === d.doc_type; })[0][1] : d.doc_type) + '</div>'; } },
      { label: 'Ajouté le', render: function (d) { return ui.date(d.created_at); } },
      { label: 'Vérifié', render: function (d) { return d.verified ? ui.badge('validated') : '<span class="muted small">Non vérifié</span>'; } },
      { label: 'Action', cls: 'actions', render: function (d) { return '<button class="btn btn-sm btn-outline" type="button" data-open-doc="' + esc(d.storage_path) + '">Ouvrir</button>'; } }
    ], docs, label || 'Aucune pièce déposée.');
  }

  /* ============================================================
     ESPACE HÔTE
     ============================================================ */
  async function renderHostHome(el) {
    var me = DP.app.profile;
    var r = await Promise.all([
      DP.api.get('zones', { select: '*', id: 'eq.' + me.zone_id }),
      DP.api.get('profiles', { select: 'id,status', role: 'eq.agent', host_id: 'eq.' + me.id }),
      DP.api.get('beneficiaries', { select: 'id,status,category', host_id: 'eq.' + me.id, status: 'neq.archived' }),
      DP.api.get('projects', { select: 'id,status' }),
      DP.api.get('connection_requests', { select: 'id,status' }),
      DP.api.get('carrefours', { select: 'id,status', zone_id: 'eq.' + me.zone_id })
    ]);
    var zone = r[0][0] || {};
    var agents = r[1], bens = r[2], projects = r[3], conns = r[4], carrefours = r[5];
    el.innerHTML = ui.header('Tableau de zone', 'Zone : ' + (zone.name || '—') + '. Vous encadrez les Agents et suivez les bénéficiaires de votre zone.') +
      ui.stats([
        ['Agents', agents.length + ' / 10', 'Maximum par Hôte'],
        ['Bénéficiaires', bens.length, 'Dans votre zone'],
        ['À vérifier', bens.filter(function (b) { return b.status === 'to_verify'; }).length, 'Fiches à contrôler', bens.some(function (b) { return b.status === 'to_verify'; }) ? 'warn' : ''],
        ['Actifs', bens.filter(function (b) { return b.status === 'active'; }).length, 'Bénéficiaires actifs'],
        ['Dossiers prêts', projects.filter(function (p) { return p.status === 'ready'; }).length, 'Prêts à présenter'],
        ['Ponts en cours', conns.filter(function (c) { return CONN_ACTIVE.indexOf(c.status) !== -1; }).length, 'Mises en relation suivies'],
        ['Carrefours', carrefours.length, 'Dans votre zone']
      ]) +
      ui.card('Accès rapides', '<div class="btn-row quick-links">' +
        '<a class="btn btn-primary" href="#/hote/beneficiaires">Vérifier les bénéficiaires</a>' +
        '<a class="btn btn-outline" href="#/hote/agents">Mes Agents</a>' +
        '<a class="btn btn-outline" href="#/hote/dossiers">Dossiers & projets</a>' +
        '<a class="btn btn-outline" href="#/hote/annonces">Publier une annonce de zone</a>' +
        '<a class="btn btn-ghost" href="#/messages">Écrire à l’Administrateur</a></div>');
  }

  async function renderHostAgents(el) {
    var me = DP.app.profile;
    var r = await Promise.all([
      DP.api.get('profiles', { select: '*', role: 'eq.agent', host_id: 'eq.' + me.id, order: 'code.asc' }),
      DP.api.get('beneficiaries', { select: 'agent_id,category', host_id: 'eq.' + me.id, status: 'neq.archived' }),
      DP.api.get('quartiers', { select: '*', zone_id: 'eq.' + me.zone_id })
    ]);
    var agents = r[0], bens = r[1], quart = byId(r[2]);
    var counts = {};
    bens.forEach(function (b) { var c = counts[b.agent_id] || (counts[b.agent_id] = { bg: 0, bb: 0, ba: 0 }); if (c[b.category] !== undefined) c[b.category]++; });
    el.innerHTML = ui.header('Mes Agents', agents.length + ' Agent(s) sur 10. Les Agents sont enregistrés et validés par l’Administrateur général.') +
      ui.card(null, ui.table([
        { label: 'Agent', render: function (a) { return '<strong>' + esc(pname(a)) + '</strong><div class="small muted">' + esc(a.code || '') + '</div>'; } },
        { label: 'Quartier', render: function (a) { return esc(quart[a.quartier_id] ? quart[a.quartier_id].name : '—'); } },
        { label: 'Bénéficiaires', render: function (a) { var c = counts[a.id] || { bg: 0, bb: 0, ba: 0 }; return 'Bg ' + c.bg + '/10 · Bb ' + c.bb + '/30 · Ba ' + c.ba + '/60'; } },
        { label: 'Statut', render: function (a) { return ui.badge(a.status); } }
      ], agents, 'Aucun Agent rattaché à votre zone pour le moment.'));
  }

  async function renderHostBeneficiaries(el, ctx) {
    var me = DP.app.profile;
    var st = (ctx.query && ctx.query.get('statut')) || '';
    var params = { select: '*', host_id: 'eq.' + me.id, order: 'created_at.desc', limit: 1000 };
    if (st) params.status = 'eq.' + st; else params.status = 'neq.archived';
    var rows = await DP.api.get('beneficiaries', params);
    var agents = byId(await DP.api.get('profiles', { select: 'id,prenom,nom,code,email', id: inq(rows.map(function (b) { return b.agent_id; })) || 'is.null' }));
    var map = byId(rows);
    el.innerHTML = ui.header('Bénéficiaires de ma zone', 'Vérifiez les fiches transmises par les Agents, puis activez-les. Vous ne pouvez pas modifier le rattachement.') +
      ui.card(null, filterBar('#/hote/beneficiaires', [{ name: 'statut', label: 'Statut', value: st, options: [['', 'Tous (sauf archivés)']].concat(STATUS_BEN) }]) +
        ui.table([
          { label: 'Code', render: function (b) { return '<strong>' + esc(b.code || '—') + '</strong>'; } },
          { label: 'Bénéficiaire', render: function (b) { return esc(bname(b)); } },
          { label: 'Catégorie', render: function (b) { return catHtml(b.category); } },
          { label: 'Agent', render: function (b) { return esc(pname(agents[b.agent_id])); } },
          { label: 'Statut', render: function (b) { return ui.badge(b.status); } },
          { label: 'Action', cls: 'actions', render: function (b) {
            /* Une fiche « draft » n'a pas encore de catégorie : elle s'active par le choix accepté, pas ici. */
            var quick = (b.status === 'to_verify' || b.status === 'incomplete') && b.category
              ? '<button class="btn btn-sm btn-primary" type="button" data-activate="' + esc(b.id) + '">Activer</button> ' : '';
            return quick + '<button class="btn btn-sm btn-outline" type="button" data-status="' + esc(b.id) + '">Statut</button>';
          } }
        ], rows, 'Aucun bénéficiaire ne correspond à ces filtres.'));
    bindFilters(el);
    act(el, '[data-activate]', async function (b) {
      var x = map[b.dataset.activate];
      if (!(await ui.confirm('Activer ' + bname(x) + (x.code ? ' (' + x.code + ')' : '') + ' ? La fiche sera considérée comme vérifiée.', 'Activer'))) return;
      await DP.api.update('beneficiaries', { id: 'eq.' + x.id }, { status: 'active' });
      ui.toast('Bénéficiaire activé.', 'ok');
      refresh();
    });
    act(el, '[data-status]', function (b) {
      var x = map[b.dataset.status];
      statusModal('Statut de ' + (x.code || bname(x)), x.status, STATUS_BEN, function (status) {
        return DP.api.update('beneficiaries', { id: 'eq.' + x.id }, { status: status });
      });
    });
  }

  async function renderHostProjects(el, ctx) {
    var st = (ctx.query && ctx.query.get('statut')) || '';
    var params = { select: '*', order: 'created_at.desc', limit: 500 };
    if (st) params.status = 'eq.' + st;
    var rows = await DP.api.get('projects', params);
    var bens = byId(await DP.api.get('beneficiaries', { select: 'id,code,prenom,nom,category', id: inq(rows.map(function (p) { return p.beneficiary_id; })) || 'is.null' }));
    var map = byId(rows);
    el.innerHTML = ui.header('Dossiers et projets', 'Contrôlez chaque dossier avant de le marquer « Prêt à présenter ». Seul un dossier prêt peut être présenté à un partenaire.') +
      ui.card(null, filterBar('#/hote/dossiers', [{ name: 'statut', label: 'Statut', value: st, options: [['', 'Tous']].concat(STATUS_PROJ) }]) +
        ui.table([
          { label: 'Projet', render: function (p) { return '<strong>' + esc(p.title) + '</strong><div class="small muted">' + esc(p.sector || '') + '</div>'; } },
          { label: 'Bénéficiaire', render: function (p) { return esc(bLabel(bens[p.beneficiary_id])); } },
          { label: 'Montant', cls: 'num', render: function (p) { return ui.money(p.amount, p.currency); } },
          { label: 'Statut', render: function (p) { return ui.badge(p.status); } },
          { label: 'Action', cls: 'actions', render: function (p) { return '<button class="btn btn-sm btn-outline" type="button" data-status="' + esc(p.id) + '">Statut</button>'; } }
        ], rows, 'Aucun projet dans votre zone pour le moment.'));
    bindFilters(el);
    act(el, '[data-status]', function (b) {
      var p = map[b.dataset.status];
      statusModal('Statut du projet', p.status, STATUS_PROJ, function (status) {
        return DP.api.update('projects', { id: 'eq.' + p.id }, { status: status });
      });
    });
  }

  async function renderHostConnections(el) {
    var rows = await DP.api.get('connection_requests', { select: '*', order: 'created_at.desc', limit: 500 });
    var projects = byId(await DP.api.get('projects', { select: 'id,title,beneficiary_id,amount,currency', id: inq(rows.map(function (c) { return c.project_id; })) || 'is.null' }));
    var bens = byId(await DP.api.get('beneficiaries', { select: 'id,code,prenom,nom', id: inq(Object.keys(projects).map(function (k) { return projects[k].beneficiary_id; })) || 'is.null' }));
    var partners = byId(await DP.api.get('partners', { select: 'id,legal_name,category', id: inq(rows.map(function (c) { return c.partner_id; })) || 'is.null' }));
    el.innerHTML = ui.header('Ponts — mises en relation', 'Suivi en lecture seule des demandes concernant votre zone. Les décisions appartiennent à l’Administrateur, au bénéficiaire et au partenaire.') +
      ui.card(null, ui.table([
        { label: 'Projet', render: function (c) { var p = projects[c.project_id]; return '<strong>' + esc(p ? p.title : '—') + '</strong>'; } },
        { label: 'Bénéficiaire', render: function (c) { var p = projects[c.project_id]; return esc(bLabel(p ? bens[p.beneficiary_id] : null)); } },
        { label: 'Partenaire', render: function (c) { var x = partners[c.partner_id]; return esc(x ? x.legal_name : '—'); } },
        { label: 'Statut', render: function (c) { return ui.badge(c.status); } },
        { label: 'Demandé le', render: function (c) { return ui.date(c.created_at); } }
      ], rows, 'Aucune mise en relation concernant votre zone pour le moment.'));
  }

  async function renderHostCarrefours(el) {
    var me = DP.app.profile;
    var r = await Promise.all([
      DP.api.get('carrefours', { select: '*', zone_id: 'eq.' + me.zone_id, order: 'created_at.desc' }),
      DP.api.get('profiles', { select: 'id,code,prenom,nom,email', role: 'eq.agent', host_id: 'eq.' + me.id })
    ]);
    var agents = byId(r[1]);
    el.innerHTML = ui.header('Carrefours de ma zone', 'Mécanisme de contribution mutuelle. DarajaPlus ne reçoit ni ne distribue les fonds ; les règles sont à définir avant lancement.') +
      ui.card(null, ui.table([
        { label: 'Carrefour', render: function (c) { return '<strong>' + esc(c.name) + '</strong><div class="small muted">' + esc(short(c.objective, 80)) + '</div>'; } },
        { label: 'Organisateur', render: function (c) { return esc(pname(agents[c.organizer_id])); } },
        { label: 'Cotisation', cls: 'num', render: function (c) { return ui.money(c.contribution_amount, c.currency) + ' · ' + esc(c.frequency); } },
        { label: 'Places', cls: 'num', render: function (c) { return c.max_members; } },
        { label: 'Statut', render: function (c) { return ui.badge(c.status); } }
      ], r[0], 'Aucun Carrefour dans votre zone pour le moment.'));
  }

  async function renderHostAnnouncements(el) {
    var me = DP.app.profile;
    var rows = await DP.api.get('announcements', { select: '*', author_id: 'eq.' + DP.api.uid, order: 'created_at.desc', limit: 100 });
    el.innerHTML = ui.header('Annonces de zone', 'Messages destinés aux Agents et bénéficiaires de votre zone.') +
      '<div class="grid-2">' +
      ui.card('Nouvelle annonce de zone', '<form class="form" id="f-ann">' +
        ui.field({ name: 'title', label: 'Titre', required: true, full: true }) +
        ui.field({ name: 'body', label: 'Message', type: 'textarea', rows: 5, required: true, full: true, hint: 'Visible par les bénéficiaires de la zone. Pas de données personnelles.' }) +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Publier pour ma zone</button></div></form>') +
      ui.card('Mes annonces', ui.table([
        { label: 'Annonce', render: function (a) { return '<strong>' + esc(a.title) + '</strong><div class="small muted">' + esc(short(a.body, 100)) + '</div>'; } },
        { label: 'Date', render: function (a) { return ui.date(a.created_at); } },
        { label: 'Statut', render: function (a) { return ui.badge(a.status === 'visible' ? 'published' : 'hidden'); } }
      ], rows, 'Aucune annonce publiée.')) + '</div>';
    ui.bindForm(el.querySelector('#f-ann'), async function (d) {
      await DP.api.insert('announcements', { author_id: DP.api.uid, audience: 'zone', zone_id: me.zone_id, title: d.title, body: d.body, status: 'visible' });
      refresh();
      return 'Annonce publiée pour votre zone.';
    });
  }

  /* ============================================================
     ESPACE AGENT
     ============================================================ */
  async function renderAgentHome(el) {
    var me = DP.app.profile;
    var r = await Promise.all([
      DP.api.rpc('agent_quota', {}),
      DP.api.get('profiles', { select: 'id,prenom,nom,code', id: 'eq.' + me.host_id }),
      DP.api.get('zones', { select: '*', id: 'eq.' + me.zone_id })
    ]);
    var q = r[0], host = r[1][0], zone = r[2][0] || {};
    var caps = q.caps || {};
    el.innerHTML = ui.header('Mon espace Agent', 'Zone : ' + (zone.name || '—') + ' · Hôte : ' + pname(host)) +
      ui.stats([
        ['Bg', q.bg + ' / ' + caps.bg, 'Gamma (maximum)'],
        ['Bb', q.bb + ' / ' + caps.bb, 'Bêta (maximum)'],
        ['Ba', q.ba + ' / ' + caps.ba, 'Alpha (maximum)'],
        ['Total', q.total + ' / ' + caps.total, 'Bénéficiaires rattachés'],
        ['Publications gratuites', q.free_offers_used + ' / ' + q.free_offers_quota, 'Ce mois-ci']
      ]) +
      ui.card('Accès rapides', '<div class="btn-row quick-links">' +
        '<a class="btn btn-primary" href="#/agent/beneficiaires/nouveau">Enregistrer un bénéficiaire</a>' +
        '<a class="btn btn-outline" href="#/agent/beneficiaires">Mes bénéficiaires</a>' +
        '<a class="btn btn-outline" href="#/agent/categories">Catégories à proposer</a>' +
        '<a class="btn btn-outline" href="#/agent/projets">Dossiers & besoins</a>' +
        '<a class="btn btn-outline" href="#/agent/carrefours">Carrefours</a>' +
        '<a class="btn btn-outline" href="#/agent/offres">Publier une offre</a></div>') +
      ui.card('Rappel', '<p class="small">Un bénéficiaire ne peut être activé que par l’Hôte ou l’Administrateur. Vous préparez la fiche, complétez le dossier et le transmettez à l’équipe.</p>');
  }

  async function renderAgentBeneficiaries(el, ctx) {
    var me = DP.app.profile;
    var cat = (ctx.query && ctx.query.get('categorie')) || '';
    var params = { select: '*', agent_id: 'eq.' + me.id, order: 'created_at.desc', limit: 500 };
    if (cat) params.category = 'eq.' + cat;
    var rows = await DP.api.get('beneficiaries', params);
    el.innerHTML = ui.header('Mes bénéficiaires', rows.length + ' bénéficiaire(s).',
        '<a class="btn btn-primary" href="#/agent/beneficiaires/nouveau">+ Nouveau bénéficiaire</a>') +
      ui.card(null, filterBar('#/agent/beneficiaires', [{ name: 'categorie', label: 'Catégorie', value: cat, options: [['', 'Toutes']].concat(CAT) }]) +
        ui.table([
          { label: 'Code', render: function (b) { return '<strong>' + esc(b.code || '—') + '</strong>'; } },
          { label: 'Bénéficiaire', render: function (b) { return esc(bname(b)); } },
          { label: 'Catégorie', render: function (b) { return catHtml(b.category); } },
          { label: 'Téléphone', render: function (b) { return esc(b.phone || '—'); } },
          { label: 'Statut', render: function (b) { return ui.badge(b.status); } },
          { label: 'Action', cls: 'actions', render: function (b) { return '<a class="btn btn-sm btn-outline" href="#/agent/beneficiaires/' + esc(b.id) + '">Ouvrir</a>'; } }
        ], rows, 'Aucun bénéficiaire pour le moment. Commencez par « Nouveau bénéficiaire ».'));
    bindFilters(el);
  }

  async function renderAgentNewBeneficiary(el) {
    var me = DP.app.profile;
    var r = await Promise.all([
      DP.api.rpc('agent_quota', {}),
      DP.api.get('beneficiaries', { select: 'id,code,category,prenom,nom', agent_id: 'eq.' + me.id, category: 'in.(bg,bb)', status: 'neq.archived', order: 'code.asc' }),
      DP.api.get('quartiers', { select: '*', zone_id: 'eq.' + me.zone_id, order: 'id.asc' })
    ]);
    var q = r[0], sponsors = r[1], quartiers = r[2];
    var caps = q.caps || {};
    var left = function (c) { return (caps[c] || 0) - (q[c] || 0); };
    el.innerHTML = ui.header('Nouveau bénéficiaire', 'Enregistrez la fiche. Elle reste « à vérifier » tant que l’Hôte ne l’a pas activée.') +
      ui.card(null, ui.alert('info', 'Places restantes : Bg ' + left('bg') + ' · Bb ' + left('bb') + ' · Ba ' + left('ba') + '. Un Bb a pour parrain un Bg, un Ba a pour parrain un Bb.') +
        '<form class="form" id="f-new" data-reset="false">' +
        '<div class="field-row">' + ui.field({ name: 'category', label: 'Catégorie', type: 'select', options: CAT, placeholder: 'Choisir', required: true, dataType: 'nullable' }) +
        ui.field({ name: 'status', label: 'Statut initial', type: 'select', options: [['to_verify', 'À vérifier (transmis à l’Hôte)'], ['incomplete', 'Incomplet'], ['draft', 'Brouillon']], value: 'to_verify' }) + '</div>' +
        '<div class="field-row">' + ui.field({ name: 'nom', label: 'Nom', required: true }) +
        ui.field({ name: 'postnom', label: 'Post-nom', required: true }) + '</div>' +
        ui.field({ name: 'prenom', label: 'Prénom', required: true }) +
        '<div class="field-row">' + ui.field({ name: 'phone', label: 'Téléphone', placeholder: '+243…' }) +
        ui.field({ name: 'email', label: 'E-mail', type: 'text', placeholder: 'facultatif' }) + '</div>' +
        '<div class="field-row">' + ui.field({ name: 'sponsor', label: 'Parrain', type: 'select', options: [], placeholder: 'Choisir la catégorie', dataType: 'nullable' }) +
        ui.field({ name: 'quartier', label: 'Quartier', type: 'select', options: quartiers.map(function (x) { return [x.id, x.name]; }), placeholder: 'Non précisé', dataType: 'nullable' }) + '</div>' +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer la fiche</button></div></form>');

    var form = el.querySelector('#f-new');
    var F = form.elements;
    var refreshSponsor = function () {
      var cat = F.category.value;
      var need = cat === 'bb' ? 'bg' : (cat === 'ba' ? 'bb' : null);
      F.sponsor.disabled = !need;
      F.sponsor.innerHTML = options(need ? sponsors.filter(function (s) { return s.category === need; }).map(function (s) {
        return [s.id, bLabel(s)];
      }) : [], '', need ? 'Choisir un parrain' : 'Non applicable pour un Bg');
    };
    F.category.addEventListener('change', refreshSponsor);
    refreshSponsor();

    ui.bindForm(form, async function (d) {
      if (!d.category) throw new Error('Choisissez la catégorie.');
      await DP.api.rpc('create_beneficiary', {
        p_category: d.category, p_nom: d.nom, p_postnom: d.postnom, p_prenom: d.prenom,
        p_phone: d.phone || null, p_email: d.email || null, p_agent: me.id,
        p_sponsor: d.sponsor || null, p_quartier: d.quartier ? Number(d.quartier) : null,
        p_user: null, p_status: d.status
      });
      location.hash = '#/agent/beneficiaires';
      return 'Bénéficiaire enregistré.';
    });
  }

  async function renderAgentBeneficiary(el, ctx) {
    var me = DP.app.profile;
    var id = ctx.params.id;
    var b = (await DP.api.get('beneficiaries', { select: '*', id: 'eq.' + id }))[0];
    if (!b) throw new Error('Bénéficiaire introuvable ou non rattaché à votre compte.');
    var r = await Promise.all([
      DP.api.get('projects', { select: '*', beneficiary_id: 'eq.' + id, order: 'created_at.desc' }),
      DP.api.get('documents', { select: '*', owner_beneficiary_id: 'eq.' + id, order: 'created_at.desc' }),
      DP.api.get('quartiers', { select: '*', zone_id: 'eq.' + me.zone_id, order: 'id.asc' })
    ]);
    var projects = r[0], docs = r[1], quartiers = r[2];
    var editableStatus = STATUS_BEN_AGENT.some(function (s) { return s[0] === b.status; });
    el.innerHTML = ui.header(bname(b), (b.code ? b.code + ' · ' : '') + (b.category ? (DP.labels.category[b.category] || b.category) : 'En attente de catégorie'),
        '<a class="btn btn-outline" href="#/agent/beneficiaires">← Mes bénéficiaires</a>') +
      '<div class="grid-2">' +
      ui.card('Fiche', '<form class="form" id="f-ben">' +
        '<div class="field-row">' + ui.field({ name: 'nom', label: 'Nom', value: b.nom, required: true }) +
        ui.field({ name: 'postnom', label: 'Post-nom', value: b.postnom, required: true }) + '</div>' +
        ui.field({ name: 'prenom', label: 'Prénom', value: b.prenom, required: true }) +
        '<div class="field-row">' + ui.field({ name: 'phone', label: 'Téléphone', value: b.phone }) +
        ui.field({ name: 'email', label: 'E-mail', value: b.email }) + '</div>' +
        ui.field({ name: 'quartier', label: 'Quartier', type: 'select', options: quartiers.map(function (x) { return [x.id, x.name]; }), value: b.quartier_id, placeholder: 'Non précisé', dataType: 'nullable' }) +
        (editableStatus
          ? ui.field({ name: 'status', label: 'Statut', type: 'select', options: STATUS_BEN_AGENT, value: b.status })
          : '<p class="small muted">Statut actuel : <strong>' + esc(DP.labels.status[b.status] || b.status) + '</strong>. Seul l’Hôte peut le modifier.</p>') +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer</button></div></form>') +
      ui.card('Dossiers et besoins', ui.table([
        { label: 'Projet', render: function (p) { return '<strong>' + esc(p.title) + '</strong><div class="small muted">' + esc(ui.money(p.amount, p.currency)) + '</div>'; } },
        { label: 'Statut', render: function (p) { return ui.badge(p.status); } },
        { label: 'Action', cls: 'actions', render: function (p) { return '<button class="btn btn-sm btn-outline" type="button" data-status="' + esc(p.id) + '">Statut</button>'; } }
      ], projects, 'Aucun projet pour le moment.') +
        '<details class="new-block"><summary>+ Nouveau projet ou besoin</summary>' +
        '<form class="form" id="f-proj" style="margin-top:.75rem">' +
        ui.field({ name: 'title', label: 'Intitulé du projet', required: true, full: true }) +
        '<div class="field-row">' + ui.field({ name: 'sector', label: 'Secteur' }) +
        ui.field({ name: 'amount', label: 'Montant demandé', type: 'number', dataType: 'number', step: 'any', min: 0.01, required: true }) + '</div>' +
        '<div class="field-row">' + ui.field({ name: 'currency', label: 'Devise', type: 'select', options: [['USD', 'USD'], ['FC', 'FC']], value: 'USD' }) +
        ui.field({ name: 'due_date', label: 'Échéance souhaitée', type: 'date', dataType: 'nullable' }) + '</div>' +
        ui.field({ name: 'description', label: 'Description de l’activité ou du projet', type: 'textarea', rows: 3, full: true }) +
        ui.field({ name: 'use_of_funds', label: 'Utilisation des fonds', type: 'textarea', rows: 2, full: true }) +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Créer le projet</button></div></form></details>') +
      '</div>' +
      ui.card('Pièces du bénéficiaire', docsTable(docs, 'Aucune pièce déposée pour le moment.'));

    ui.bindForm(el.querySelector('#f-ben'), async function (d) {
      var patch = { nom: d.nom, postnom: d.postnom, prenom: d.prenom, phone: d.phone || null, email: d.email || null, quartier_id: d.quartier ? Number(d.quartier) : null };
      if (editableStatus && d.status) patch.status = d.status;
      await DP.api.update('beneficiaries', { id: 'eq.' + id }, patch);
      refresh();
      return 'Fiche enregistrée.';
    });
    ui.bindForm(el.querySelector('#f-proj'), async function (d) {
      if (!(d.amount > 0)) throw new Error('Le montant doit être supérieur à 0.');
      await DP.api.insert('projects', {
        beneficiary_id: id, created_by: DP.api.uid, title: d.title, sector: d.sector || null,
        description: d.description || null, amount: d.amount, currency: d.currency,
        use_of_funds: d.use_of_funds || null, due_date: d.due_date || null, status: 'draft'
      });
      refresh();
      return 'Projet créé (brouillon).';
    });
    act(el, '[data-status]', function (btn) {
      var p = projects.filter(function (x) { return x.id === btn.dataset.status; })[0];
      statusModal('Statut du projet', p.status, STATUS_PROJ, function (status) {
        return DP.api.update('projects', { id: 'eq.' + p.id }, { status: status });
      });
    });
    act(el, '[data-open-doc]', function (btn) { return openDocument(btn.dataset.openDoc); });
  }

  async function renderAgentProjects(el, ctx) {
    var st = (ctx.query && ctx.query.get('statut')) || '';
    var params = { select: '*', order: 'created_at.desc', limit: 500 };
    if (st) params.status = 'eq.' + st;
    var rows = await DP.api.get('projects', params);
    var bens = byId(await DP.api.get('beneficiaries', { select: 'id,code,prenom,nom', id: inq(rows.map(function (p) { return p.beneficiary_id; })) || 'is.null' }));
    var map = byId(rows);
    el.innerHTML = ui.header('Dossiers et besoins', 'Dossiers de vos bénéficiaires. Marquez « Prêt à présenter » quand le dossier est complet et vérifié.') +
      ui.card(null, filterBar('#/agent/projets', [{ name: 'statut', label: 'Statut', value: st, options: [['', 'Tous']].concat(STATUS_PROJ) }]) +
        ui.table([
          { label: 'Projet', render: function (p) { return '<strong>' + esc(p.title) + '</strong><div class="small muted">' + esc(p.sector || '') + '</div>'; } },
          { label: 'Bénéficiaire', render: function (p) { return '<a href="#/agent/beneficiaires/' + esc(p.beneficiary_id) + '">' + esc(bLabel(bens[p.beneficiary_id])) + '</a>'; } },
          { label: 'Montant', cls: 'num', render: function (p) { return ui.money(p.amount, p.currency); } },
          { label: 'Statut', render: function (p) { return ui.badge(p.status); } },
          { label: 'Action', cls: 'actions', render: function (p) {
            var quick = p.status === 'draft' || p.status === 'incomplete' || p.status === 'to_verify'
              ? '<button class="btn btn-sm btn-primary" type="button" data-ready="' + esc(p.id) + '">Prêt</button> ' : '';
            return quick + '<button class="btn btn-sm btn-outline" type="button" data-status="' + esc(p.id) + '">Statut</button>';
          } }
        ], rows, 'Aucun dossier pour le moment.'));
    bindFilters(el);
    act(el, '[data-ready]', async function (b) {
      await DP.api.update('projects', { id: 'eq.' + b.dataset.ready }, { status: 'ready' });
      ui.toast('Dossier marqué « Prêt à présenter ».', 'ok');
      refresh();
    });
    act(el, '[data-status]', function (b) {
      var p = map[b.dataset.status];
      statusModal('Statut du projet', p.status, STATUS_PROJ, function (status) {
        return DP.api.update('projects', { id: 'eq.' + p.id }, { status: status });
      });
    });
  }

  async function renderAgentOffers(el) {
    var me = DP.app.profile;
    var r = await Promise.all([
      DP.api.rpc('agent_quota', {}),
      DP.api.get('offers', { select: '*', author_id: 'eq.' + me.id, author_kind: 'eq.agent', order: 'created_at.desc', limit: 200 })
    ]);
    var q = r[0], rows = r[1];
    el.innerHTML = ui.header('Publications', 'Vous pouvez publier des opportunités. Au-delà du quota gratuit du mois, la publication passe en attente de paiement.') +
      ui.alert(q.free_offers_used >= q.free_offers_quota ? 'warn' : 'info',
        'Publications gratuites ce mois-ci : <strong>' + q.free_offers_used + ' / ' + q.free_offers_quota + '</strong>. Les tarifs au-delà ne sont pas encore validés.') +
      '<div class="grid-2">' +
      ui.card('Nouvelle publication', '<form class="form" id="f-offer">' +
        ui.field({ name: 'title', label: 'Titre', required: true, full: true }) +
        '<div class="field-row">' + ui.field({ name: 'offer_type', label: 'Type', type: 'select', options: OFFER_TYPES, required: true }) +
        ui.field({ name: 'target_category', label: 'Public visé', type: 'select', options: [['all', 'Toutes catégories']].concat(CAT), value: 'all' }) + '</div>' +
        ui.field({ name: 'sector', label: 'Secteur', dataType: 'nullable' }) +
        ui.field({ name: 'description', label: 'Description', type: 'textarea', rows: 3, full: true, dataType: 'nullable' }) +
        '<div class="field-row">' + ui.field({ name: 'amount_min', label: 'Montant minimum', type: 'number', dataType: 'nullable', step: 'any', min: 0 }) +
        ui.field({ name: 'amount_max', label: 'Montant maximum', type: 'number', dataType: 'nullable', step: 'any', min: 0 }) + '</div>' +
        '<div class="field-row">' + ui.field({ name: 'currency', label: 'Devise', type: 'select', options: [['USD', 'USD'], ['FC', 'FC']], value: 'USD' }) +
        ui.field({ name: 'deadline', label: 'Date limite', type: 'date', dataType: 'nullable' }) + '</div>' +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Publier</button></div></form>') +
      ui.card('Mes publications', ui.table([
        { label: 'Titre', render: function (o) { return '<strong>' + esc(o.title) + '</strong><div class="small muted">' + esc(OFFER_TYPE_LABEL[o.offer_type] || '') + '</div>'; } },
        { label: 'Échéance', render: function (o) { return ui.date(o.deadline); } },
        { label: 'Statut', render: function (o) { return ui.badge(o.status); } }
      ], rows, 'Aucune publication pour le moment.')) + '</div>';

    ui.bindForm(el.querySelector('#f-offer'), async function (d) {
      var res = await DP.api.rpc('agent_publish_offer', {
        p_title: d.title, p_offer_type: d.offer_type, p_description: d.description || null,
        p_target_category: d.target_category, p_sector: d.sector || null,
        p_amount_min: d.amount_min, p_amount_max: d.amount_max, p_currency: d.currency, p_deadline: d.deadline || null
      });
      refresh();
      return res && res.paid ? 'Publication enregistrée : en attente de paiement (quota gratuit atteint).' : 'Publication enregistrée.';
    });
  }

  async function renderAgentCarrefours(el) {
    var me = DP.app.profile;
    var rows = await DP.api.get('carrefours', { select: '*', organizer_id: 'eq.' + me.id, order: 'created_at.desc' });
    var map = byId(rows);
    el.innerHTML = ui.header('Mes Carrefours', 'Créez un Carrefour, fixez ses règles, puis ouvrez-le aux demandes d’adhésion. Un bénéficiaire peut rejoindre un Carrefour de sa zone sans changer d’Agent.') +
      ui.alert('warn', 'Règles à valider avant lancement : cotisation, rotation, retards, sorties et sécurisation des fonds. Les fonds ne transitent pas par DarajaPlus à ce stade.') +
      '<div class="grid-2">' +
      ui.card('Nouveau Carrefour', '<form class="form" id="f-car">' +
        ui.field({ name: 'name', label: 'Nom', required: true, full: true }) +
        ui.field({ name: 'objective', label: 'Objectif', type: 'textarea', rows: 2, full: true, dataType: 'nullable' }) +
        '<div class="field-row">' + ui.field({ name: 'contribution_amount', label: 'Cotisation', type: 'number', dataType: 'number', step: 'any', min: 0.01, required: true }) +
        ui.field({ name: 'currency', label: 'Devise', type: 'select', options: [['FC', 'FC'], ['USD', 'USD']], value: 'FC' }) + '</div>' +
        '<div class="field-row">' + ui.field({ name: 'frequency', label: 'Fréquence (proposition)', type: 'select', options: [['hebdomadaire', 'Hebdomadaire'], ['mensuelle', 'Mensuelle']], value: 'mensuelle', hint: 'Proposition à valider.' }) +
        ui.field({ name: 'rotation_mode', label: 'Rotation (proposition)', type: 'select', options: [['tirage_au_sort', 'Tirage au sort'], ['ordre_inscription', 'Ordre d’inscription']], value: 'ordre_inscription', hint: 'Proposition à valider.' }) + '</div>' +
        '<div class="field-row">' + ui.field({ name: 'max_members', label: 'Nombre de membres', type: 'number', dataType: 'number', min: 2, required: true, value: 10 }) +
        ui.field({ name: 'duration_cycles', label: 'Nombre de cycles', type: 'number', dataType: 'number', min: 1, required: true, value: 10 }) + '</div>' +
        ui.field({ name: 'rules', label: 'Règles (retards, sorties, sécurité des fonds)', type: 'textarea', rows: 3, full: true, dataType: 'nullable' }) +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Créer (brouillon)</button></div></form>') +
      ui.card('Mes Carrefours', ui.table([
        { label: 'Carrefour', render: function (c) { return '<strong>' + esc(c.name) + '</strong><div class="small muted">' + ui.money(c.contribution_amount, c.currency) + ' · ' + esc(c.frequency) + '</div>'; } },
        { label: 'Statut', render: function (c) { return ui.badge(c.status); } },
        { label: 'Action', cls: 'actions', render: function (c) {
          return '<button class="btn btn-sm btn-outline" type="button" data-members="' + esc(c.id) + '">Membres</button> ' +
            '<button class="btn btn-sm btn-outline" type="button" data-status="' + esc(c.id) + '">Statut</button>';
        } }
      ], rows, 'Aucun Carrefour créé pour le moment.')) + '</div>';

    ui.bindForm(el.querySelector('#f-car'), async function (d) {
      if (!(d.contribution_amount > 0)) throw new Error('La cotisation doit être supérieure à 0.');
      await DP.api.insert('carrefours', {
        organizer_id: me.id, zone_id: me.zone_id, name: d.name, objective: d.objective || null,
        contribution_amount: d.contribution_amount, currency: d.currency, frequency: d.frequency,
        max_members: d.max_members, duration_cycles: d.duration_cycles, rotation_mode: d.rotation_mode,
        rules: d.rules || null, status: 'draft'
      });
      refresh();
      return 'Carrefour créé en brouillon.';
    });
    act(el, '[data-status]', function (b) {
      var c = map[b.dataset.status];
      statusModal('Statut du Carrefour', c.status, STATUS_CARREFOUR, function (status) {
        return DP.api.update('carrefours', { id: 'eq.' + c.id }, { status: status });
      });
    });
    act(el, '[data-members]', async function (b) {
      var c = map[b.dataset.members];
      var list = await DP.api.get('carrefour_members', { select: '*', carrefour_id: 'eq.' + c.id, order: 'requested_at.asc' });
      var bens = byId(await DP.api.get('beneficiaries', { select: 'id,code,prenom,nom', id: inq(list.map(function (m) { return m.beneficiary_id; })) || 'is.null' }));
      var m = ui.modal('Membres — ' + c.name, list.length ? ui.table([
        { label: 'Bénéficiaire', render: function (x) { var y = bens[x.beneficiary_id]; return esc(y ? y.code + ' — ' + bname(y) : '—'); } },
        { label: 'Statut', render: function (x) { return ui.badge(x.status); } },
        { label: 'Action', cls: 'actions', render: function (x) {
          if (x.status !== 'requested') return '—';
          return '<button class="btn btn-sm btn-primary" type="button" data-accept="' + esc(x.beneficiary_id) + '">Accepter</button> ' +
            '<button class="btn btn-sm btn-outline" type="button" data-refuse="' + esc(x.beneficiary_id) + '">Refuser</button>';
        } }
      ], list) : ui.empty('Aucune demande d’adhésion pour le moment.'));
      var setMember = function (benId, status) {
        return DP.api.update('carrefour_members', { carrefour_id: 'eq.' + c.id, beneficiary_id: 'eq.' + benId },
          { status: status, decided_at: new Date().toISOString(), decided_by: DP.api.uid });
      };
      act(m.el, '[data-accept]', async function (x) { await setMember(x.dataset.accept, 'accepted'); m.close(); ui.toast('Adhésion acceptée.', 'ok'); refresh(); });
      act(m.el, '[data-refuse]', async function (x) { await setMember(x.dataset.refuse, 'refused'); m.close(); ui.toast('Adhésion refusée.', 'ok'); refresh(); });
    });
  }

  async function renderAgentAnnouncements(el) {
    var me = DP.app.profile;
    var rows = await DP.api.get('announcements', { select: '*', author_id: 'eq.' + DP.api.uid, order: 'created_at.desc', limit: 100 });
    el.innerHTML = ui.header('Annonces pour mes bénéficiaires', 'Ces messages ne sont visibles que par vos bénéficiaires.') +
      '<div class="grid-2">' +
      ui.card('Nouvelle annonce', '<form class="form" id="f-ann">' +
        ui.field({ name: 'title', label: 'Titre', required: true, full: true }) +
        ui.field({ name: 'body', label: 'Message', type: 'textarea', rows: 5, required: true, full: true }) +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Publier</button></div></form>') +
      ui.card('Mes annonces', ui.table([
        { label: 'Annonce', render: function (a) { return '<strong>' + esc(a.title) + '</strong><div class="small muted">' + esc(short(a.body, 100)) + '</div>'; } },
        { label: 'Date', render: function (a) { return ui.date(a.created_at); } }
      ], rows, 'Aucune annonce publiée.')) + '</div>';
    ui.bindForm(el.querySelector('#f-ann'), async function (d) {
      await DP.api.insert('announcements', { author_id: DP.api.uid, audience: 'agent_beneficiaries', agent_id: me.id, title: d.title, body: d.body, status: 'visible' });
      refresh();
      return 'Annonce publiée.';
    });
  }

  async function renderAgentVisibility(el) {
    var me = DP.app.profile;
    var r = await Promise.all([
      DP.api.get('settings', { select: 'value', key: 'eq.visibility_rate_fc_per_day' }),
      DP.api.get('visibility_orders', { select: '*', owner_id: 'eq.' + DP.api.uid, order: 'created_at.desc', limit: 100 })
    ]);
    var rate = ((r[0][0] || {}).value || {}).agent || 0;
    var rows = r[1];
    el.innerHTML = ui.header('Visibilité', 'Mettez votre espace Agent en avant. Tarif indicatif : ' + ui.money(rate, 'FC') + ' par jour (non définitif).') +
      '<div class="grid-2">' +
      ui.card('Commander une visibilité', '<form class="form" id="f-vis" data-reset="false">' +
        ui.field({ name: 'days', label: 'Durée en jours', type: 'number', dataType: 'number', min: 1, max: 365, value: 30, required: true, hint: 'Entre 1 et 365 jours.' }) +
        '<p class="small muted">Montant estimé : <strong id="vis-amount">' + ui.money(rate * 30, 'FC') + '</strong></p>' +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer la commande</button></div></form>') +
      ui.card('Mes commandes', ui.table([
        { label: 'Période', render: function (o) { return ui.date(o.starts_on) + ' → ' + ui.date(o.ends_on) + '<div class="small muted">' + o.days + ' jour(s)</div>'; } },
        { label: 'Montant', cls: 'num', render: function (o) { return ui.money(o.amount_fc, 'FC'); } },
        { label: 'Statut', render: function (o) { return ui.badge(o.status); } }
      ], rows, 'Aucune commande pour le moment.')) + '</div>';
    var form = el.querySelector('#f-vis');
    form.elements.days.addEventListener('input', function () {
      var n = Number(form.elements.days.value) || 0;
      el.querySelector('#vis-amount').textContent = ui.money(rate * n, 'FC');
    });
    ui.bindForm(form, async function (d) {
      var res = await DP.api.rpc('request_visibility', { p_days: d.days });
      refresh();
      return 'Commande enregistrée : ' + ui.money(res.amount_fc, 'FC') + ' en attente de paiement (paiements non encore activés).';
    });
  }

  /* ---------- Propositions de catégorie (Agent) ---------- */
  async function renderAgentCategories(el) {
    var board = (await DP.api.rpc('agent_category_board', {})) || {};
    var quota = board.quota || {};
    var waiting = board.waiting || [];
    var sponsors = board.sponsors || [];
    var q = function (c) { return quota[c] || { total: 0, taken: 0, left: 0 }; };
    var byBen = {};
    waiting.forEach(function (w) { byBen[w.beneficiary_id] = w; });

    var columns = [
      { label: 'Identifiant', render: function (w) { return '<strong>' + esc(w.identifiant || '—') + '</strong>'; } },
      { label: 'Bénéficiaire', render: function (w) { return esc(bname(w)); } },
      { label: 'Téléphone', render: function (w) { return esc(w.phone || '—'); } },
      { label: 'Souhait', render: function (w) { return esc(DP.labels.category[w.wish] || '—'); } },
      { label: 'Souhait exprimé le', render: function (w) { return ui.date(w.wish_at); } },
      { label: 'Proposition', render: function (w) {
        return w.proposal
          ? '<span class="small">' + esc(catNom(w.proposal.category) + ', en attente de sa réponse') + '</span>'
          : '<span class="muted small">Aucune</span>';
      } },
      { label: 'Action', cls: 'actions', render: function (w) {
        return '<button class="btn btn-sm btn-primary" type="button" data-propose="' + esc(w.beneficiary_id) + '">Proposer une catégorie</button>';
      } }
    ];

    el.innerHTML = ui.header('Catégories à proposer', 'Proposez une catégorie aux bénéficiaires qui vous sont rattachés. Ils acceptent ou refusent. Le code n’est donné qu’à l’acceptation.') +
      ui.stats(CAT.map(function (c) {
        var x = q(c[0]);
        return [catNom(c[0]), x.taken + ' / ' + x.total, placesLeft(x.left), x.left <= 0 ? 'warn' : ''];
      })) +
      ui.alert('info', 'Un Bêta a pour parrain un Gamma de votre Agent. Un Alpha a pour parrain un Bêta de votre Agent. Un Gamma n’a pas de parrain.') +
      ui.card('Bénéficiaires en attente de catégorie', ui.table(columns, waiting, 'Aucun bénéficiaire en attente de catégorie.'));

    act(el, '[data-propose]', function (btn) {
      var w = byBen[btn.dataset.propose];
      if (!w) return;
      var m = ui.modal('Proposer une catégorie — ' + bname(w),
        '<form class="form" id="f-cat">' +
        '<p class="small muted">Le bénéficiaire reçoit cette proposition. Il l’accepte ou la refuse.</p>' +
        '<div class="field field-full"><label for="cp-cat">Catégorie</label><select class="input" id="cp-cat" name="category"></select></div>' +
        '<div class="field field-full" id="cp-sponsor-wrap"><label for="cp-sponsor">Parrain</label><select class="input" id="cp-sponsor" name="sponsor"></select></div>' +
        '<p class="small" id="cp-rank"></p>' +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Envoyer la proposition</button></div></form>');
      var form = m.el.querySelector('#f-cat');
      var selCat = form.elements.category;
      var selSponsor = form.elements.sponsor;
      var wrap = m.el.querySelector('#cp-sponsor-wrap');
      var rank = m.el.querySelector('#cp-rank');
      var submit = form.querySelector('[type=submit]');

      /* Pré-sélection : le souhait du bénéficiaire, sinon la première catégorie encore ouverte. */
      var firstOpen = (CAT.filter(function (c) { return q(c[0]).left > 0; })[0] || [''])[0];
      var pre = w.wish && q(w.wish).left > 0 ? w.wish : firstOpen;
      selCat.innerHTML = CAT.map(function (c) {
        var full = q(c[0]).left <= 0;
        return '<option value="' + c[0] + '"' + (c[0] === pre ? ' selected' : '') + (full ? ' disabled' : '') + '>' +
          esc(c[1]) + (full ? ' (complet)' : '') + '</option>';
      }).join('');

      /* Parrain requis pour Bêta (parrain Gamma) et Alpha (parrain Bêta) ; aucun pour Gamma. */
      var refreshForm = function () {
        var cat = selCat.value;
        var x = q(cat);
        var need = cat === 'bb' ? 'bg' : (cat === 'ba' ? 'bb' : null);
        wrap.style.display = need ? '' : 'none';
        selSponsor.disabled = !need;
        selSponsor.innerHTML = need
          ? '<option value="">Choisissez un parrain</option>' + sponsors.filter(function (s) { return s.category === need; }).map(function (s) {
            var full = s.children >= s.max;
            return '<option value="' + esc(s.id) + '"' + (full ? ' disabled' : '') + '>' +
              esc((s.code || '—') + ' — ' + bname(s) + ' (filleuls : ' + s.children + '/' + s.max + ')') + '</option>';
          }).join('')
          : '';
        rank.innerHTML = x.left > 0
          ? 'Rang prévu : <strong>' + (x.taken + 1) + '</strong> sur ' + x.total + ' places (indicatif).'
          : 'Aucune place disponible dans cette catégorie.';
        submit.disabled = !(x.left > 0);
      };
      selCat.addEventListener('change', refreshForm);
      refreshForm();

      ui.bindForm(form, async function (d) {
        var cat = d.category;
        if (!cat || !(q(cat).left > 0)) throw new Error('Cette catégorie n’a plus de place pour votre quota.');
        var sponsor = cat === 'bg' ? null : (d.sponsor || null);
        if (cat !== 'bg' && !sponsor) throw new Error('Choisissez le parrain pour ce bénéficiaire.');
        await DP.api.rpc('agent_propose_category', { p_beneficiary: w.beneficiary_id, p_category: cat, p_sponsor: sponsor });
        m.close();
        refresh();
        return 'Proposition envoyée. Le bénéficiaire doit l’accepter ou la refuser.';
      });
    });
  }

  /* ---------- Routes ---------- */
  DP.register([
    { path: '/hote', roles: HOST, title: 'Tableau de zone', render: renderHostHome },
    { path: '/hote/agents', roles: HOST, title: 'Mes Agents', render: renderHostAgents },
    { path: '/hote/beneficiaires', roles: HOST, title: 'Bénéficiaires de ma zone', render: renderHostBeneficiaries },
    { path: '/hote/dossiers', roles: HOST, title: 'Dossiers et projets', render: renderHostProjects },
    { path: '/hote/ponts', roles: HOST, title: 'Ponts — suivi', render: renderHostConnections },
    { path: '/hote/carrefours', roles: HOST, title: 'Carrefours de ma zone', render: renderHostCarrefours },
    { path: '/hote/annonces', roles: HOST, title: 'Annonces de zone', render: renderHostAnnouncements },

    { path: '/agent', roles: AGENT, title: 'Mon espace Agent', render: renderAgentHome },
    { path: '/agent/beneficiaires', roles: AGENT, title: 'Mes bénéficiaires', render: renderAgentBeneficiaries },
    /* « nouveau » doit être enregistré avant « :id » pour ne pas être lu comme un identifiant. */
    { path: '/agent/beneficiaires/nouveau', roles: AGENT, title: 'Nouveau bénéficiaire', render: renderAgentNewBeneficiary },
    { path: '/agent/beneficiaires/:id', roles: AGENT, title: 'Fiche bénéficiaire', render: renderAgentBeneficiary },
    { path: '/agent/categories', roles: AGENT, title: 'Catégories à proposer', render: renderAgentCategories },
    { path: '/agent/projets', roles: AGENT, title: 'Dossiers et besoins', render: renderAgentProjects },
    { path: '/agent/offres', roles: AGENT, title: 'Publications', render: renderAgentOffers },
    { path: '/agent/carrefours', roles: AGENT, title: 'Mes Carrefours', render: renderAgentCarrefours },
    { path: '/agent/annonces', roles: AGENT, title: 'Annonces', render: renderAgentAnnouncements },
    { path: '/agent/visibilite', roles: AGENT, title: 'Visibilité', render: renderAgentVisibility }
  ]);
})();
