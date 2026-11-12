/* Espace Administrateur général : comptes, Hôtes, Agents, bénéficiaires, partenaires, ponts, résultats,
   offres, Carrefours, annonces, finances, messages, contacts, territoires, audit et configuration.
   Principe : le serveur (RPC et règles d’accès) contrôle chaque action ; cette interface la présente et la déclenche. */
(function () {
  var DP = window.DP;
  var esc = DP.ui.esc;
  var ui = DP.ui;
  var ROLE = ['admin'];

  var CAT = [['ba', 'Ba — Alpha'], ['bb', 'Bb — Bêta'], ['bg', 'Bg — Gamma']];
  var STATUS_BEN = [['draft', 'Brouillon'], ['incomplete', 'Incomplet'], ['to_verify', 'À vérifier'], ['active', 'Actif'], ['suspended', 'Suspendu'], ['archived', 'Archivé']];
  var STATUS_PROJ = [['draft', 'Brouillon'], ['incomplete', 'Incomplet'], ['to_verify', 'À vérifier'], ['ready', 'Prêt à présenter'], ['in_progress', 'En cours'], ['closed', 'Clôturé']];
  var STATUS_OFFER = [['draft', 'Brouillon'], ['pending_payment', 'En attente de paiement'], ['published', 'Publiée'], ['hidden', 'Masquée'], ['expired', 'Expirée']];
  var STATUS_CARREFOUR = [['draft', 'Brouillon'], ['open', 'Ouvert'], ['full', 'Complet'], ['running', 'En cours'], ['suspended', 'Suspendu'], ['closed', 'Clôturé']];
  var STATUS_VIS = { pending_payment: 'En attente de paiement', paid: 'Payée', active: 'Active', expired: 'Expirée', cancelled: 'Annulée' };
  var OFFER_TYPES = [
    ['programme_accompagnement', 'Programme d’accompagnement'], ['appel_projets', 'Appel à projets'],
    ['offre_financement', 'Offre de financement'], ['opportunite_investissement', 'Opportunité d’investissement']
  ];
  var OFFER_TYPE_LABEL = {};
  OFFER_TYPES.forEach(function (t) { OFFER_TYPE_LABEL[t[0]] = t[1]; });
  var RESULT_LABEL = { financement_accorde: 'Financement accordé', accompagnement_accepte: 'Accompagnement accepté' };
  var CONN_ACTIVE = ['approved_admin', 'consent_given', 'transmitted', 'under_study', 'complement_requested'];

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
  /* Code d’un bénéficiaire : vide tant que le dossier est en brouillon (pas de catégorie validée). */
  function bcode(b) { return b && b.code ? b.code : '—'; }
  /* Nom d’un bénéficiaire ; à défaut, nom du compte lié (cas d’un brouillon sans nom saisi). */
  function benName(b, users) { var n = bname(b); return n !== '—' ? n : pname(users ? users[b.user_id] : null); }
  /* Statut d’un dossier : un brouillon attend la catégorie choisie par le bénéficiaire. */
  function benStatus(b) { return b.status === 'draft' ? '<span class="badge badge-warn">En attente de catégorie</span>' : ui.badge(b.status); }
  var BEN_STATUS_FILTER = STATUS_BEN.map(function (s) { return s[0] === 'draft' ? ['draft', 'En attente de catégorie'] : s; });
  function options(list, value, placeholder) {
    return (placeholder !== undefined ? '<option value="">' + esc(placeholder) + '</option>' : '') + list.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value === null || value === undefined ? '' : value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('');
  }
  function pct(r) { return Math.round(Number(r || 0) * 100) + ' %'; }
  function refresh() { return DP.navigate(); }
  function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

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

  function reasonModal(title, label, okLabel, save) {
    var m = ui.modal(title, '<form class="form" id="rm">' +
      ui.field({ name: 'reason', label: label, type: 'textarea', rows: 3, required: true, full: true }) +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">' + esc(okLabel) + '</button></div></form>');
    ui.bindForm(m.el.querySelector('#rm'), async function (d) {
      if (!d.reason) throw new Error('Le motif est obligatoire.');
      await save(d.reason);
      m.close();
      refresh();
      return 'Décision enregistrée.';
    }, null);
  }

  /* Données de référence : zones, quartiers, Hôtes, Agents actifs. */
  async function lookups() {
    var r = await Promise.all([
      DP.api.get('zones', { select: '*', order: 'id.asc' }),
      DP.api.get('quartiers', { select: '*', order: 'zone_id.asc,id.asc' }),
      DP.api.get('profiles', { select: 'id,role,status,zone_id,host_id,code,prenom,nom,email', role: 'eq.host', order: 'zone_id.asc' }),
      DP.api.get('profiles', { select: 'id,role,status,zone_id,host_id,code,prenom,nom,email,quartier_id', role: 'eq.agent', status: 'eq.active', order: 'code.asc' })
    ]);
    return { zones: r[0], quartiers: r[1], hosts: r[2], agents: r[3] };
  }

  /* Quartiers d’une zone (liste pour les menus déroulants). */
  function quartiersOfZone(lk, zoneId) {
    return lk.quartiers.filter(function (q) { return String(q.zone_id) === String(zoneId); }).map(function (q) { return [q.id, q.name]; });
  }

  /* Noms des profils liés à une liste d’identifiants (sans jointure PostgREST). */
  async function profilesFor(ids) {
    var q = inq(ids);
    return q ? byId(await DP.api.get('profiles', { select: 'id,role,status,code,prenom,nom,email,host_id,zone_id,quartier_id,identifiant', id: q })) : {};
  }
  async function beneficiariesFor(ids) {
    var q = inq(ids);
    return q ? byId(await DP.api.get('beneficiaries', { select: 'id,code,category,status,prenom,nom,agent_id,host_id', id: q })) : {};
  }

  /* ---------- Vue générale ---------- */
  async function renderOverview(el) {
    var s = await DP.api.rpc('admin_stats', {});
    el.innerHTML = ui.header('Vue générale', 'Situation de la plateforme et actions à traiter.') +
      ui.stats([
        ['Comptes à valider', s.comptes_en_attente, 'Inscriptions en attente', s.comptes_en_attente ? 'warn' : ''],
        ['Bénéficiaires Bg', s.bg, 'Gamma (max 500)'],
        ['Bénéficiaires Bb', s.bb, 'Bêta (max 1 500)'],
        ['Bénéficiaires Ba', s.ba, 'Alpha (max 3 000)'],
        ['Hôtes actifs', s.hotes_actifs, 'Sur 5 maximum'],
        ['Agents actifs', s.agents_actifs, 'Sur 50 maximum'],
        ['Partenaires actifs', s.partenaires_actifs, s.partenaires_en_attente + ' en attente'],
        ['Ponts à valider', s.ponts_a_valider, 'Demandes de mise en relation', s.ponts_a_valider ? 'warn' : ''],
        ['Ponts en cours', s.ponts_en_cours, 'En traitement'],
        ['Résultats à valider', s.resultats_a_valider, 'Déclarations de partenaires', s.resultats_a_valider ? 'warn' : ''],
        ['Dossiers prêts', s.dossiers_prets, 'Prêts à présenter'],
        ['Messages non lus', s.messages_non_lus, 'Messages des utilisateurs', s.messages_non_lus ? 'warn' : ''],
        ['Commissions simulées', ui.money(s.commissions_simulees_fc, 'FC'), 'Simulation : aucune créance exigible'],
        ['Visibilités à confirmer', s.visibilites_a_payer, 'En attente de paiement']
      ]) +
      ui.card('Actions à traiter', '<div class="btn-row">' +
        '<a class="btn btn-primary" href="#/admin/comptes">Comptes à valider</a>' +
        '<a class="btn btn-outline" href="#/admin/ponts">Ponts à valider</a>' +
        '<a class="btn btn-outline" href="#/admin/resultats">Résultats à valider</a>' +
        '<a class="btn btn-outline" href="#/admin/messages">Messages</a>' +
        '<a class="btn btn-outline" href="#/admin/contacts">Contacts</a></div>' +
        '<p class="small muted">Chaque notification de la plateforme arrive dans « Notifications ».</p>');
  }

  /* ---------- Comptes ---------- */
  /* Confirmation après validation : la date et l’heure exactes sont relues en base. */
  async function confirmValidated(p) {
    var when = '', ident = '';
    try {
      var r = await DP.api.get('profiles', { select: 'validated_at,identifiant', id: 'eq.' + p.id });
      if (r[0] && r[0].validated_at) when = ' le ' + ui.dateTime(r[0].validated_at);
      if (r[0] && r[0].identifiant) ident = ' Identifiant : ' + r[0].identifiant + '.';
    } catch (e) { /* l’heure et l’identifiant restent facultatifs dans la confirmation */ }
    ui.toast('Compte de ' + pname(p) + ' validé' + when + '.' + ident + ' La personne est prévenue sur son compte.', 'ok');
  }

  function actionsForAccount(p) {
    if (p.status === 'pending' || p.status === 'rejected') {
      return '<button class="btn btn-sm btn-outline" type="button" data-review="' + esc(p.id) + '">Examiner</button> ' +
        '<button class="btn btn-sm btn-primary" type="button" data-quick-approve="' + esc(p.id) + '">Valider</button>';
    }
    if (p.status === 'active') {
      return '<button class="btn btn-sm btn-danger" type="button" data-revoke="' + esc(p.id) + '">Révoquer</button> ' +
        '<button class="btn btn-sm btn-orange" type="button" data-suspend="' + esc(p.id) + '">Suspendre</button>';
    }
    if (p.status === 'suspended') return '<button class="btn btn-sm btn-outline" type="button" data-reactivate="' + esc(p.id) + '">Réactiver</button>';
    return '—';
  }

  async function renderAccounts(el, ctx) {
    var filter = (ctx.query && ctx.query.get('statut')) || 'pending';
    var tabs = [['pending', 'En attente'], ['active', 'Actifs'], ['suspended', 'Suspendus'], ['rejected', 'Refusés']];
    var rows = await DP.api.get('profiles', { select: '*', status: 'eq.' + filter, role: 'neq.admin', order: 'created_at.desc', limit: 500 });
    var map = byId(rows);
    var lk = await lookups();
    el.innerHTML = ui.header('Comptes à valider', 'Chaque inscription est validée ou refusée par l’Administrateur général. Un refus exige un motif, visible par la personne.') +
      '<div class="tabs" role="tablist">' + tabs.map(function (t) {
        return '<a class="tab' + (t[0] === filter ? ' active' : '') + '" href="#/admin/comptes?statut=' + t[0] + '">' + esc(t[1]) + '</a>';
      }).join('') + '</div>' +
      ui.card(null, ui.table([
        { label: 'Nom', render: function (p) { return '<strong>' + esc(pname(p)) + '</strong>' + (p.identifiant ? ' <span class="small muted">' + esc(p.identifiant) + '</span>' : '') + (p.code ? '<div class="small muted">' + esc(p.code) + '</div>' : ''); } },
        { label: 'Rôle', render: function (p) { return esc(DP.labels.role[p.role] || p.role); } },
        { label: 'E-mail', render: function (p) { return esc(p.email || '—'); } },
        { label: 'Téléphone', render: function (p) { return esc(p.phone || '—'); } },
        { label: 'Inscrit le', render: function (p) { return ui.date(p.created_at); } },
        { label: 'Statut', render: function (p) { return p.status === 'active' ? '<span class="badge badge-ok">Validé</span>' : ui.badge(p.status); } },
        { label: 'Validé le', render: function (p) { return p.validated_at ? ui.dateTime(p.validated_at) : '—'; } },
        { label: 'Motif de refus', render: function (p) { return esc(short(p.rejection_reason, 80) || '—'); } },
        { label: 'Action', cls: 'actions', render: actionsForAccount }
      ], rows, 'Aucun compte dans cette catégorie.'));

    act(el, '[data-review]', function (b) { return openReview(map[b.dataset.review], lk); });
    act(el, '[data-quick-approve]', async function (b) {
      var p = map[b.dataset.quickApprove];
      /* Hôte et Agent : l'affectation (zone, Hôte) doit être choisie avant validation, la fenêtre s'ouvre.
         Bénéficiaire (Agent facultatif) et partenaire : validation directe au clic. */
      if (p.role === 'host' || p.role === 'agent') {
        ui.toast('Choisissez l’affectation de cette personne dans la fenêtre qui s’ouvre, puis cliquez sur « Valider le compte ».', 'ok');
        return openReview(p, lk);
      }
      await DP.api.rpc('admin_review_account', { p_profile: p.id, p_decision: 'approve', p_reason: null, p_zone: null, p_host: null, p_agent: null, p_category: null, p_sponsor: null, p_quartier: null });
      await confirmValidated(p);
      location.hash = '#/admin/comptes?statut=active';
      refresh();
    });
    act(el, '[data-suspend]', async function (b) {
      var p = map[b.dataset.suspend];
      if (!(await ui.confirm('Suspendre le compte de ' + pname(p) + ' ? La personne ne pourra plus accéder à la plateforme jusqu’à réactivation.', 'Suspendre'))) return;
      await DP.api.rpc('admin_review_account', { p_profile: p.id, p_decision: 'suspend', p_reason: null });
      ui.toast('Compte suspendu.', 'ok');
      refresh();
    });
    act(el, '[data-reactivate]', async function (b) {
      await DP.api.rpc('admin_review_account', { p_profile: b.dataset.reactivate, p_decision: 'reactivate', p_reason: null });
      ui.toast('Compte réactivé.', 'ok');
      refresh();
    });
    /* Révoquer un compte validé : il passe dans « Refusés », avec un motif visible par la personne. */
    act(el, '[data-revoke]', function (b) {
      var p = map[b.dataset.revoke];
      return reasonModal('Révoquer le compte de ' + pname(p), 'Motif de la révocation (obligatoire, visible par la personne)', 'Révoquer', function (reason) {
        return DP.api.rpc('admin_review_account', { p_profile: p.id, p_decision: 'reject', p_reason: reason });
      });
    });
  }

  /* Fenêtre de validation : les champs dépendent du rôle demandé. */
  async function openReview(p, lk) {
    if (!p) return;
    var partner = null;
    if (p.role === 'partner') partner = (await DP.api.get('partners', { select: '*', profile_id: 'eq.' + p.id }))[0] || null;
    var zmap = byId(lk.zones);
    function zoneName(id) { return zmap[id] ? zmap[id].name : '—'; }
    function quartierOpts(zoneId) { return quartiersOfZone(lk, zoneId); }

    var info = '<dl class="kv"><dt>Nom</dt><dd>' + esc(pname(p)) + '</dd>' +
      '<dt>Rôle demandé</dt><dd>' + esc(DP.labels.role[p.role]) + '</dd>' +
      '<dt>E-mail</dt><dd>' + esc(p.email || '—') + '</dd>' +
      '<dt>Téléphone</dt><dd>' + esc(p.phone || '—') + '</dd>' +
      (p.role === 'beneficiary' ? '<dt>Identifiant</dt><dd>' + esc(p.identifiant || 'Attribué à la validation') + '</dd>' +
        '<dt>Catégorie souhaitée</dt><dd>' + esc(p.wish_category ? DP.labels.category[p.wish_category] : 'Non indiquée') + '</dd>' : '') +
      (partner ? '<dt>Organisation</dt><dd>' + esc(partner.legal_name) + '</dd>' +
        '<dt>Catégorie</dt><dd>' + esc(DP.labels.partnerCategory[partner.category] || partner.category) + '</dd>' +
        '<dt>Zones</dt><dd>' + esc(partner.geography || '—') + '</dd>' +
        '<dt>Secteurs</dt><dd>' + esc(partner.sectors || '—') + '</dd>' +
        '<dt>Présentation</dt><dd>' + esc(partner.description || '—') + '</dd>' +
        '<dt>Tickets indicatifs</dt><dd>' + esc(partner.ticket_min ? ui.money(partner.ticket_min, 'USD') : '—') + ' à ' + esc(partner.ticket_max ? ui.money(partner.ticket_max, 'USD') : '—') + '</dd>' : '') +
      '</dl>';

    var body = '';
    if (p.role === 'host') {
      var taken = lk.hosts.filter(function (h) { return h.zone_id && (h.status === 'active' || h.status === 'suspended'); }).map(function (h) { return h.zone_id; });
      var free = lk.zones.filter(function (z) { return taken.indexOf(z.id) === -1; }).map(function (z) { return [z.id, z.name]; });
      body = ui.field({ name: 'zone', label: 'Zone attribuée', type: 'select', options: free, placeholder: 'Choisir une zone', required: true, dataType: 'nullable',
        hint: free.length ? 'Une seule Hôte par zone. Seules les zones libres sont proposées.' : 'Toutes les zones ont déjà un Hôte.' });
    } else if (p.role === 'agent') {
      var hosts = lk.hosts.filter(function (h) { return h.status === 'active'; }).map(function (h) {
        return [h.id, zoneName(h.zone_id) + ' — ' + pname(h) + ' (' + (h.code || '') + ')'];
      });
      body = ui.field({ name: 'host', label: 'Hôte encadrant', type: 'select', options: hosts, placeholder: 'Choisir un Hôte actif', required: true, dataType: 'nullable',
        hint: 'Un Hôte encadre au maximum 10 Agents.' }) +
        ui.field({ name: 'quartier', label: 'Quartier de rattachement', type: 'select', options: [], placeholder: 'Choisir l’Hôte d’abord', dataType: 'nullable',
          hint: 'Facultatif. Les quartiers proposés sont ceux de la zone de l’Hôte.' });
    } else if (p.role === 'beneficiary') {
      /* Pas de catégorie ni de parrain ici : le bénéficiaire choisit sa catégorie dans son espace après validation. */
      body = ui.alert('info', '<strong>Après validation</strong>, le bénéficiaire reçoit son identifiant et choisit lui-même sa catégorie dans son espace. ' +
        'Vous pouvez aussi lui affecter un Agent maintenant ou plus tard.') +
        ui.field({ name: 'agent', label: 'Agent (facultatif : l’affectation peut se faire plus tard)', type: 'select', options: lk.agents.map(function (a) {
          return [a.id, pname(a) + ' (' + (a.code || '') + ') — ' + zoneName(a.zone_id)];
        }), placeholder: 'Aucun Agent pour le moment', dataType: 'nullable' }) +
        (lk.quartiers.length ? ui.field({ name: 'quartier', label: 'Quartier', type: 'select', options: [], placeholder: 'Choisir l’Agent d’abord', dataType: 'nullable',
          hint: 'Facultatif. Proposé seulement avec un Agent.' }) : '');
    } else {
      body = '<p class="small muted">Compte partenaire : vérifiez l’organisation puis validez. La décision de financement reste au partenaire.</p>';
    }

    /* Sans Hôte actif, un Agent ne peut pas être rattaché : on le dit clairement. */
    if (p.role === 'agent' && !lk.hosts.some(function (h) { return h.status === 'active'; })) {
      body = ui.alert('warn', '<strong>Aucun Hôte actif pour le moment.</strong> Un Agent est rattaché à un Hôte : validez d’abord l’Hôte de sa zone.') + body;
    }

    var reason = ui.field({ name: 'reason', label: 'Motif (obligatoire en cas de refus)', type: 'textarea', rows: 3, full: true });
    var m = ui.modal('Examiner le compte', info + '<form class="form" id="rv">' + body + reason + '</form>',
      '<button type="button" class="btn btn-outline" data-decision="reject">Refuser</button> ' +
      '<button type="button" class="btn btn-primary" data-decision="approve">Valider le compte</button>');
    var form = m.el.querySelector('#rv');
    var F = form.elements;

    if (p.role === 'agent' && F.host) {
      F.host.addEventListener('change', function () {
        var h = lk.hosts.find(function (x) { return String(x.id) === F.host.value; });
        F.quartier.innerHTML = options(quartierOpts(h && h.zone_id), '', 'Aucun quartier précis');
      });
    }
    if (p.role === 'beneficiary' && F.agent && F.quartier) {
      /* Le quartier ne se choisit qu’avec un Agent : il suit la zone de l’Agent. */
      var refreshQuartier = function () {
        var a = lk.agents.find(function (x) { return String(x.id) === F.agent.value; });
        F.quartier.disabled = !a;
        F.quartier.innerHTML = a ? options(quartierOpts(a.zone_id), '', 'Aucun quartier précis') : options([], '', 'Choisir l’Agent d’abord');
      };
      F.agent.addEventListener('change', refreshQuartier);
      refreshQuartier();
    }

    act(m.el, '[data-decision]', async function (btn) {
      var d = ui.formData(form);
      if (btn.dataset.decision === 'reject') {
        if (!d.reason) throw new Error('Un motif de refus est obligatoire.');
        if (!(await ui.confirm('Refuser ce compte ? Le motif sera visible par la personne.', 'Refuser'))) return;
        await DP.api.rpc('admin_review_account', { p_profile: p.id, p_decision: 'reject', p_reason: d.reason });
        m.close();
        ui.toast('Compte refusé.', 'ok');
        refresh();
        return;
      }
      var payload = { p_profile: p.id, p_decision: 'approve', p_reason: null, p_zone: null, p_host: null, p_agent: null, p_category: null, p_sponsor: null, p_quartier: null };
      if (p.role === 'host') {
        if (!d.zone) throw new Error('Choisissez la zone de cet Hôte.');
        payload.p_zone = Number(d.zone);
      } else if (p.role === 'agent') {
        if (!d.host) throw new Error('Choisissez l’Hôte encadrant.');
        payload.p_host = d.host;
        if (d.quartier) payload.p_quartier = Number(d.quartier);
      } else if (p.role === 'beneficiary') {
        /* Agent facultatif ; catégorie et parrain toujours null (choisis par le bénéficiaire après validation). */
        payload.p_agent = d.agent || null;
        payload.p_quartier = d.agent && d.quartier ? Number(d.quartier) : null;
      }
      await DP.api.rpc('admin_review_account', payload);
      m.close();
      await confirmValidated(p);
      location.hash = '#/admin/comptes?statut=active';
      refresh();
    });
  }

  /* ---------- Hôtes et zones ---------- */
  async function renderHosts(el) {
    var r = await Promise.all([
      DP.api.get('zones', { select: '*', order: 'id.asc' }),
      DP.api.get('profiles', { select: '*', role: 'eq.host', order: 'zone_id.asc' }),
      DP.api.get('profiles', { select: 'id,host_id,status', role: 'eq.agent' })
    ]);
    var zones = r[0], hosts = r[1], agents = r[2];
    var hmap = byId(hosts);
    var rows = zones.map(function (z) {
      var h = hosts.find(function (x) { return x.zone_id === z.id && x.status !== 'rejected'; }) || null;
      var n = h ? agents.filter(function (a) { return a.host_id === h.id; }).length : 0;
      return { zone: z, host: h, agents: n };
    });
    el.innerHTML = ui.header('Hôtes et zones', 'Cinq zones, un Hôte par zone, jusqu’à 10 Agents par Hôte. La répartition des 26 provinces entre les cinq Hôtes reste à finaliser.') +
      ui.alert('warn', '<strong>Décision en attente :</strong> le partage des 26 provinces entre les cinq Hôtes n’est pas encore arrêté. Les zones ci-dessous sont celles de la Cité d’entreprise.') +
      ui.card(null, ui.table([
        { label: 'Zone', render: function (r) { return '<strong>' + esc(r.zone.name) + '</strong><div class="small muted">Zone ' + r.zone.id + '</div>'; } },
        { label: 'Hôte', render: function (r) { return r.host ? esc(pname(r.host)) + '<div class="small muted">' + esc(r.host.code || '') + '</div>' : '<span class="muted">Aucun Hôte</span>'; } },
        { label: 'Statut', render: function (r) { return r.host ? ui.badge(r.host.status) : '—'; } },
        { label: 'Agents', cls: 'num', render: function (r) { return r.agents + ' / 10'; } },
        { label: 'Action', cls: 'actions', render: function (r) {
          if (!r.host) return '<a class="btn btn-sm btn-outline" href="#/admin/comptes">Voir les comptes</a>';
          return r.host.status === 'active'
            ? '<button class="btn btn-sm btn-outline" type="button" data-suspend="' + esc(r.host.id) + '">Suspendre</button>'
            : (r.host.status === 'suspended' ? '<button class="btn btn-sm btn-outline" type="button" data-reactivate="' + esc(r.host.id) + '">Réactiver</button>' : '—');
        } }
      ], rows, 'Aucune zone.'));
    act(el, '[data-suspend]', async function (b) {
      var h = hmap[b.dataset.suspend];
      if (!(await ui.confirm('Suspendre l’Hôte ' + pname(h) + ' ?', 'Suspendre'))) return;
      await DP.api.rpc('admin_review_account', { p_profile: h.id, p_decision: 'suspend', p_reason: null });
      ui.toast('Hôte suspendu.', 'ok');
      refresh();
    });
    act(el, '[data-reactivate]', async function (b) {
      await DP.api.rpc('admin_review_account', { p_profile: b.dataset.reactivate, p_decision: 'reactivate', p_reason: null });
      ui.toast('Hôte réactivé.', 'ok');
      refresh();
    });
  }

  /* ---------- Agents ---------- */
  async function renderAgents(el) {
    var r = await Promise.all([
      DP.api.get('profiles', { select: '*', role: 'eq.agent', order: 'code.asc' }),
      DP.api.get('profiles', { select: 'id,role,code,prenom,nom,status', role: 'eq.host' }),
      DP.api.get('zones', { select: '*' }),
      DP.api.get('quartiers', { select: '*' }),
      DP.api.get('beneficiaries', { select: 'agent_id,category', status: 'neq.archived' })
    ]);
    var agents = r[0], hosts = byId(r[1]), zones = byId(r[2]), quart = byId(r[3]), bens = r[4];
    var counts = {};
    bens.forEach(function (b) {
      /* Un brouillon (sans Agent ou sans catégorie) n’est compté nulle part. */
      if (!b.agent_id || !b.category) return;
      var c = counts[b.agent_id] || (counts[b.agent_id] = { bg: 0, bb: 0, ba: 0 });
      if (c[b.category] !== undefined) c[b.category]++;
    });
    var map = byId(agents);
    el.innerHTML = ui.header('Agents', 'Un Agent gère au maximum 100 bénéficiaires : 10 Bg, 30 Bb et 60 Ba.') +
      ui.card(null, ui.table([
        { label: 'Agent', render: function (a) { return '<strong>' + esc(pname(a)) + '</strong><div class="small muted">' + esc(a.code || '') + ' · ' + esc(a.email || '') + '</div>'; } },
        { label: 'Hôte', render: function (a) { return esc(hosts[a.host_id] ? pname(hosts[a.host_id]) : '—'); } },
        { label: 'Zone', render: function (a) { return esc(zones[a.zone_id] ? zones[a.zone_id].name : '—'); } },
        { label: 'Quartier', render: function (a) { return esc(quart[a.quartier_id] ? quart[a.quartier_id].name : '—'); } },
        { label: 'Bénéficiaires', render: function (a) {
          var c = counts[a.id] || { bg: 0, bb: 0, ba: 0 };
          return 'Bg ' + c.bg + '/10 · Bb ' + c.bb + '/30 · Ba ' + c.ba + '/60';
        } },
        { label: 'Statut', render: function (a) { return ui.badge(a.status); } },
        { label: 'Action', cls: 'actions', render: function (a) {
          if (a.status === 'active') return '<button class="btn btn-sm btn-outline" type="button" data-suspend="' + esc(a.id) + '">Suspendre</button>';
          if (a.status === 'suspended') return '<button class="btn btn-sm btn-outline" type="button" data-reactivate="' + esc(a.id) + '">Réactiver</button>';
          return '<a class="btn btn-sm btn-outline" href="#/admin/comptes">Examiner</a>';
        } }
      ], agents, 'Aucun Agent pour le moment.'));
    act(el, '[data-suspend]', async function (b) {
      var a = map[b.dataset.suspend];
      if (!(await ui.confirm('Suspendre l’Agent ' + pname(a) + ' ? Ses bénéficiaires restent rattachés à lui.', 'Suspendre'))) return;
      await DP.api.rpc('admin_review_account', { p_profile: a.id, p_decision: 'suspend', p_reason: null });
      ui.toast('Agent suspendu.', 'ok');
      refresh();
    });
    act(el, '[data-reactivate]', async function (b) {
      await DP.api.rpc('admin_review_account', { p_profile: b.dataset.reactivate, p_decision: 'reactivate', p_reason: null });
      ui.toast('Agent réactivé.', 'ok');
      refresh();
    });
  }

  /* ---------- Bénéficiaires ---------- */
  async function renderBeneficiaries(el, ctx) {
    var cat = (ctx.query && ctx.query.get('categorie')) || '';
    var st = (ctx.query && ctx.query.get('statut')) || '';
    var params = { select: '*', order: 'created_at.desc', limit: 1000 };
    if (cat) params.category = 'eq.' + cat;
    if (st) params.status = 'eq.' + st;
    var rows = await DP.api.get('beneficiaries', params);
    /* Agents, Hôtes et comptes liés (identifiant) : une seule requête de profils. */
    var pr = await profilesFor(rows.map(function (b) { return b.agent_id; })
      .concat(rows.map(function (b) { return b.host_id; }), rows.map(function (b) { return b.user_id; })));
    var map = byId(rows);
    el.innerHTML = ui.header('Bénéficiaires', rows.length + ' bénéficiaire(s) affiché(s). Création par les Agents ; activation par l’Hôte ou l’Administrateur.') +
      ui.card(null, filterBar('#/admin/beneficiaires', [
        { name: 'categorie', label: 'Catégorie', value: cat, options: [['', 'Toutes']].concat(CAT) },
        { name: 'statut', label: 'Statut', value: st, options: [['', 'Tous']].concat(BEN_STATUS_FILTER) }
      ]) + ui.table([
        { label: 'Code', render: function (b) { return '<strong>' + esc(bcode(b)) + '</strong>'; } },
        { label: 'Identifiant', render: function (b) { return esc((pr[b.user_id] || {}).identifiant || '—'); } },
        { label: 'Bénéficiaire', render: function (b) { return esc(benName(b, pr)); } },
        { label: 'Catégorie', render: function (b) { return ui.categoryBadge(b.category); } },
        { label: 'Agent', render: function (b) { return esc(pname(pr[b.agent_id])); } },
        { label: 'Hôte', render: function (b) { return esc(pname(pr[b.host_id])); } },
        { label: 'Statut', render: function (b) { return benStatus(b); } },
        { label: 'Action', cls: 'actions', render: function (b) {
          /* Un brouillon sans Agent peut recevoir un Agent ; le bouton disparaît ensuite. */
          var assign = b.status === 'draft' && b.user_id ? '<button class="btn btn-sm btn-primary" type="button" data-assign="' + esc(b.user_id) + '">Affecter un Agent</button> ' : '';
          return assign + '<button class="btn btn-sm btn-outline" type="button" data-status="' + esc(b.id) + '">Statut</button>';
        } }
      ], rows, 'Aucun bénéficiaire ne correspond à ces filtres.'));
    bindFilters(el);
    act(el, '[data-status]', function (b) {
      var x = map[b.dataset.status];
      statusModal('Statut de ' + (x.code || benName(x, pr)), x.status, STATUS_BEN, function (status) {
        return DP.api.update('beneficiaries', { id: 'eq.' + x.id }, { status: status });
      });
    });
    act(el, '[data-assign]', function (b) { return openAssignAgent(b.dataset.assign); });
  }

  /* Affectation d’un Agent à un bénéficiaire en brouillon (catégorie non encore choisie). Le serveur contrôle la règle. */
  async function openAssignAgent(userId) {
    var lk = await lookups();
    var zmap = byId(lk.zones);
    var hasQ = lk.quartiers.length > 0;
    var m = ui.modal('Affecter un Agent',
      '<p class="small muted">Le bénéficiaire reste en attente de catégorie : il la choisit dans son espace après validation.</p>' +
      (lk.agents.length ? '' : ui.alert('warn', '<strong>Aucun Agent actif pour le moment.</strong> Validez d’abord un Agent.')) +
      '<form class="form" id="as">' +
      ui.field({ name: 'agent', label: 'Agent de rattachement', type: 'select', options: lk.agents.map(function (a) {
        return [a.id, pname(a) + ' (' + (a.code || '') + ') — ' + (zmap[a.zone_id] ? zmap[a.zone_id].name : '—')];
      }), placeholder: 'Choisir un Agent actif', required: true, dataType: 'nullable' }) +
      (hasQ ? ui.field({ name: 'quartier', label: 'Quartier', type: 'select', options: [], placeholder: 'Choisir l’Agent d’abord', dataType: 'nullable',
        hint: 'Facultatif. Proposé selon la zone de l’Agent.' }) : '') +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">Affecter</button></div></form>');
    var form = m.el.querySelector('#as');
    var F = form.elements;
    if (hasQ) {
      var refreshQuartier = function () {
        var a = lk.agents.find(function (x) { return String(x.id) === F.agent.value; });
        F.quartier.disabled = !a;
        F.quartier.innerHTML = a ? options(quartiersOfZone(lk, a.zone_id), '', 'Aucun quartier précis') : options([], '', 'Choisir l’Agent d’abord');
      };
      F.agent.addEventListener('change', refreshQuartier);
      refreshQuartier();
    }
    ui.bindForm(form, async function (d) {
      if (!d.agent) throw new Error('Choisissez un Agent.');
      await DP.api.rpc('admin_assign_agent', { p_profile: userId, p_agent: d.agent, p_quartier: d.quartier ? Number(d.quartier) : null });
      m.close();
      refresh();
      return 'Agent affecté.';
    }, null);
  }

  /* ---------- Partenaires ---------- */
  async function renderPartners(el) {
    var partners = await DP.api.get('partners', { select: '*', order: 'created_at.desc' });
    var prof = await profilesFor(partners.map(function (p) { return p.profile_id; }));
    el.innerHTML = ui.header('Partenaires', partners.length + ' partenaire(s) sur 100 possibles. Une validation n’implique aucun engagement de financement.') +
      ui.card(null, ui.table([
        { label: 'Organisation', render: function (p) { return '<strong>' + esc(p.legal_name) + '</strong><div class="small muted">' + esc(p.representative || '') + '</div>'; } },
        { label: 'Catégorie', render: function (p) { return esc(DP.labels.partnerCategory[p.category] || p.category); } },
        { label: 'Contact', render: function (p) { return esc(p.contact_email || '—') + '<div class="small muted">' + esc(p.phone || '') + '</div>'; } },
        { label: 'Zones / secteurs', render: function (p) { return esc(short(p.geography, 40) || '—') + '<div class="small muted">' + esc(short(p.sectors, 60) || '') + '</div>'; } },
        { label: 'Tickets (USD)', cls: 'num', render: function (p) { return (p.ticket_min ? ui.money(p.ticket_min, 'USD') : '—') + ' à ' + (p.ticket_max ? ui.money(p.ticket_max, 'USD') : '—'); } },
        { label: 'Statut', render: function (p) { return ui.badge((prof[p.profile_id] || {}).status); } },
        { label: 'Action', cls: 'actions', render: function (p) {
          var s = (prof[p.profile_id] || {}).status;
          if (s === 'active') return '<button class="btn btn-sm btn-outline" type="button" data-suspend="' + esc(p.profile_id) + '">Suspendre</button>';
          if (s === 'suspended') return '<button class="btn btn-sm btn-outline" type="button" data-reactivate="' + esc(p.profile_id) + '">Réactiver</button>';
          return '<a class="btn btn-sm btn-outline" href="#/admin/comptes">Examiner</a>';
        } }
      ], partners, 'Aucun partenaire pour le moment.'));
    act(el, '[data-suspend]', async function (b) {
      if (!(await ui.confirm('Suspendre ce partenaire ? Il ne pourra plus consulter les dossiers.', 'Suspendre'))) return;
      await DP.api.rpc('admin_review_account', { p_profile: b.dataset.suspend, p_decision: 'suspend', p_reason: null });
      ui.toast('Partenaire suspendu.', 'ok');
      refresh();
    });
    act(el, '[data-reactivate]', async function (b) {
      await DP.api.rpc('admin_review_account', { p_profile: b.dataset.reactivate, p_decision: 'reactivate', p_reason: null });
      ui.toast('Partenaire réactivé.', 'ok');
      refresh();
    });
  }

  /* ---------- Projets et besoins ---------- */
  async function renderProjects(el, ctx) {
    var st = (ctx.query && ctx.query.get('statut')) || '';
    var params = { select: '*', order: 'created_at.desc', limit: 500 };
    if (st) params.status = 'eq.' + st;
    var rows = await DP.api.get('projects', params);
    var bens = await beneficiariesFor(rows.map(function (p) { return p.beneficiary_id; }));
    var map = byId(rows);
    el.innerHTML = ui.header('Projets et besoins', 'Un dossier devient « Prêt à présenter » après contrôle de l’équipe ; seul ce statut permet une demande de mise en relation.') +
      ui.card(null, filterBar('#/admin/projets', [{ name: 'statut', label: 'Statut', value: st, options: [['', 'Tous']].concat(STATUS_PROJ) }]) +
        ui.table([
          { label: 'Projet', render: function (p) { return '<strong>' + esc(p.title) + '</strong><div class="small muted">' + esc(p.sector || '') + '</div>'; } },
          { label: 'Bénéficiaire', render: function (p) { var b = bens[p.beneficiary_id]; return esc(b ? bcode(b) + ' — ' + bname(b) : '—'); } },
          { label: 'Montant', cls: 'num', render: function (p) { return ui.money(p.amount, p.currency); } },
          { label: 'Statut', render: function (p) { return ui.badge(p.status); } },
          { label: 'Créé le', render: function (p) { return ui.date(p.created_at); } },
          { label: 'Action', cls: 'actions', render: function (p) { return '<button class="btn btn-sm btn-outline" type="button" data-status="' + esc(p.id) + '">Statut</button>'; } }
        ], rows, 'Aucun projet ne correspond à ces filtres.'));
    bindFilters(el);
    act(el, '[data-status]', function (b) {
      var p = map[b.dataset.status];
      statusModal('Statut du projet', p.status, STATUS_PROJ, function (status) {
        return DP.api.update('projects', { id: 'eq.' + p.id }, { status: status });
      });
    });
  }

  /* ---------- Ponts (mises en relation) ---------- */
  async function renderPonts(el, ctx) {
    var st = (ctx.query && ctx.query.get('statut')) || '';
    var params = { select: '*', order: 'created_at.desc', limit: 500 };
    if (st) params.status = 'eq.' + st;
    var rows = await DP.api.get('connection_requests', params);
    var projects = byId(await DP.api.get('projects', { select: 'id,title,beneficiary_id,amount,currency', id: inq(rows.map(function (c) { return c.project_id; })) || 'is.null' }));
    var bens = await beneficiariesFor(Object.keys(projects).map(function (k) { return projects[k].beneficiary_id; }));
    var partners = byId(await DP.api.get('partners', { select: 'id,legal_name,category', id: inq(rows.map(function (c) { return c.partner_id; })) || 'is.null' }));
    var map = byId(rows);
    el.innerHTML = ui.header('Ponts — mises en relation', 'Étape 1 : vous validez la demande. Ensuite le bénéficiaire donne son consentement, puis le partenaire étudie le dossier. Le partenaire garde la décision finale.') +
      ui.card(null, filterBar('#/admin/ponts', [{ name: 'statut', label: 'Statut', value: st, options: [['', 'Tous']].concat(Object.keys(DP.labels.status).filter(function (k) {
        return ['requested', 'refused_admin', 'approved_admin', 'consent_given', 'transmitted', 'under_study', 'complement_requested', 'accepted', 'refused', 'closed', 'cancelled'].indexOf(k) !== -1;
      }).map(function (k) { return [k, DP.labels.status[k]]; })) }]) +
        ui.table([
          { label: 'Projet', render: function (c) { var p = projects[c.project_id]; return '<strong>' + esc(p ? p.title : '—') + '</strong><div class="small muted">' + esc(p ? ui.money(p.amount, p.currency) : '') + '</div>'; } },
          { label: 'Bénéficiaire', render: function (c) { var p = projects[c.project_id]; var b = p ? bens[p.beneficiary_id] : null; return esc(bcode(b)); } },
          { label: 'Partenaire', render: function (c) { var x = partners[c.partner_id]; return esc(x ? x.legal_name : '—') + (x ? '<div class="small muted">' + esc(DP.labels.partnerCategory[x.category] || '') + '</div>' : ''); } },
          { label: 'Motif', render: function (c) { return esc(short(c.motive, 120)); } },
          { label: 'Statut', render: function (c) { return ui.badge(c.status) + (c.admin_reason ? '<div class="small muted">' + esc(short(c.admin_reason, 80)) + '</div>' : ''); } },
          { label: 'Demandé le', render: function (c) { return ui.dateTime(c.created_at); } },
          { label: 'Action', cls: 'actions', render: function (c) {
            if (c.status !== 'requested') return '<span class="small muted">' + (CONN_ACTIVE.indexOf(c.status) !== -1 ? 'En cours' : '—') + '</span>';
            return '<button class="btn btn-sm btn-primary" type="button" data-approve="' + esc(c.id) + '">Valider</button> ' +
              '<button class="btn btn-sm btn-outline" type="button" data-refuse="' + esc(c.id) + '">Refuser</button>';
          } }
        ], rows, 'Aucune demande de mise en relation pour le moment.'));
    bindFilters(el);
    act(el, '[data-approve]', async function (b) {
      if (!(await ui.confirm('Valider cette demande ? Le bénéficiaire sera invité à donner son consentement avant tout partage de pièces.', 'Valider'))) return;
      await DP.api.rpc('admin_review_connection', { p_connection: b.dataset.approve, p_approve: true, p_reason: null });
      ui.toast('Demande validée.', 'ok');
      refresh();
    });
    act(el, '[data-refuse]', function (b) {
      reasonModal('Refuser la demande', 'Motif du refus (obligatoire, visible par le partenaire)', 'Refuser', function (reason) {
        return DP.api.rpc('admin_review_connection', { p_connection: b.dataset.refuse, p_approve: false, p_reason: reason });
      });
    });
  }

  /* ---------- Résultats déclarés ---------- */
  async function renderResults(el) {
    var rows = await DP.api.get('funding_outcomes', { select: '*', order: 'declared_at.desc', limit: 500 });
    var conns = byId(await DP.api.get('connection_requests', { select: 'id,project_id,partner_id', id: inq(rows.map(function (o) { return o.connection_id; })) || 'is.null' }));
    var projects = byId(await DP.api.get('projects', { select: 'id,title', id: inq(Object.keys(conns).map(function (k) { return conns[k].project_id; })) || 'is.null' }));
    var partners = byId(await DP.api.get('partners', { select: 'id,legal_name', id: inq(Object.keys(conns).map(function (k) { return conns[k].partner_id; })) || 'is.null' }));
    var comm = {};
    (await DP.api.get('commission_entries', { select: '*', outcome_id: inq(rows.map(function (o) { return o.id; })) || 'is.null' })).forEach(function (c) { comm[c.outcome_id] = c; });
    var map = byId(rows);
    el.innerHTML = ui.header('Résultats déclarés', 'Valider un résultat crée une simulation de commission. Aucune créance n’est exigible : le déclenchement, le payeur et la base de calcul restent à contractualiser.') +
      ui.card(null, ui.table([
        { label: 'Résultat', render: function (o) { return '<strong>' + esc(RESULT_LABEL[o.result_type] || o.result_type) + '</strong><div class="small muted">' + ui.date(o.outcome_date) + '</div>'; } },
        { label: 'Montant', cls: 'num', render: function (o) { return o.amount ? ui.money(o.amount, o.currency) : '—'; } },
        { label: 'Projet', render: function (o) { var c = conns[o.connection_id]; return esc(c && projects[c.project_id] ? projects[c.project_id].title : '—'); } },
        { label: 'Partenaire', render: function (o) { var c = conns[o.connection_id]; return esc(c && partners[c.partner_id] ? partners[c.partner_id].legal_name : '—'); } },
        { label: 'Preuve', render: function (o) { return esc(o.proof_ref || '—'); } },
        { label: 'Validé', render: function (o) { return o.validated ? ui.badge('validated') : ui.badge('pending'); } },
        { label: 'Commission simulée', render: function (o) {
          var c = comm[o.id];
          if (!c) return '<span class="muted">—</span>';
          return ui.money(c.amount_total, c.currency) + '<div class="small muted">DarajaPlus ' + ui.money(c.amount_darajaplus, c.currency) + ' · Hôte ' + ui.money(c.amount_host, c.currency) + ' · Agent ' + ui.money(c.amount_agent, c.currency) + '</div>';
        } },
        { label: 'Action', cls: 'actions', render: function (o) {
          return o.validated
            ? '<button class="btn btn-sm btn-outline" type="button" data-validate="' + esc(o.id) + '" data-value="false">Annuler</button>'
            : '<button class="btn btn-sm btn-primary" type="button" data-validate="' + esc(o.id) + '" data-value="true">Valider</button>';
        } }
      ], rows, 'Aucun résultat déclaré pour le moment.'));
    act(el, '[data-validate]', async function (b) {
      var o = map[b.dataset.validate];
      var value = b.dataset.value === 'true';
      if (value && !(await ui.confirm('Valider ce résultat ? Une simulation de commission sera créée (non exigible).', 'Valider'))) return;
      await DP.api.rpc('admin_validate_outcome', { p_outcome: o.id, p_validate: value });
      ui.toast(value ? 'Résultat validé.' : 'Validation annulée.', 'ok');
      refresh();
    });
  }

  /* ---------- Offres ---------- */
  async function renderOffers(el, ctx) {
    var st = (ctx.query && ctx.query.get('statut')) || '';
    var params = { select: '*', order: 'created_at.desc', limit: 500 };
    if (st) params.status = 'eq.' + st;
    var rows = await DP.api.get('offers', params);
    var partners = byId(await DP.api.get('partners', { select: 'id,legal_name', id: inq(rows.map(function (o) { return o.partner_id; })) || 'is.null' }));
    var authors = await profilesFor(rows.filter(function (o) { return o.author_kind === 'agent'; }).map(function (o) { return o.author_id; }));
    var map = byId(rows);
    el.innerHTML = ui.header('Offres et opportunités', 'Programmes, appels à projets, offres de financement. Les publications des Agents au-delà du quota mensuel passent en attente de paiement.') +
      ui.card(null, filterBar('#/admin/offres', [{ name: 'statut', label: 'Statut', value: st, options: [['', 'Tous']].concat(STATUS_OFFER) }]) +
        ui.table([
          { label: 'Titre', render: function (o) { return '<strong>' + esc(o.title) + '</strong><div class="small muted">' + esc(short(o.description, 80)) + '</div>'; } },
          { label: 'Publié par', render: function (o) {
            if (o.author_kind === 'partner') return esc(partners[o.partner_id] ? partners[o.partner_id].legal_name : 'Partenaire');
            return 'Agent ' + esc(authors[o.author_id] ? authors[o.author_id].code || '' : '');
          } },
          { label: 'Type', render: function (o) { return esc(OFFER_TYPE_LABEL[o.offer_type] || o.offer_type || '—'); } },
          { label: 'Cible', render: function (o) { return o.target_category === 'all' || !o.target_category ? 'Toutes' : ui.categoryBadge(o.target_category); } },
          { label: 'Montant', cls: 'num', render: function (o) { return o.amount_min || o.amount_max ? ui.money(o.amount_min, o.currency) + ' à ' + ui.money(o.amount_max, o.currency) : '—'; } },
          { label: 'Échéance', render: function (o) { return ui.date(o.deadline); } },
          { label: 'Statut', render: function (o) { return ui.badge(o.status); } },
          { label: 'Action', cls: 'actions', render: function (o) { return '<button class="btn btn-sm btn-outline" type="button" data-status="' + esc(o.id) + '">Statut</button>'; } }
        ], rows, 'Aucune offre ne correspond à ces filtres.'));
    bindFilters(el);
    act(el, '[data-status]', function (b) {
      var o = map[b.dataset.status];
      statusModal('Statut de l’offre', o.status, STATUS_OFFER, function (status) {
        return DP.api.update('offers', { id: 'eq.' + o.id }, { status: status });
      });
    });
  }

  /* ---------- Carrefours ---------- */
  async function renderCarrefours(el) {
    var r = await Promise.all([
      DP.api.get('carrefours', { select: '*', order: 'created_at.desc' }),
      DP.api.get('zones', { select: '*' }),
      DP.api.get('carrefour_members', { select: 'carrefour_id,status' })
    ]);
    var rows = r[0], zones = byId(r[1]), members = r[2];
    var orgs = await profilesFor(rows.map(function (c) { return c.organizer_id; }));
    var map = byId(rows);
    el.innerHTML = ui.header('Carrefours', 'Mécanisme de contribution mutuelle. DarajaPlus n’encaisse ni ne distribue les fonds ; les règles de cotisation, de rotation et de sortie restent à définir avant lancement.') +
      ui.alert('warn', '<strong>À définir avant lancement :</strong> règles de cotisation, rotation, retards, sorties et sécurisation des fonds.') +
      ui.card(null, ui.table([
        { label: 'Carrefour', render: function (c) { return '<strong>' + esc(c.name) + '</strong><div class="small muted">' + esc(short(c.objective, 70)) + '</div>'; } },
        { label: 'Organisateur', render: function (c) { return esc(pname(orgs[c.organizer_id])); } },
        { label: 'Zone', render: function (c) { return esc(zones[c.zone_id] ? zones[c.zone_id].name : '—'); } },
        { label: 'Cotisation', cls: 'num', render: function (c) { return ui.money(c.contribution_amount, c.currency) + '<div class="small muted">' + esc(c.frequency) + '</div>'; } },
        { label: 'Membres', cls: 'num', render: function (c) {
          var acc = members.filter(function (m) { return m.carrefour_id === c.id && m.status === 'accepted'; }).length;
          return acc + ' / ' + c.max_members;
        } },
        { label: 'Statut', render: function (c) { return ui.badge(c.status); } },
        { label: 'Action', cls: 'actions', render: function (c) {
          return '<button class="btn btn-sm btn-outline" type="button" data-members="' + esc(c.id) + '">Membres</button> ' +
            '<button class="btn btn-sm btn-outline" type="button" data-status="' + esc(c.id) + '">Statut</button>';
        } }
      ], rows, 'Aucun Carrefour créé pour le moment.'));
    act(el, '[data-status]', function (b) {
      var c = map[b.dataset.status];
      statusModal('Statut du Carrefour', c.status, STATUS_CARREFOUR, function (status) {
        return DP.api.update('carrefours', { id: 'eq.' + c.id }, { status: status });
      });
    });
    act(el, '[data-members]', async function (b) {
      var c = map[b.dataset.members];
      var list = await DP.api.get('carrefour_members', { select: '*', carrefour_id: 'eq.' + c.id, order: 'requested_at.asc' });
      var bens = await beneficiariesFor(list.map(function (m) { return m.beneficiary_id; }));
      var body = list.length ? ui.table([
        { label: 'Bénéficiaire', render: function (m) { var x = bens[m.beneficiary_id]; return esc(x ? bcode(x) + ' — ' + benName(x, null) : '—'); } },
        { label: 'Statut', render: function (m) { return ui.badge(m.status); } },
        { label: 'Action', cls: 'actions', render: function (m) {
          if (m.status === 'accepted' || m.status === 'refused') return '—';
          return '<button class="btn btn-sm btn-primary" type="button" data-accept="' + esc(m.beneficiary_id) + '">Accepter</button> ' +
            '<button class="btn btn-sm btn-outline" type="button" data-refuse-m="' + esc(m.beneficiary_id) + '">Refuser</button>';
        } }
      ], list) : ui.empty('Aucune demande d’adhésion.');
      var mm = ui.modal('Membres — ' + c.name, body + '<p class="small muted">Règles : ' + esc(c.rules || 'à définir') + '</p>', '');
      var setMember = function (benId, status) {
        return DP.api.update('carrefour_members', { carrefour_id: 'eq.' + c.id, beneficiary_id: 'eq.' + benId },
          { status: status, decided_at: new Date().toISOString(), decided_by: DP.api.uid });
      };
      act(mm.el, '[data-accept]', async function (x) {
        await setMember(x.dataset.accept, 'accepted');
        mm.close(); ui.toast('Adhésion acceptée.', 'ok'); refresh();
      });
      act(mm.el, '[data-refuse-m]', async function (x) {
        await setMember(x.dataset.refuseM, 'refused');
        mm.close(); ui.toast('Adhésion refusée.', 'ok'); refresh();
      });
    });
  }

  /* ---------- Annonces ---------- */
  async function renderAnnouncements(el) {
    var r = await Promise.all([
      DP.api.get('announcements', { select: '*', order: 'created_at.desc', limit: 200 }),
      DP.api.get('zones', { select: '*', order: 'id.asc' }),
      DP.api.get('profiles', { select: 'id,code,prenom,nom,email', role: 'eq.agent', status: 'eq.active', order: 'code.asc' })
    ]);
    var rows = r[0], zones = r[1], agents = r[2];
    var zmap = byId(zones);
    el.innerHTML = ui.header('Annonces', 'Messages diffusés à toute la plateforme, à une zone ou aux bénéficiaires d’un Agent.') +
      '<div class="grid-2">' +
      ui.card('Nouvelle annonce', '<form class="form" id="f-ann">' +
        ui.field({ name: 'title', label: 'Titre', required: true, full: true }) +
        ui.field({ name: 'body', label: 'Message', type: 'textarea', rows: 4, required: true, full: true }) +
        ui.field({ name: 'audience', label: 'Destinataires', type: 'select', required: true, options: [['all', 'Toute la plateforme'], ['zone', 'Une zone'], ['agent_beneficiaries', 'Les bénéficiaires d’un Agent']] }) +
        ui.field({ name: 'zone_id', label: 'Zone (si « Une zone »)', type: 'select', placeholder: 'Choisir', dataType: 'nullable', options: zones.map(function (z) { return [z.id, z.name]; }) }) +
        ui.field({ name: 'agent_id', label: 'Agent (si « Bénéficiaires d’un Agent »)', type: 'select', placeholder: 'Choisir', dataType: 'nullable', options: agents.map(function (a) { return [a.id, (a.code || '') + ' — ' + pname(a)]; }) }) +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Publier</button></div></form>') +
      ui.card('Annonces publiées', ui.table([
        { label: 'Annonce', render: function (a) { return '<strong>' + esc(a.title) + '</strong><div class="small muted">' + esc(short(a.body, 100)) + '</div>'; } },
        { label: 'Destinataires', render: function (a) {
          if (a.audience === 'zone') return 'Zone ' + esc(zmap[a.zone_id] ? zmap[a.zone_id].name : '');
          if (a.audience === 'agent_beneficiaries') return 'Bénéficiaires d’un Agent';
          return 'Toute la plateforme';
        } },
        { label: 'Date', render: function (a) { return ui.date(a.created_at); } },
        { label: 'Statut', render: function (a) { return ui.badge(a.status === 'visible' ? 'published' : 'hidden'); } },
        { label: 'Action', cls: 'actions', render: function (a) {
          return '<button class="btn btn-sm btn-outline" type="button" data-toggle="' + esc(a.id) + '" data-to="' + (a.status === 'visible' ? 'hidden' : 'visible') + '">' +
            (a.status === 'visible' ? 'Masquer' : 'Afficher') + '</button>';
        } }
      ], rows, 'Aucune annonce pour le moment.')) + '</div>';

    ui.bindForm(el.querySelector('#f-ann'), async function (d) {
      if (d.audience === 'zone' && !d.zone_id) throw new Error('Choisissez la zone destinataire.');
      if (d.audience === 'agent_beneficiaries' && !d.agent_id) throw new Error('Choisissez l’Agent destinataire.');
      await DP.api.insert('announcements', {
        author_id: DP.api.uid, audience: d.audience, title: d.title, body: d.body, status: 'visible',
        zone_id: d.audience === 'zone' ? Number(d.zone_id) : null,
        agent_id: d.audience === 'agent_beneficiaries' ? d.agent_id : null
      });
      refresh();
      return 'Annonce publiée.';
    });
    act(el, '[data-toggle]', async function (b) {
      await DP.api.update('announcements', { id: 'eq.' + b.dataset.toggle }, { status: b.dataset.to });
      ui.toast('Annonce mise à jour.', 'ok');
      refresh();
    });
  }

  /* ---------- Finances et visibilité ---------- */
  async function renderFinances(el) {
    var r = await Promise.all([
      DP.api.get('visibility_orders', { select: '*', order: 'created_at.desc', limit: 300 }),
      DP.api.get('payments', { select: '*', order: 'created_at.desc', limit: 300 }),
      DP.api.get('commission_entries', { select: '*', order: 'created_at.desc', limit: 300 }),
      DP.api.get('settings', { select: 'value', key: 'eq.payments_enabled' })
    ]);
    var orders = r[0], payments = r[1], commissions = r[2];
    var paymentsOn = r[3][0] ? r[3][0].value === true : false;
    var pay = {};
    payments.forEach(function (p) { pay[p.order_id] = p; });
    var owners = await profilesFor(orders.map(function (o) { return o.owner_id; }));
    var bens = await beneficiariesFor(orders.map(function (o) { return o.beneficiary_id; }));
    var sumFc = commissions.filter(function (c) { return c.currency === 'FC'; }).reduce(function (s, c) { return s + Number(c.amount_total || 0); }, 0);
    var sumUsd = commissions.filter(function (c) { return c.currency === 'USD'; }).reduce(function (s, c) { return s + Number(c.amount_total || 0); }, 0);
    var map = byId(orders);

    el.innerHTML = ui.header('Finances et visibilité', 'Commandes de visibilité, paiements et commissions simulées.',
        '<button class="btn btn-outline" type="button" data-refresh-vis>Mettre à jour les visibilités</button>') +
      ui.alert(paymentsOn ? 'ok' : 'warn', paymentsOn
        ? 'Les paiements en ligne sont activés.'
        : '<strong>Paiements désactivés.</strong> Les commandes sont enregistrées, mais aucun paiement n’est collecté par la plateforme. Une confirmation manuelle reste possible après réception réelle des fonds.') +
      ui.card('Commandes de visibilité', ui.table([
        { label: 'Titulaire', render: function (o) {
          var who = o.beneficiary_id && bens[o.beneficiary_id] ? bcode(bens[o.beneficiary_id]) + ' — ' + bname(bens[o.beneficiary_id]) : pname(owners[o.owner_id]);
          return esc(who) + '<div class="small muted">' + esc(o.category === 'agent' ? 'Agent' : 'Catégorie ' + o.category) + '</div>';
        } },
        { label: 'Durée', render: function (o) { return o.days + ' j' + '<div class="small muted">' + ui.date(o.starts_on) + ' → ' + ui.date(o.ends_on) + '</div>'; } },
        { label: 'Montant', cls: 'num', render: function (o) { return ui.money(o.amount_fc, 'FC'); } },
        { label: 'Statut', render: function (o) { return ui.badge(o.status) + '<div class="small muted">' + esc(STATUS_VIS[o.status] || '') + '</div>'; } },
        { label: 'Paiement', render: function (o) { var p = pay[o.id]; return p ? esc(p.status) + (p.reference ? '<div class="small muted">Réf. ' + esc(p.reference) + '</div>' : '') : '—'; } },
        { label: 'Action', cls: 'actions', render: function (o) {
          var p = pay[o.id];
          if (!p || p.status !== 'en_attente') return '—';
          return '<button class="btn btn-sm btn-outline" type="button" data-confirm="' + esc(p.id) + '">Confirmer la réception</button>';
        } }
      ], orders, 'Aucune commande de visibilité pour le moment.')) +
      ui.card('Commissions simulées', ui.stats([
        ['Total simulé (FC)', ui.money(sumFc, 'FC'), 'Simulation'],
        ['Total simulé (USD)', ui.money(sumUsd, 'USD'), 'Simulation']
      ]) + ui.table([
        { label: 'Base', cls: 'num', render: function (c) { return ui.money(c.base_amount, c.currency); } },
        { label: 'Taux total', cls: 'num', render: function (c) { return pct(c.rate_total); } },
        { label: 'Commission', cls: 'num', render: function (c) { return ui.money(c.amount_total, c.currency); } },
        { label: 'DarajaPlus (7 %)', cls: 'num', render: function (c) { return ui.money(c.amount_darajaplus, c.currency); } },
        { label: 'Hôte (3 %)', cls: 'num', render: function (c) { return ui.money(c.amount_host, c.currency); } },
        { label: 'Statut', render: function (c) { return ui.badge('pending') + '<div class="small muted">Simulée, non exigible</div>'; } }
      ], commissions, 'Aucune commission simulée.') +
      '<p class="small muted">Payeur, moment d’exigibilité et base de calcul définitive : à contractualiser avant toute facturation.</p>');

    act(el, '[data-refresh-vis]', async function () {
      var n = await DP.api.rpc('refresh_visibility', {});
      ui.toast(n + ' visibilité(s) mise(s) à jour.', 'ok');
      refresh();
    });
    act(el, '[data-confirm]', function (b) {
      var m = ui.modal('Confirmer la réception', '<form class="form" id="cp">' +
        ui.field({ name: 'reference', label: 'Référence du versement (obligatoire)', required: true, full: true, hint: 'Confirmez seulement après réception réelle des fonds.' }) +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Confirmer</button></div></form>');
      ui.bindForm(m.el.querySelector('#cp'), async function (d) {
        if (!d.reference) throw new Error('La référence est obligatoire.');
        await DP.api.rpc('admin_confirm_payment', { p_payment: b.dataset.confirm, p_reference: d.reference });
        m.close();
        refresh();
        return 'Paiement confirmé.';
      }, null);
    });
  }

  /* ---------- Messages ---------- */
  async function renderMessages(el) {
    var msgs = await DP.api.get('messages', { select: 'thread_user_id,from_admin,read_by_admin,body,created_at', order: 'created_at.desc', limit: 1000 });
    var threads = {};
    msgs.forEach(function (m) {
      var t = threads[m.thread_user_id] || (threads[m.thread_user_id] = { id: m.thread_user_id, last: m, unread: 0 });
      if (!m.from_admin && !m.read_by_admin) t.unread++;
    });
    var list = Object.keys(threads).map(function (k) { return threads[k]; });
    var people = await profilesFor(list.map(function (t) { return t.id; }));
    list.sort(function (a, b) { return a.last.created_at < b.last.created_at ? 1 : -1; });
    el.innerHTML = ui.header('Messages privés', 'Échanges privés entre l’Administrateur général et chaque utilisateur. Aucun message direct entre comptes.') +
      ui.card(null, ui.table([
        { label: 'Utilisateur', render: function (t) {
          var p = people[t.id];
          return '<strong>' + esc(pname(p)) + '</strong>' + (t.unread ? ' <span class="count">' + t.unread + '</span>' : '') +
            '<div class="small muted">' + esc(p ? DP.labels.role[p.role] : '') + '</div>';
        } },
        { label: 'Dernier message', render: function (t) { return esc(short(t.last.body, 100)) + '<div class="small muted">' + ui.dateTime(t.last.created_at) + '</div>'; } },
        { label: 'Action', cls: 'actions', render: function (t) { return '<a class="btn btn-sm btn-outline" href="#/admin/messages/' + esc(t.id) + '">Ouvrir</a>'; } }
      ], list, 'Aucun message pour le moment.'));
  }

  async function renderThread(el, ctx) {
    var uid = ctx.params.uid;
    var p = (await DP.api.get('profiles', { select: '*', id: 'eq.' + uid }))[0];
    if (!p) throw new Error('Utilisateur introuvable.');
    var head = ui.header('Échanges avec ' + pname(p), DP.labels.role[p.role] + (p.code ? ' · ' + p.code : '') + (p.email ? ' · ' + p.email : ''),
      '<a class="btn btn-outline" href="#/admin/messages">← Messages</a>');
    await DP.messages.thread(el, uid, { title: pname(p), header: head });
  }

  /* ---------- Contacts ---------- */
  async function renderContacts(el) {
    var rows = await DP.api.get('contact_requests', { select: '*', order: 'created_at.desc', limit: 300 });
    var map = byId(rows);
    el.innerHTML = ui.header('Demandes de contact', 'Messages reçus depuis le site public.') +
      ui.card(null, ui.table([
        { label: 'Reçu le', render: function (c) { return ui.dateTime(c.created_at); } },
        { label: 'Personne', render: function (c) {
          var contact = (c.email ? '<a href="mailto:' + esc(c.email) + '?subject=' + encodeURIComponent('Re : ' + (c.subject || 'DarajaPlus')) + '">' + esc(c.email) + '</a>' : '') +
            (c.phone ? (c.email ? ' · ' : '') + '<a href="tel:' + esc(c.phone) + '">' + esc(c.phone) + '</a>' : '');
          return '<strong>' + esc(c.name) + '</strong><div class="small">' + (contact || '<span class="muted">Pas de coordonnées</span>') + '</div>';
        } },
        { label: 'Sujet', render: function (c) { return esc(c.subject); } },
        { label: 'Message', render: function (c) { return '<div class="pre-wrap">' + esc(c.message) + '</div>'; } },
        { label: 'Statut', render: function (c) { return c.status === 'new' ? ui.badge('pending') : ui.badge('validated'); } },
        { label: 'Action', cls: 'actions', render: function (c) {
          return c.status === 'new' ? '<button class="btn btn-sm btn-outline" type="button" data-handled="' + esc(c.id) + '">Marquer traité</button>' : '—';
        } }
      ], rows, 'Aucune demande de contact pour le moment.'));
    act(el, '[data-handled]', async function (b) {
      await DP.api.update('contact_requests', { id: 'eq.' + b.dataset.handled }, { status: 'handled' });
      ui.toast('Demande marquée comme traitée.', 'ok');
      refresh();
    });
  }

  /* ---------- Territoires ---------- */
  async function renderTerritories(el) {
    var r = await Promise.all([
      DP.api.get('zones', { select: '*', order: 'id.asc' }),
      DP.api.get('quartiers', { select: '*', order: 'zone_id.asc,id.asc' }),
      DP.api.get('profiles', { select: 'id,role,status,zone_id,prenom,nom,email,code', role: 'eq.host' }),
      DP.api.get('profiles', { select: 'id,zone_id,status', role: 'eq.agent' }),
      DP.api.get('beneficiaries', { select: 'id,quartier_id,host_id,status', status: 'neq.archived' })
    ]);
    var zones = r[0], quartiers = r[1], hosts = r[2], agents = r[3], bens = r[4];
    var rows = zones.map(function (z) {
      var h = hosts.find(function (x) { return x.zone_id === z.id && x.status !== 'rejected'; });
      return {
        zone: z, host: h,
        agents: agents.filter(function (a) { return a.zone_id === z.id; }).length,
        benefs: bens.filter(function (b) { return b.host_id && h && b.host_id === h.id; }).length,
        quartiers: quartiers.filter(function (q) { return q.zone_id === z.id; })
      };
    });
    el.innerHTML = ui.header('Territoires', 'Cité d’entreprise : 5 zones, 10 quartiers par zone, 100 établissements par quartier.') +
      ui.alert('warn', '<strong>À finaliser :</strong> répartition des 26 provinces de la RDC entre les cinq Hôtes.') +
      ui.card(null, ui.table([
        { label: 'Zone', render: function (r) { return '<strong>' + esc(r.zone.name) + '</strong>'; } },
        { label: 'Hôte', render: function (r) { return r.host ? esc(pname(r.host)) + ' <span class="badge badge-muted">' + esc(DP.labels.status[r.host.status] || '') + '</span>' : '<span class="muted">Aucun</span>'; } },
        { label: 'Agents', cls: 'num', render: function (r) { return r.agents + ' / 50 (total)'; } },
        { label: 'Bénéficiaires', cls: 'num', render: function (r) { return r.benefs; } },
        { label: 'Quartiers', render: function (r) { return esc(r.quartiers.map(function (q) { return q.name; }).join(', ') || '—'); } }
      ], rows, 'Aucune zone.'));
  }

  /* ---------- Audit ---------- */
  async function renderAudit(el) {
    var rows = await DP.api.get('audit_logs', { select: '*', order: 'created_at.desc', limit: 200 });
    el.innerHTML = ui.header('Journal d’audit', 'Trace des créations, modifications et validations importantes (200 dernières entrées).') +
      ui.card(null, ui.table([
        { label: 'Date', render: function (a) { return ui.dateTime(a.created_at); } },
        { label: 'Acteur', render: function (a) { return esc(a.actor_role || '—'); } },
        { label: 'Action', render: function (a) { return '<strong>' + esc(a.action) + '</strong><div class="small muted">' + esc(a.table_name) + '</div>'; } },
        { label: 'Objet', render: function (a) { return '<span class="small">' + esc(a.object_id || '—') + '</span>'; } },
        { label: 'Motif', render: function (a) { return esc(a.reason || '—'); } },
        { label: 'Détail', render: function (a) {
          if (!a.after_data && !a.before_data) return '—';
          return '<details><summary>Voir</summary><pre class="small">' + esc(JSON.stringify({ avant: a.before_data, après: a.after_data }, null, 2)) + '</pre></details>';
        } }
      ], rows, 'Aucune entrée d’audit.'));
  }

  /* ---------- Configuration ---------- */
  async function renderConfig(el) {
    var rows = await DP.api.get('settings', { select: '*', order: 'key.asc' });
    var S = {};
    rows.forEach(function (r) { S[r.key] = r.value; });
    var vr = S.visibility_rate_fc_per_day || {};
    var cm = S.commission_rates || {};
    var caps = S.caps || {};
    el.innerHTML = ui.header('Configuration', 'Paramètres de la plateforme. Chaque changement est enregistré dans le journal d’audit.') +
      '<div class="grid-2">' +
      ui.card('Change et publications', '<form class="form" id="f-fx" data-reset="false">' +
        ui.field({ name: 'fx', label: 'Taux de change (FC pour 1 USD)', type: 'number', dataType: 'number', step: 'any', min: 1, required: true, value: S.exchange_rate_fc_per_usd }) +
        ui.field({ name: 'free', label: 'Publications gratuites par Agent et par mois', type: 'number', dataType: 'number', min: 0, required: true, value: S.agent_free_offers_per_month }) +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer</button></div></form>') +
      ui.card('Tarifs de visibilité (FC par jour)', '<form class="form" id="f-vis" data-reset="false">' +
        ui.field({ name: 'ba', label: 'Ba — Alpha', type: 'number', dataType: 'number', step: 'any', min: 0, required: true, value: vr.ba }) +
        ui.field({ name: 'bb', label: 'Bb — Bêta', type: 'number', dataType: 'number', step: 'any', min: 0, required: true, value: vr.bb }) +
        ui.field({ name: 'bg', label: 'Bg — Gamma', type: 'number', dataType: 'number', step: 'any', min: 0, required: true, value: vr.bg }) +
        ui.field({ name: 'agent', label: 'Agent', type: 'number', dataType: 'number', step: 'any', min: 0, required: true, value: vr.agent, hint: 'Tarifs non définitifs tant qu’ils ne sont pas validés.' }) +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer</button></div></form>') +
      ui.card('Fonctionnalités', '<form class="form" id="f-feat" data-reset="false">' +
        ui.field({ name: 'carrefour_enabled', label: 'Espace Carrefours ouvert', type: 'checkbox', value: S.carrefour_enabled === true }) +
        ui.field({ name: 'payments_enabled', label: 'Paiements en ligne activés', type: 'checkbox', value: S.payments_enabled === true, hint: 'À laisser désactivé tant que le cadre juridique et le prestataire de paiement ne sont pas validés.' }) +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer</button></div></form>') +
      ui.card('Décisions de référence (lecture seule)', '<dl class="kv">' +
        '<dt>Commission totale</dt><dd>' + pct(cm.total) + ' (DarajaPlus ' + pct(cm.darajaplus) + ' · Hôte ' + pct(cm.host) + ' · Agent ' + pct(cm.agent) + ')</dd>' +
        '<dt>Capacité Hôtes</dt><dd>' + esc(caps.hosts) + ' · Agents par Hôte : ' + esc(caps.agents_per_host) + '</dd>' +
        '<dt>Par Agent</dt><dd>Bg ' + esc(caps.bg_per_agent) + ' · Bb ' + esc(caps.bb_per_agent) + ' · Ba ' + esc(caps.ba_per_agent) + '</dd>' +
        '<dt>Parrainage</dt><dd>1 Bg → ' + esc(caps.bb_per_bg) + ' Bb ; 1 Bb → ' + esc(caps.ba_per_bb) + ' Ba</dd>' +
        '<dt>Partenaires</dt><dd>' + esc(caps.partners) + ' maximum</dd></dl>' +
        '<p class="small muted">Ces valeurs découlent du cahier des charges. Toute modification demande une décision formelle préalable.</p>') +
      '</div>';

    ui.bindForm(el.querySelector('#f-fx'), async function (d) {
      await DP.api.update('settings', { key: 'eq.exchange_rate_fc_per_usd' }, { value: d.fx });
      await DP.api.update('settings', { key: 'eq.agent_free_offers_per_month' }, { value: d.free });
      return 'Paramètres enregistrés.';
    });
    ui.bindForm(el.querySelector('#f-vis'), async function (d) {
      await DP.api.update('settings', { key: 'eq.visibility_rate_fc_per_day' }, { value: { ba: d.ba, bb: d.bb, bg: d.bg, agent: d.agent } });
      return 'Tarifs enregistrés.';
    });
    ui.bindForm(el.querySelector('#f-feat'), async function (d) {
      await DP.api.update('settings', { key: 'eq.carrefour_enabled' }, { value: d.carrefour_enabled });
      await DP.api.update('settings', { key: 'eq.payments_enabled' }, { value: d.payments_enabled });
      return 'Fonctionnalités enregistrées.';
    });
  }

  /* ---------- Routes ---------- */
  DP.register([
    { path: '/admin', roles: ROLE, title: 'Vue générale', render: renderOverview },
    { path: '/admin/comptes', roles: ROLE, title: 'Comptes à valider', render: renderAccounts },
    { path: '/admin/hotes', roles: ROLE, title: 'Hôtes et zones', render: renderHosts },
    { path: '/admin/agents', roles: ROLE, title: 'Agents', render: renderAgents },
    { path: '/admin/beneficiaires', roles: ROLE, title: 'Bénéficiaires', render: renderBeneficiaries },
    { path: '/admin/partenaires', roles: ROLE, title: 'Partenaires', render: renderPartners },
    { path: '/admin/projets', roles: ROLE, title: 'Projets et besoins', render: renderProjects },
    { path: '/admin/ponts', roles: ROLE, title: 'Ponts — mises en relation', render: renderPonts },
    { path: '/admin/resultats', roles: ROLE, title: 'Résultats déclarés', render: renderResults },
    { path: '/admin/offres', roles: ROLE, title: 'Offres et opportunités', render: renderOffers },
    { path: '/admin/carrefours', roles: ROLE, title: 'Carrefours', render: renderCarrefours },
    { path: '/admin/annonces', roles: ROLE, title: 'Annonces', render: renderAnnouncements },
    { path: '/admin/finances', roles: ROLE, title: 'Finances et visibilité', render: renderFinances },
    { path: '/admin/messages', roles: ROLE, title: 'Messages privés', render: renderMessages },
    { path: '/admin/messages/:uid', roles: ROLE, title: 'Messages privés', render: renderThread },
    { path: '/admin/contacts', roles: ROLE, title: 'Demandes de contact', render: renderContacts },
    { path: '/admin/territoires', roles: ROLE, title: 'Territoires', render: renderTerritories },
    { path: '/admin/audit', roles: ROLE, title: 'Journal d’audit', render: renderAudit },
    { path: '/admin/configuration', roles: ROLE, title: 'Configuration', render: renderConfig }
  ]);
})();
