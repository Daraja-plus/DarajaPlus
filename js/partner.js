/* Espace partenaire : accueil, profil, offres, recherche de projets, dossiers, résultats.
   Principe : le serveur contrôle tous les accès. Cette interface ne fait que présenter les données autorisées. */
(function () {
  var DP = window.DP;
  var esc = DP.ui.esc;
  var ROLE = ['partner'];

  var NOTICE = 'DarajaPlus ne garantit aucun financement. Le partenaire reste seul décideur de son financement ou de son accompagnement.';
  var PUBLISH_NOTE = 'Publication soumise à la modération de l’Administrateur ; tarification non confirmée. Rien n’est facturé à ce stade.';

  var OFFER_TYPES = [
    ['programme_accompagnement', 'Programme d’accompagnement'],
    ['appel_projets', 'Appel à projets'],
    ['offre_financement', 'Offre de financement'],
    ['opportunite_investissement', 'Opportunité d’investissement']
  ];
  var OFFER_TYPE_LABEL = {};
  OFFER_TYPES.forEach(function (t) { OFFER_TYPE_LABEL[t[0]] = t[1]; });

  var RESULT_TYPES = [
    ['financement_accorde', 'Financement accordé'],
    ['accompagnement_accepte', 'Accompagnement accepté']
  ];
  var RESULT_LABEL = {};
  RESULT_TYPES.forEach(function (t) { RESULT_LABEL[t[0]] = t[1]; });

  /* Statuts où des pièces peuvent avoir été transmises au partenaire. */
  var SHARE_STATUSES = ['approved_admin', 'consent_given', 'transmitted', 'under_study', 'complement_requested', 'accepted'];
  /* Actions de décision autorisées par le serveur (check_connection_transition + partner_set_status). */
  var ACTIONS = {
    transmitted: ['under_study'],
    under_study: ['complement_requested', 'accepted', 'refused'],
    complement_requested: ['under_study']
  };
  var DECISIONS = {
    under_study: { label: 'Mettre en étude', needReason: false, question: 'Mettre ce dossier en étude ?' },
    complement_requested: { label: 'Demander un complément', needReason: true, reasonLabel: 'Éléments demandés', question: 'Demander un complément sur ce dossier ?' },
    accepted: { label: 'Accepter', needReason: true, reasonLabel: 'Motif ou conditions de l’acceptation', question: 'Accepter ce dossier ?' },
    refused: { label: 'Refuser', needReason: true, reasonLabel: 'Motif du refus', question: 'Refuser ce dossier ?' }
  };

  var cache = { uid: null, row: null };

  function unique(arr) { return Array.from(new Set((arr || []).filter(Boolean))); }
  function projectRef(id) { return 'PRJ-' + String(id || '').slice(0, 8).toUpperCase(); }
  function catLabel(cat) { return DP.labels.partnerCategory[cat] || cat || '—'; }

  /* Fiche partenaire du compte connecté (null si absente). */
  async function myPartner(force) {
    var uid = DP.api.uid;
    if (!force && cache.uid === uid && cache.row) return cache.row;
    var rows = await DP.api.get('partners', { select: '*', profile_id: 'eq.' + uid });
    cache = { uid: uid, row: rows && rows[0] ? rows[0] : null };
    return cache.row;
  }

  function noPartnerHtml(title) {
    return DP.ui.header(title || 'Espace partenaire', '') +
      DP.ui.alert('warn', 'Votre fiche partenaire est introuvable. Écrivez à l’Administrateur via la messagerie privée.');
  }

  /* Lecture des projets et des dossiers liés, jointure faite côté client (pas de clé étrangère en base). */
  async function loadConnections(partnerId) {
    var cons = await DP.api.get('connection_requests', { select: '*', partner_id: 'eq.' + partnerId, order: 'created_at.desc', limit: 200 });
    var pids = unique(cons.map(function (c) { return c.project_id; }));
    var projects = pids.length ? await DP.api.get('projects', {
      select: 'id,title,sector,amount,currency,due_date,status', id: 'in.(' + pids.join(',') + ')'
    }) : [];
    var pmap = {};
    projects.forEach(function (p) { pmap[p.id] = p; });
    return { cons: cons, projects: pmap };
  }

  /* ---------- Accueil ---------- */
  async function renderHome(el) {
    var p = await myPartner();
    if (!p) { el.innerHTML = noPartnerHtml('Accueil partenaire'); return; }
    var uid = DP.api.uid;
    var res = await Promise.all([
      DP.api.get('offers', { select: 'id,status', author_id: 'eq.' + uid, limit: 500 }),
      DP.api.get('connection_requests', { select: 'id,status', partner_id: 'eq.' + p.id, limit: 500 }),
      DP.api.get('funding_outcomes', { select: 'id', declared_by: 'eq.' + uid, limit: 500 })
    ]);
    var offers = res[0], cons = res[1], outs = res[2];
    var received = cons.filter(function (c) { return ['requested', 'refused_admin', 'cancelled'].indexOf(c.status) === -1; }).length;
    var accepted = cons.filter(function (c) { return c.status === 'accepted' || c.status === 'closed'; }).length;
    var published = offers.filter(function (o) { return o.status === 'published'; }).length;
    var prof = DP.app.profile || {};

    el.innerHTML = DP.ui.header(p.legal_name || 'Espace partenaire', catLabel(p.category)) +
      DP.ui.alert('info', esc(NOTICE) + ' L’inscription partenaire est gratuite.') +
      DP.ui.card('Votre compte', '<dl class="kv">' +
        '<dt>Statut</dt><dd>' + DP.ui.badge(prof.status) + '</dd>' +
        '<dt>Catégorie</dt><dd>' + esc(catLabel(p.category)) + '</dd>' +
        '<dt>Validé le</dt><dd>' + DP.ui.date(prof.validated_at) + '</dd></dl>') +
      DP.ui.stats([
        ['Offres publiées', published, offers.length + ' au total'],
        ['Demandes envoyées', cons.length, 'Mises en relation demandées'],
        ['Dossiers reçus', received, 'Validés par l’Administrateur'],
        ['Dossiers acceptés', accepted, 'Décisions positives'],
        ['Résultats déclarés', outs.length, 'En attente de vérification']
      ]) +
      DP.ui.card('Accès rapides', '<div class="btn-row">' +
        '<a class="btn btn-primary" href="#/partenaire/recherche">Rechercher des projets</a>' +
        '<a class="btn btn-outline" href="#/partenaire/dossiers">Mes dossiers</a>' +
        '<a class="btn btn-outline" href="#/partenaire/offres">Mes offres</a>' +
        '<a class="btn btn-outline" href="#/partenaire/resultats">Déclarer un résultat</a>' +
        '<a class="btn btn-ghost" href="#/messages">Écrire à l’Administrateur</a></div>');
  }

  /* ---------- Profil ---------- */
  async function renderProfile(el) {
    var p = await myPartner(true);
    if (!p) { el.innerHTML = noPartnerHtml('Mon profil partenaire'); return; }
    el.innerHTML = DP.ui.header('Mon profil partenaire',
        'Ces informations peuvent être consultées par l’Administrateur et figurer dans les dossiers que vous demandez.') +
      DP.ui.card('Identité', '<dl class="kv"><dt>Catégorie</dt><dd>' + esc(catLabel(p.category)) +
        '</dd><dt>E-mail de contact</dt><dd>' + esc(p.contact_email || '—') + '</dd></dl>' +
        '<p class="small muted">Pour changer de catégorie, écrivez à l’Administrateur via la messagerie privée.</p>') +
      DP.ui.card('Informations modifiables', '<form class="form" id="f-partner">' +
        '<div class="field-row">' +
        DP.ui.field({ name: 'legal_name', label: 'Raison sociale ou nom', value: p.legal_name, required: true }) +
        DP.ui.field({ name: 'representative', label: 'Représentant', value: p.representative }) + '</div>' +
        '<div class="field-row">' +
        DP.ui.field({ name: 'phone', label: 'Téléphone', value: p.phone, placeholder: '+243…' }) +
        DP.ui.field({ name: 'geography', label: 'Zones géographiques', value: p.geography, placeholder: 'ex. Kinshasa, Kasaï' }) + '</div>' +
        DP.ui.field({ name: 'sectors', label: 'Secteurs d’intervention', type: 'textarea', rows: 3, value: p.sectors, full: true }) +
        DP.ui.field({ name: 'description', label: 'Présentation de l’organisation', type: 'textarea', rows: 4, value: p.description, full: true }) +
        '<div class="field-row">' +
        DP.ui.field({ name: 'ticket_min', label: 'Ticket minimum indicatif (USD)', type: 'number', step: 'any', min: 0, dataType: 'number', value: p.ticket_min, hint: 'Indicatif, sans engagement.' }) +
        DP.ui.field({ name: 'ticket_max', label: 'Ticket maximum indicatif (USD)', type: 'number', step: 'any', min: 0, dataType: 'number', value: p.ticket_max }) + '</div>' +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer</button></div></form>');

    DP.ui.bindForm(el.querySelector('#f-partner'), async function (d) {
      if (!d.legal_name) throw new Error('La raison sociale est obligatoire.');
      if (d.ticket_min !== null && d.ticket_max !== null && d.ticket_min > d.ticket_max) {
        throw new Error('Le ticket minimum ne peut pas dépasser le ticket maximum.');
      }
      await DP.api.update('partners', { id: 'eq.' + p.id }, {
        legal_name: d.legal_name, representative: d.representative || null, phone: d.phone || null,
        geography: d.geography || null, sectors: d.sectors || null, description: d.description || null,
        ticket_min: d.ticket_min, ticket_max: d.ticket_max
      });
      cache.row = null;
      return 'Profil enregistré.';
    }, null);
  }

  /* ---------- Offres ---------- */
  async function renderOffers(el) {
    var p = await myPartner();
    if (!p) { el.innerHTML = noPartnerHtml('Mes offres'); return; }
    var offers = await DP.api.get('offers', { select: '*', author_id: 'eq.' + DP.api.uid, order: 'created_at.desc', limit: 200 });

    el.innerHTML = DP.ui.header('Mes offres et programmes', PUBLISH_NOTE) +
      DP.ui.card('Nouvelle offre', '<form class="form" id="f-offer">' +
        '<div class="field-row">' +
        DP.ui.field({ name: 'title', label: 'Titre', required: true, full: false }) +
        DP.ui.field({ name: 'offer_type', label: 'Type', type: 'select', options: OFFER_TYPES, value: 'programme_accompagnement' }) + '</div>' +
        DP.ui.field({ name: 'description', label: 'Description', type: 'textarea', rows: 4, full: true, hint: 'Critères, conditions et calendrier, tels que vous les souhaitez publier.' }) +
        '<div class="field-row three">' +
        DP.ui.field({ name: 'target_category', label: 'Catégorie cible', type: 'select', value: '', options: [['', 'Toutes les catégories'], ['ba', 'Ba — Alpha'], ['bb', 'Bb — Bêta'], ['bg', 'Bg — Gamma']] }) +
        DP.ui.field({ name: 'sector', label: 'Secteur', placeholder: 'ex. agriculture' }) +
        DP.ui.field({ name: 'deadline', label: 'Date limite', type: 'date' }) + '</div>' +
        '<div class="field-row three">' +
        DP.ui.field({ name: 'amount_min', label: 'Montant minimum', type: 'number', step: 'any', min: 0, dataType: 'number' }) +
        DP.ui.field({ name: 'amount_max', label: 'Montant maximum', type: 'number', step: 'any', min: 0, dataType: 'number' }) +
        DP.ui.field({ name: 'currency', label: 'Devise', type: 'select', value: 'USD', options: [['USD', 'USD'], ['FC', 'FC']] }) + '</div>' +
        DP.ui.alert('info', 'Votre offre sera enregistrée en brouillon. L’Administrateur la vérifie avant publication. ' + esc(PUBLISH_NOTE)) +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer l’offre</button></div></form>') +
      DP.ui.card('Mes offres (' + offers.length + ')', DP.ui.table([
        { label: 'Titre', render: function (o) { return '<strong>' + esc(o.title) + '</strong>'; } },
        { label: 'Type', render: function (o) { return esc(OFFER_TYPE_LABEL[o.offer_type] || o.offer_type || '—'); } },
        { label: 'Cible', render: function (o) { return o.target_category ? DP.ui.categoryBadge(o.target_category) : 'Toutes'; } },
        { label: 'Secteur', render: function (o) { return esc(o.sector || '—'); } },
        { label: 'Montant', render: function (o) {
          if (o.amount_min === null && o.amount_max === null) return '—';
          return DP.ui.money(o.amount_min, o.currency) + ' – ' + DP.ui.money(o.amount_max, o.currency);
        } },
        { label: 'Échéance', render: function (o) { return DP.ui.date(o.deadline); } },
        { label: 'Statut', render: function (o) { return DP.ui.badge(o.status); } }
      ], offers, 'Aucune offre pour le moment.'));

    DP.ui.bindForm(el.querySelector('#f-offer'), async function (d) {
      if (!d.title) throw new Error('Le titre est obligatoire.');
      if (d.amount_min !== null && d.amount_max !== null && d.amount_min > d.amount_max) {
        throw new Error('Le montant minimum ne peut pas dépasser le montant maximum.');
      }
      await DP.api.insert('offers', {
        author_id: DP.api.uid, author_kind: 'partner', partner_id: p.id,
        title: d.title, offer_type: d.offer_type, description: d.description || null,
        target_category: d.target_category || null, sector: d.sector || null,
        amount_min: d.amount_min, amount_max: d.amount_max, currency: d.currency || 'USD',
        deadline: d.deadline || null, is_paid: false, status: 'draft'
      });
      await DP.navigate();
      return 'Offre enregistrée en brouillon. L’Administrateur la vérifie avant publication.';
    }, null);
  }

  /* ---------- Recherche de projets ---------- */
  function askConnection(projectId, onDone) {
    var m = DP.ui.modal('Demande de mise en relation',
      '<form id="f-motive" class="form">' +
      DP.ui.field({ name: 'motive', label: 'Motif de la demande', type: 'textarea', rows: 5, required: true, hint: 'Expliquez votre intérêt pour ce projet (au moins 20 caractères).' }) +
      '<p class="legal-note">La demande est examinée par l’Administrateur avant toute transmission de documents. ' +
      'Vous ne verrez les pièces qu’après consentement du bénéficiaire. ' + esc(NOTICE) + '</p>' +
      '<div class="form-actions"><button type="button" class="btn btn-outline" data-close>Annuler</button>' +
      '<button class="btn btn-primary" type="submit">Envoyer la demande</button></div></form>');
    var form = m.el.querySelector('#f-motive');
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var motive = String(DP.ui.formData(form).motive || '').trim();
      if (motive.length < 20) { DP.ui.toast('Le motif doit contenir au moins 20 caractères.', 'bad'); return; }
      var btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        await DP.api.rpc('partner_request_connection', { p_project: projectId, p_motive: motive });
        m.close();
        DP.ui.toast('Demande envoyée à l’Administrateur.', 'ok');
        if (onDone) onDone();
      } catch (err) {
        DP.ui.toast(DP.ui.errMsg(err), 'bad');
        btn.disabled = false;
      }
    });
  }

  async function renderSearch(el) {
    var p = await myPartner();
    if (!p) { el.innerHTML = noPartnerHtml('Rechercher des projets'); return; }

    el.innerHTML = DP.ui.header('Rechercher des projets',
        'Projets prêts à être présentés, rattachés à des bénéficiaires actifs. Le nom et les coordonnées du bénéficiaire ne sont pas affichés.') +
      DP.ui.card('Filtres', '<form class="filters" id="f-filter">' +
        DP.ui.field({ name: 'sector', label: 'Secteur', placeholder: 'ex. commerce' }) +
        DP.ui.field({ name: 'currency', label: 'Devise', type: 'select', options: [['', 'Toutes'], ['USD', 'USD'], ['FC', 'FC']] }) +
        '<button class="btn btn-outline" type="submit">Filtrer</button></form>') +
      '<div id="results" aria-live="polite"></div>';

    async function load(sector, currency) {
      var box = el.querySelector('#results');
      DP.ui.loading(box);
      try {
        var rows = await DP.api.rpc('partner_search_projects', { p_sector: sector || null, p_currency: currency || null });
        var mine = await DP.api.get('connection_requests', { select: 'project_id,status', partner_id: 'eq.' + p.id, limit: 500 });
        var open = {};
        mine.forEach(function (c) {
          if (['refused_admin', 'refused', 'closed', 'cancelled'].indexOf(c.status) === -1) open[c.project_id] = c.status;
        });
        box.innerHTML = DP.ui.card('Projets (' + rows.length + ')', DP.ui.table([
          { label: 'Référence', render: function (r) { return '<span class="small">' + esc(projectRef(r.project_id)) + '</span>'; } },
          { label: 'Titre', render: function (r) { return '<strong>' + esc(r.title) + '</strong><div class="small muted">' + esc(r.description ? r.description.slice(0, 140) : '') + '</div>'; } },
          { label: 'Secteur', render: function (r) { return esc(r.sector || '—'); } },
          { label: 'Montant', cls: 'num', render: function (r) { return DP.ui.money(r.amount, r.currency); } },
          { label: 'Catégorie', render: function (r) { return DP.ui.categoryBadge(r.category); } },
          { label: 'Échéance', render: function (r) { return DP.ui.date(r.due_date); } },
          { label: 'Action', cls: 'actions', render: function (r) {
            if (open[r.project_id]) return DP.ui.badge(open[r.project_id]);
            return '<button class="btn btn-primary btn-sm" type="button" data-ask="' + esc(r.project_id) + '">Demander une mise en relation</button>';
          } }
        ], rows, 'Aucun projet ne correspond à ces critères pour le moment.'));
        box.querySelectorAll('[data-ask]').forEach(function (b) {
          b.addEventListener('click', function () { askConnection(b.dataset.ask, function () { load(sector, currency); }); });
        });
      } catch (e) {
        box.innerHTML = DP.ui.errorBox(e);
      }
    }

    var form = el.querySelector('#f-filter');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = DP.ui.formData(form);
      load(f.sector, f.currency);
    });
    await load('', '');
  }

  /* ---------- Dossiers et décisions ---------- */
  function decide(conn, target) {
    var meta = DECISIONS[target];
    if (!meta) return;
    async function run(reason) {
      await DP.api.rpc('partner_set_status', { p_connection: conn.id, p_status: target, p_reason: reason });
      DP.ui.toast('Décision enregistrée.', 'ok');
      DP.navigate();
    }
    if (!meta.needReason) {
      DP.ui.confirm(meta.question + ' Cette décision vous appartient ; DarajaPlus ne décide pas du financement.', meta.label)
        .then(function (ok) { if (ok) run(null).catch(function (e) { DP.ui.toast(DP.ui.errMsg(e), 'bad'); }); });
      return;
    }
    var m = DP.ui.modal(meta.label,
      '<form id="f-decision" class="form">' +
      DP.ui.field({ name: 'reason', label: meta.reasonLabel, type: 'textarea', rows: 4, required: true, hint: 'Minimum 10 caractères. Transmis via l’Administrateur.' }) +
      '<p class="legal-note">Cette décision vous appartient. DarajaPlus ne décide pas du financement et ne garantit aucun résultat.</p>' +
      '<div class="form-actions"><button type="button" class="btn btn-outline" data-close>Annuler</button>' +
      '<button class="btn btn-primary" type="submit">' + esc(meta.label) + '</button></div></form>');
    var form = m.el.querySelector('#f-decision');
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var reason = String(DP.ui.formData(form).reason || '').trim();
      if (reason.length < 10) { DP.ui.toast('Le motif doit contenir au moins 10 caractères.', 'bad'); return; }
      var ok = await DP.ui.confirm(meta.question + ' Cette décision vous appartient ; DarajaPlus ne décide pas du financement.', meta.label);
      if (!ok) return;
      var btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        await run(reason);
        m.close();
      } catch (err) {
        DP.ui.toast(DP.ui.errMsg(err), 'bad');
        btn.disabled = false;
      }
    });
  }

  async function renderDossiers(el) {
    var p = await myPartner(true);
    if (!p) { el.innerHTML = noPartnerHtml('Mes dossiers'); return; }
    var data = await loadConnections(p.id);
    var cons = data.cons, pmap = data.projects;

    var shareable = cons.filter(function (c) { return SHARE_STATUSES.indexOf(c.status) !== -1; }).map(function (c) { return c.id; });
    var shares = shareable.length ? await DP.api.get('document_shares', {
      select: 'id,connection_id,document_id,expires_at',
      connection_id: 'in.(' + shareable.join(',') + ')',
      revoked_at: 'is.null',
      expires_at: 'gt.' + new Date().toISOString(),
      limit: 500
    }) : [];
    var docIds = unique(shares.map(function (s) { return s.document_id; }));
    var docs = docIds.length ? await DP.api.get('documents', {
      select: 'id,doc_type,file_name,storage_path', id: 'in.(' + docIds.join(',') + ')'
    }) : [];
    var dmap = {};
    docs.forEach(function (d) { dmap[d.id] = d; });

    var html = DP.ui.header('Mes dossiers', 'Demandes de mise en relation et décisions. Les pièces ne sont visibles qu’après consentement du bénéficiaire et validation de l’Administrateur.');
    if (!cons.length) {
      el.innerHTML = html + DP.ui.empty('Aucune demande pour le moment. Recherchez un projet pour envoyer une première demande.');
      return;
    }

    html += cons.map(function (c) {
      var pr = pmap[c.project_id] || {};
      var docsForC = shares.filter(function (s) { return s.connection_id === c.id; });
      var docHtml = docsForC.length ? '<ul class="notif-list">' + docsForC.map(function (s) {
        var d = dmap[s.document_id] || {};
        return '<li class="notif"><div class="notif-main"><strong>' + esc(d.doc_type || 'Pièce') + '</strong>' +
          '<div class="small muted">' + esc(d.file_name || '') + ' · accès jusqu’au ' + DP.ui.date(s.expires_at) + '</div></div>' +
          (d.storage_path ? '<button class="btn btn-sm btn-outline" type="button" data-doc="' + esc(d.storage_path) + '">Ouvrir</button>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="small muted">Aucune pièce transmise à ce stade.</p>';

      var note = '';
      if (c.status === 'requested') note = 'En attente de validation par l’Administrateur.';
      if (c.status === 'approved_admin' || c.status === 'consent_given') note = 'En attente du consentement du bénéficiaire ; les pièces autorisées seront transmises ensuite.';
      if (c.status === 'refused_admin') note = 'Demande non retenue par l’Administrateur.' + (c.admin_reason ? ' Motif : ' + c.admin_reason : '');

      var actions = (ACTIONS[c.status] || []).map(function (t) {
        var cls = t === 'refused' ? 'btn-danger' : (t === 'accepted' ? 'btn-accent' : 'btn-outline');
        return '<button class="btn btn-sm ' + cls + '" type="button" data-decide="' + esc(c.id) + '" data-target="' + esc(t) + '">' + esc(DECISIONS[t].label) + '</button>';
      }).join('');

      return DP.ui.card(pr.title || 'Projet', '<div class="grid-2"><dl class="kv">' +
        '<dt>Référence</dt><dd>' + esc(projectRef(c.project_id)) + '</dd>' +
        '<dt>Statut</dt><dd>' + DP.ui.badge(c.status) + '</dd>' +
        '<dt>Montant recherché</dt><dd>' + DP.ui.money(pr.amount, pr.currency) + '</dd>' +
        '<dt>Secteur</dt><dd>' + esc(pr.sector || '—') + '</dd>' +
        '<dt>Demande du</dt><dd>' + DP.ui.date(c.created_at) + '</dd></dl>' +
        '<div><h3>Votre motif</h3><p class="small">' + esc(c.motive || '—') + '</p>' +
        (note ? '<p class="small muted">' + esc(note) + '</p>' : '') + '</div></div>' +
        '<h3>Pièces autorisées</h3>' + docHtml +
        (actions ? '<div class="btn-row" style="margin-top:.75rem">' + actions + '</div>' : ''),
        null);
    }).join('');
    el.innerHTML = html;

    el.querySelectorAll('[data-doc]').forEach(function (b) {
      b.addEventListener('click', async function () {
        try {
          var url = await DP.api.signedUrl(b.dataset.doc, 300);
          window.open(url, '_blank', 'noopener');
        } catch (e) { DP.ui.toast(DP.ui.errMsg(e), 'bad'); }
      });
    });
    el.querySelectorAll('[data-decide]').forEach(function (b) {
      b.addEventListener('click', function () {
        var conn = cons.find(function (c) { return c.id === b.dataset.decide; });
        if (conn) decide(conn, b.dataset.target);
      });
    });
  }

  /* ---------- Résultats déclarés ---------- */
  async function renderResults(el) {
    var p = await myPartner(true);
    if (!p) { el.innerHTML = noPartnerHtml('Résultats déclarés'); return; }
    var data = await loadConnections(p.id);
    var cons = data.cons, pmap = data.projects;
    var outs = await DP.api.get('funding_outcomes', { select: '*', declared_by: 'eq.' + DP.api.uid, order: 'declared_at.desc', limit: 200 });
    var cmap = {};
    cons.forEach(function (c) { cmap[c.id] = c; });
    var eligible = cons.filter(function (c) { return c.status === 'accepted' || c.status === 'closed'; });

    var formHtml = eligible.length
      ? '<form class="form" id="f-outcome">' +
        DP.ui.field({ name: 'connection', label: 'Dossier', type: 'select', required: true,
          options: eligible.map(function (c) { return [c.id, projectRef(c.project_id) + ' — ' + ((pmap[c.project_id] || {}).title || 'Projet')]; }) }) +
        '<div class="field-row">' +
        DP.ui.field({ name: 'result', label: 'Type de résultat', type: 'select', options: RESULT_TYPES, required: true }) +
        DP.ui.field({ name: 'outcome_date', label: 'Date du résultat', type: 'date', value: new Date().toISOString().slice(0, 10) }) + '</div>' +
        '<div class="field-row">' +
        DP.ui.field({ name: 'amount', label: 'Montant obtenu', type: 'number', step: 'any', min: 0, dataType: 'number', hint: 'Obligatoire pour un financement accordé ; facultatif pour un accompagnement.' }) +
        DP.ui.field({ name: 'currency', label: 'Devise', type: 'select', value: 'USD', options: [['USD', 'USD'], ['FC', 'FC']] }) + '</div>' +
        DP.ui.field({ name: 'proof', label: 'Preuve ou référence (facultatif)', hint: 'Référence de la pièce justificative ou confirmation écrite.' }) +
        DP.ui.alert('warn', 'Déclaration vérifiée par l’Administrateur. Ne déclarez que des montants réellement confirmés. ' + esc(NOTICE)) +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Déclarer le résultat</button></div></form>'
      : DP.ui.empty('Un résultat ne peut être déclaré que pour un dossier accepté ou clôturé.');

    el.innerHTML = DP.ui.header('Résultats déclarés', 'Déclarez les résultats de vos décisions positives. Chaque déclaration est vérifiée par l’Administrateur.') +
      DP.ui.card('Déclarer un résultat', formHtml) +
      DP.ui.card('Mes déclarations (' + outs.length + ')', DP.ui.table([
        { label: 'Dossier', render: function (o) {
          var c = cmap[o.connection_id] || {};
          return esc(projectRef(c.project_id || o.connection_id)) + '<div class="small muted">' + esc((pmap[c.project_id] || {}).title || '') + '</div>';
        } },
        { label: 'Résultat', render: function (o) { return esc(RESULT_LABEL[o.result_type] || o.result_type || '—'); } },
        { label: 'Montant', cls: 'num', render: function (o) { return DP.ui.money(o.amount, o.currency); } },
        { label: 'Date', render: function (o) { return DP.ui.date(o.outcome_date); } },
        { label: 'Vérification', render: function (o) { return DP.ui.badge(o.validated ? 'validated' : 'pending'); } }
      ], outs, 'Aucune déclaration pour le moment.'));

    var form = el.querySelector('#f-outcome');
    if (form) {
      DP.ui.bindForm(form, async function (d) {
        if (!d.connection || !d.result) throw new Error('Choisissez un dossier et un type de résultat.');
        if (d.result === 'financement_accorde' && !(d.amount > 0)) throw new Error('Indiquez le montant obtenu pour un financement accordé.');
        var ok = await DP.ui.confirm('Déclarer ce résultat ? Il sera vérifié par l’Administrateur avant d’être retenu.', 'Déclarer');
        if (!ok) return false;
        await DP.api.rpc('partner_declare_outcome', {
          p_connection: d.connection, p_result: d.result, p_amount: d.amount === null ? null : d.amount,
          p_currency: d.currency || 'USD', p_date: d.outcome_date || null, p_proof: d.proof || null
        });
        await DP.navigate();
        return 'Résultat déclaré. Il sera vérifié par l’Administrateur.';
      }, null);
    }
  }

  DP.register([
    { path: '/partenaire', roles: ROLE, title: 'Accueil partenaire', render: renderHome },
    { path: '/partenaire/profil', roles: ROLE, title: 'Mon profil partenaire', render: renderProfile },
    { path: '/partenaire/offres', roles: ROLE, title: 'Mes offres', render: renderOffers },
    { path: '/partenaire/recherche', roles: ROLE, title: 'Rechercher des projets', render: renderSearch },
    { path: '/partenaire/dossiers', roles: ROLE, title: 'Mes dossiers', render: renderDossiers },
    { path: '/partenaire/resultats', roles: ROLE, title: 'Résultats déclarés', render: renderResults }
  ]);
})();
