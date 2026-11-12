/* Espace bénéficiaire (Ba, Bb, Bg) : accueil et choix de catégorie, profil, photo et identifiant, entreprises,
   projets et besoins, dossiers et consentements, opportunités, Carrefours et visibilité.
   Principe : le bénéficiaire ne partage jamais une pièce sans son consentement explicite ; le serveur fait foi. */
(function () {
  var DP = window.DP;
  var esc = DP.ui.esc;
  var ui = DP.ui;
  var ROLE = ['beneficiary'];

  var DOC_TYPES = [['identite', 'Pièce d’identité'], ['justificatif_activite', 'Justificatif d’activité'], ['plan_financement', 'Plan de financement'], ['autre', 'Autre document']];
  var CONN_HELP = {
    requested: 'Demande transmise à l’Administrateur, qui la vérifie avant toute suite.',
    approved_admin: 'Validée par l’Administrateur. Votre consentement est nécessaire avant tout partage de pièces.',
    refused_admin: 'Non retenue par l’Administrateur.',
    consent_given: 'Consentement donné. Aucune pièce n’a été partagée pour le moment.',
    transmitted: 'Les pièces que vous avez autorisées sont transmises au partenaire, pour la durée choisie.',
    under_study: 'Le partenaire étudie votre dossier. Il garde seul la décision finale.',
    complement_requested: 'Le partenaire demande un complément. Répondez via la messagerie privée.',
    accepted: 'Décision positive du partenaire. Votre Hôte assure le suivi jusqu’à la conclusion.',
    refused: 'Le partenaire ne donne pas suite à ce stade.',
    closed: 'Dossier clôturé.',
    cancelled: 'Demande annulée.'
  };
  var STATUS_PROJ_BEN = [['draft', 'Brouillon']];
  var CONSENT_DAYS_MAX = 90;
  var DOC_MAX = 10 * 1024 * 1024;
  var IMAGE_MAX = 3 * 1024 * 1024;
  var IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp';

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
  function options(list, value, placeholder) {
    return (placeholder !== undefined ? '<option value="">' + esc(placeholder) + '</option>' : '') + list.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value === null || value === undefined ? '' : value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('');
  }
  function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
  function refresh() { return DP.navigate(); }
  function fileSafe(name) { return String(name || 'fichier').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80); }
  function docTypeLabel(t) { var x = DOC_TYPES.filter(function (d) { return d[0] === t; })[0]; return x ? x[1] : t; }
  function catNom(c) { return DP.categories[c] ? DP.categories[c].nom : (c || '—'); }
  function catLabel(c) { return DP.labels.category[c] || 'Pas encore choisie'; }
  function initials(b) { return ((b.prenom || '').charAt(0) + (b.nom || '').charAt(0)).toUpperCase() || '?'; }

  function checkImage(file) {
    var ok = /^image\/(jpeg|png|webp)$/.test(file.type || '') || /\.(jpe?g|png|webp)$/i.test(file.name || '');
    if (!ok) throw new Error('Format non accepté : choisissez une image JPG, PNG ou WebP.');
    if (file.size > IMAGE_MAX) throw new Error('Image trop volumineuse : 3 Mo maximum.');
  }

  async function openDocument(path) {
    var url = await DP.api.signedUrl(path, 300);
    window.open(url, '_blank', 'noopener');
  }

  /* Fiche bénéficiaire liée au compte (une seule). Une fiche « draft » existe dès la validation. */
  async function myBen() {
    var rows = await DP.api.get('beneficiaries', { select: '*', user_id: 'eq.' + DP.api.uid });
    return rows[0] || null;
  }
  /* Profil du compte : identifiant, choix, photo. */
  async function profileRow() {
    var rows = await DP.api.get('profiles', { select: 'id,prenom,nom,identifiant,wish_category,wish_at,photo_path', id: 'eq.' + DP.api.uid });
    return rows[0] || {};
  }
  function noBen(el, title) {
    el.innerHTML = ui.header(title || 'Mon espace') +
      ui.alert('warn', '<strong>Fiche en cours de rattachement.</strong> Votre compte est validé, mais votre fiche bénéficiaire n’est pas encore liée. Contactez votre Agent.');
  }

  /* ---------- Tableau de bord ---------- */
  async function renderHome(el) {
    var b = await myBen();
    if (!b) return noBen(el, 'Mon tableau de bord');
    var pr = await profileRow();
    /* Tant que la catégorie n'est pas acceptée, l'état du choix sert à guider l'étape suivante. */
    var cstate = b.category ? null : await DP.api.rpc('beneficiary_category_state', {});
    var r = await Promise.all([
      b.agent_id ? DP.api.get('profiles', { select: 'id,prenom,nom,code', id: 'eq.' + b.agent_id }) : Promise.resolve([]),
      DP.api.get('projects', { select: 'id,status', beneficiary_id: 'eq.' + b.id }),
      DP.api.get('connection_requests', { select: 'id,status' }),
      DP.api.get('documents', { select: 'id', owner_beneficiary_id: 'eq.' + b.id }),
      DP.api.get('carrefour_members', { select: 'status', beneficiary_id: 'eq.' + b.id })
    ]);
    var agent = r[0][0], projects = r[1], conns = r[2], docs = r[3], memb = r[4];
    var statusText = b.status === 'active' ? 'Votre fiche est active.' : 'Votre catégorie n’est pas encore validée.';

    var step = '';
    if (cstate) {
      var txt = cstate.proposal
        ? 'Votre Agent vous propose la catégorie <strong>' + esc(catNom(cstate.proposal.category)) + '</strong>. Ouvrez « Ma catégorie » pour accepter ou refuser.'
        : (cstate.wish
          ? 'Votre choix (<strong>' + esc(catNom(cstate.wish)) + '</strong>) attend la validation de votre Agent.'
          : 'Lisez les avantages, les limites et les exigences de chaque catégorie, puis faites votre choix.');
      step = ui.card('Étape 1 : votre catégorie', '<p>' + txt + '</p>' +
        '<div class="btn-row"><a class="btn btn-primary" href="#/espace/categorie">Ouvrir « Ma catégorie »</a></div>');
    }

    el.innerHTML = ui.header('Bonjour ' + (b.prenom || '') + ' !', statusText) + step +
      ui.card(null, '<dl class="kv">' +
        '<dt>Identifiant</dt><dd><strong>' + esc(pr.identifiant || '—') + '</strong></dd>' +
        '<dt>Code</dt><dd>' + esc(b.code || 'Attribué quand votre catégorie est acceptée') + '</dd>' +
        '<dt>Catégorie</dt><dd>' + esc(catLabel(b.category)) + '</dd>' +
        '<dt>Statut</dt><dd>' + ui.badge(b.status) + '</dd>' +
        '<dt>Votre Agent</dt><dd>' + esc(agent ? pname(agent) + (agent.code ? ' (' + agent.code + ')' : '') : 'Pas encore affecté') + '</dd></dl>') +
      ui.stats([
        ['Projets et besoins', projects.length, projects.filter(function (p) { return p.status === 'ready'; }).length + ' prêt(s) à présenter'],
        ['Dossiers suivis', conns.length, conns.filter(function (c) { return c.status === 'approved_admin'; }).length ? 'Un consentement vous est demandé' : 'Mises en relation'],
        ['Pièces déposées', docs.length, 'Dans votre espace'],
        ['Carrefours', memb.filter(function (m) { return m.status === 'accepted'; }).length, 'Adhésions acceptées']
      ]) +
      ui.card('Accès rapides', '<div class="btn-row quick-links">' +
        '<a class="btn btn-primary" href="#/espace/categorie">Ma catégorie</a>' +
        '<a class="btn btn-outline" href="#/espace/entreprises">Mes entreprises</a>' +
        '<a class="btn btn-outline" href="#/espace/projets">Mes projets et besoins</a>' +
        '<a class="btn btn-outline" href="#/espace/dossiers">Mes dossiers</a>' +
        '<a class="btn btn-outline" href="#/espace/opportunites">Opportunités</a>' +
        '<a class="btn btn-outline" href="#/espace/profil">Mon profil et mes pièces</a>' +
        '<a class="btn btn-ghost" href="#/messages">Écrire à l’Administrateur</a></div>');
  }

  /* ---------- Ma catégorie : choix, proposition de l'Agent, acceptation ---------- */
  function placesLine(cs, cat) {
    if (!cs.affected || !cs.places || !cs.places[cat]) return '<span class="small muted">Le nombre de places dépend de votre Agent d’affectation.</span>';
    var p = cs.places[cat];
    return p.left > 0
      ? '<span class="small">' + p.left + ' place(s) restante(s) sur ' + p.total + ' dans le quota de votre Agent</span>'
      : '<span class="small"><strong>Plus de place dans cette catégorie pour votre Agent.</strong></span>';
  }

  function categoryCard(cat, cs) {
    var c = DP.categories[cat];
    var chosen = cs.wish === cat;
    var full = !!(cs.affected && cs.places && cs.places[cat] && cs.places[cat].left <= 0);
    var list = function (title, items) {
      return '<h4 class="small" style="margin:.6rem 0 .2rem">' + esc(title) + '</h4><ul class="small" style="margin:0;padding-left:1.1rem">' +
        items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    };
    return '<article class="card"><div class="card-body">' +
      '<h3 style="margin:0 0 .25rem">' + esc(c.nom) + ' <span class="small muted">(' + esc(c.code) + ')</span></h3>' +
      (chosen ? '<p class="small"><strong>Votre choix</strong></p>' : '') +
      '<p class="small"><strong>Financement indicatif :</strong> ' + esc(c.financement) + '</p>' +
      '<p>' + esc(c.resume) + '</p>' +
      '<p class="small">' + esc(c.parrain) + '</p>' +
      '<p>' + placesLine(cs, cat) + '</p>' +
      '<details><summary>Avantages, limites et exigences</summary>' +
        list('Avantages', c.avantages) + list('Limites', c.limites) + list('Exigences', c.exigences) +
      '</details>' +
      '<div class="form-actions">' + (chosen ? '' :
        '<button class="btn btn-primary" type="button" data-wish="' + esc(cat) + '"' + (full ? ' disabled' : '') + '>Choisir ' + esc(c.nom) + '</button>') +
      '</div></div></article>';
  }

  async function renderCategory(el) {
    var b = await myBen();
    if (!b) return noBen(el, 'Ma catégorie');
    var cs = await DP.api.rpc('beneficiary_category_state', {});
    var head = ui.header('Ma catégorie', 'Choisissez la catégorie qui correspond à votre activité. Votre Agent valide votre choix, puis vous propose une place.');

    if (cs.status === 'active') {
      var c = DP.categories[cs.category];
      el.innerHTML = head + ui.card('Votre catégorie est validée', '<dl class="kv">' +
        '<dt>Catégorie</dt><dd>' + esc(catLabel(cs.category)) + '</dd>' +
        '<dt>Code</dt><dd><strong>' + esc(cs.code || '—') + '</strong></dd>' +
        '<dt>Votre Agent</dt><dd>' + esc(cs.agent ? cs.agent.name : '—') + '</dd></dl>' +
        (c ? '<p class="small muted">' + esc(c.resume) + '</p>' : '')) +
        ui.alert('info', 'Pour changer de catégorie ou d’Agent, écrivez à l’Administrateur.');
      return;
    }

    var body = '';
    if (DP.categories.statut === 'brouillon') {
      body += ui.alert('info', 'Les textes des catégories sont en cours de validation par l’équipe DarajaPlus.');
    }
    if (cs.proposal) {
      var p = cs.proposal;
      var sp = p.sponsor_code ? ' Votre parrain : <strong>' + esc(p.sponsor_code) + '</strong>.' : '';
      body += ui.card('Une place vous est proposée', '<p>Votre Agent vous propose la catégorie <strong>' + esc(catNom(p.category)) + '</strong>. ' +
        'Vous seriez inscrit au <strong>rang ' + p.rank + '</strong> sur ' + p.total + ' places ; il reste ' + p.left +
        ' place(s) dans cette catégorie, la vôtre comprise.' + sp + '</p>' +
        '<p class="small muted">En acceptant, votre fiche devient active tout de suite et votre code vous est attribué.</p>' +
        '<div class="btn-row"><button class="btn btn-primary" type="button" data-accept="' + esc(p.id) + '">Accepter cette catégorie</button>' +
        '<button class="btn btn-outline" type="button" data-refuse="' + esc(p.id) + '">Refuser</button></div>');
    } else if (cs.wish) {
      body += ui.alert('info', '<strong>Votre choix : ' + esc(catNom(cs.wish)) + '.</strong> ' + (cs.affected
        ? 'Il attend la validation de votre Agent. Vous serez informé dès sa proposition.'
        : 'Il attend la validation de votre Agent, après votre affectation à un Agent.'));
    } else {
      body += ui.alert('info', cs.affected
        ? 'Choisissez une catégorie. Votre Agent la validera et vous proposera une place.'
        : 'Choisissez une catégorie. Elle attendra la validation de votre Agent, après votre affectation à un Agent.');
    }

    body += '<div class="grid-2">' + DP.categories.ordre.map(function (k) { return categoryCard(k, cs); }).join('') + '</div>';
    body += ui.alert('info', 'Dans toutes les catégories, vous pouvez ajouter un ou plusieurs projets et plusieurs entreprises. Un montant indicatif n’est jamais une promesse de financement.');
    el.innerHTML = head + body;

    act(el, '[data-wish]', async function (btn) {
      var cat = btn.dataset.wish;
      var extra = cs.proposal ? ' Ce choix remplacera la proposition en cours.' : '';
      if (!(await ui.confirm('Choisir la catégorie ' + catNom(cat) + ' ?' + extra + ' Votre Agent examinera ce choix.', 'Choisir'))) return;
      await DP.api.rpc('beneficiary_set_wish', { p_category: cat });
      ui.toast('Votre choix (' + catNom(cat) + ') est enregistré.', 'ok');
      refresh();
    });
    act(el, '[data-accept]', async function (btn) {
      if (!(await ui.confirm('Accepter cette catégorie ? Votre fiche sera active tout de suite et votre code vous sera attribué.', 'Accepter'))) return;
      await DP.api.rpc('beneficiary_respond_proposal', { p_proposal: btn.dataset.accept, p_accept: true });
      ui.toast('Catégorie acceptée. Votre fiche est active.', 'ok');
      refresh();
    });
    act(el, '[data-refuse]', async function (btn) {
      if (!(await ui.confirm('Refuser cette proposition ? Votre Agent en sera informé et vous pourrez choisir une autre catégorie.', 'Refuser'))) return;
      await DP.api.rpc('beneficiary_respond_proposal', { p_proposal: btn.dataset.refuse, p_accept: false });
      ui.toast('Proposition refusée.', 'ok');
      refresh();
    });
  }

  /* ---------- Profil, identifiant et photo ---------- */
  async function renderProfile(el) {
    var b = await myBen();
    if (!b) return noBen(el, 'Mon profil');
    var pr = await profileRow();
    var r = await Promise.all([
      DP.api.get('documents', { select: '*', owner_beneficiary_id: 'eq.' + b.id, order: 'created_at.desc' }),
      DP.api.get('projects', { select: 'id,title', beneficiary_id: 'eq.' + b.id, order: 'created_at.desc' })
    ]);
    var docs = r[0], projects = r[1];
    var photo = pr.photo_path ? await DP.api.signedUrlFor('visuels', pr.photo_path, 3600).catch(function () { return ''; }) : '';

    var avatar = photo
      ? '<img src="' + esc(photo) + '" alt="Votre photo de profil" style="width:96px;height:96px;object-fit:cover;border-radius:50%">'
      : '<div style="width:96px;height:96px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#e5f3ea;font-size:1.6rem;font-weight:700">' + esc(initials(b)) + '</div>';

    el.innerHTML = ui.header('Mon profil et mes pièces', 'Vos informations et les documents de votre dossier. Aucune pièce n’est partagée sans votre accord.') +
      '<div class="grid-2">' +
      ui.card('Mon identifiant', '<div style="font-size:1.6rem;font-weight:700;letter-spacing:.04em">' + esc(pr.identifiant || '—') + '</div>' +
        '<p class="small muted">Gardez cet identifiant : il identifie votre compte auprès de l’équipe DarajaPlus.</p>' +
        '<dl class="kv"><dt>Code</dt><dd>' + esc(b.code || 'Attribué quand votre catégorie est acceptée') + '</dd>' +
        '<dt>Catégorie</dt><dd>' + esc(catLabel(b.category)) + '</dd></dl>') +
      ui.card('Photo de profil', '<div style="margin-bottom:.75rem">' + avatar + '</div>' +
        '<form class="form" id="f-photo">' +
        '<div class="field field-full"><span class="field-label">Choisir une photo (JPG, PNG ou WebP — 3 Mo maximum)</span>' +
        '<input class="input" type="file" name="photo" accept="' + IMAGE_ACCEPT + '" required></div>' +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer la photo</button></div></form>') +
      '</div>' +
      '<div class="grid-2">' +
      ui.card('Mes informations', '<form class="form" id="f-me">' +
        '<div class="field-row">' + ui.field({ name: 'nom', label: 'Nom', value: b.nom, required: true }) +
        ui.field({ name: 'postnom', label: 'Post-nom', value: b.postnom, required: true }) + '</div>' +
        ui.field({ name: 'prenom', label: 'Prénom', value: b.prenom, required: true }) +
        '<div class="field-row">' + ui.field({ name: 'phone', label: 'Téléphone', value: b.phone, placeholder: '+243…' }) +
        ui.field({ name: 'email', label: 'E-mail', value: b.email }) + '</div>' +
        '<p class="small muted">Pour changer de catégorie ou d’Agent, écrivez à l’Administrateur.</p>' +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer</button></div></form>') +
      ui.card('Déposer une pièce', '<form class="form" id="f-doc">' +
        ui.field({ name: 'doc_type', label: 'Type de document', type: 'select', options: DOC_TYPES, required: true }) +
        ui.field({ name: 'project_id', label: 'Projet concerné', type: 'select', options: projects.map(function (p) { return [p.id, p.title]; }), placeholder: 'Aucun projet précis', dataType: 'nullable' }) +
        '<div class="field field-full"><label for="f-file">Fichier (PDF, image ou Word — 10 Mo maximum)</label>' +
        '<input class="input" id="f-file" type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" required></div>' +
        '<p class="small muted">Vos pièces restent confidentielles. Vous décidez, à chaque demande, lesquelles partager.</p>' +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Déposer</button></div></form>') +
      '</div>' +
      ui.card('Mes pièces', ui.table([
        { label: 'Document', render: function (d) { return '<strong>' + esc(d.file_name || 'Pièce') + '</strong><div class="small muted">' + esc(docTypeLabel(d.doc_type)) + ' · v' + d.version + '</div>'; } },
        { label: 'Ajouté le', render: function (d) { return ui.date(d.created_at); } },
        { label: 'Vérifié', render: function (d) { return d.verified ? ui.badge('validated') : '<span class="muted small">En attente de vérification</span>'; } },
        { label: 'Action', cls: 'actions', render: function (d) { return '<button class="btn btn-sm btn-outline" type="button" data-open-doc="' + esc(d.storage_path) + '">Ouvrir</button>'; } }
      ], docs, 'Aucune pièce déposée pour le moment.'));

    ui.bindForm(el.querySelector('#f-photo'), async function (d, form) {
      var file = form.querySelector('input[type=file]').files[0];
      if (!file) throw new Error('Choisissez une photo.');
      checkImage(file);
      var path = DP.api.uid + '/photo-' + Date.now() + '_' + fileSafe(file.name);
      await DP.api.uploadTo('visuels', path, file);
      await DP.api.update('profiles', { id: 'eq.' + DP.api.uid }, { photo_path: path });
      refresh();
      return 'Photo enregistrée.';
    });
    ui.bindForm(el.querySelector('#f-me'), async function (d) {
      await DP.api.update('beneficiaries', { id: 'eq.' + b.id }, {
        nom: d.nom, postnom: d.postnom, prenom: d.prenom, phone: d.phone || null, email: d.email || null
      });
      refresh();
      return 'Informations enregistrées.';
    });
    ui.bindForm(el.querySelector('#f-doc'), async function (d, form) {
      var file = form.querySelector('input[type=file]').files[0];
      if (!file) throw new Error('Choisissez un fichier.');
      if (file.size > DOC_MAX) throw new Error('Fichier trop volumineux : 10 Mo maximum.');
      var path = DP.api.uid + '/' + Date.now() + '_' + fileSafe(file.name);
      await DP.api.upload(path, file);
      await DP.api.insert('documents', {
        owner_beneficiary_id: b.id, project_id: d.project_id || null, doc_type: d.doc_type,
        storage_path: path, file_name: file.name, confidentiality: 'confidentiel',
        version: 1, verified: false, uploaded_by: DP.api.uid
      });
      refresh();
      return 'Pièce déposée.';
    });
    act(el, '[data-open-doc]', function (btn) { return openDocument(btn.dataset.openDoc); });
  }

  /* ---------- Mes entreprises ---------- */
  /* Entreprises liées à ce bénéficiaire (deux lectures simples, sans jointure). */
  async function loadEntreprises(b) {
    var links = await DP.api.get('beneficiary_establishments', { select: 'establishment_id', beneficiary_id: 'eq.' + b.id });
    var ids = links.map(function (l) { return l.establishment_id; });
    return ids.length ? DP.api.get('establishments', { select: '*', id: inq(ids), order: 'created_at.asc' }) : [];
  }
  async function withLogos(list) {
    await Promise.all(list.map(async function (e) {
      e.logo_url = e.logo_path ? await DP.api.signedUrlFor('visuels', e.logo_path, 3600).catch(function () { return ''; }) : '';
    }));
    return list;
  }
  function entrepriseFields(e) {
    e = e || {};
    return ui.field({ name: 'name', label: 'Nom de l’entreprise', value: e.name, required: true, full: true }) +
      '<div class="field-row">' + ui.field({ name: 'sector', label: 'Secteur', value: e.sector, placeholder: 'ex. commerce, couture', dataType: 'nullable' }) +
      ui.field({ name: 'phone', label: 'Téléphone', value: e.phone, placeholder: '+243…', dataType: 'nullable' }) + '</div>' +
      ui.field({ name: 'address', label: 'Adresse ou localisation', value: e.address, full: true, dataType: 'nullable' }) +
      ui.field({ name: 'description', label: 'Description de l’activité', type: 'textarea', rows: 3, value: e.description, full: true, dataType: 'nullable' }) +
      ui.field({ name: 'services', label: 'Produits et services', type: 'textarea', rows: 2, value: e.services, full: true, dataType: 'nullable' }) +
      '<div class="field field-full"><span class="field-label">Logo (JPG, PNG ou WebP — 3 Mo maximum, facultatif)</span>' +
      '<input class="input" type="file" name="logo" accept="' + IMAGE_ACCEPT + '"></div>';
  }
  function entrepriseCard(e) {
    var logo = e.logo_url
      ? '<img src="' + esc(e.logo_url) + '" alt="Logo de ' + esc(e.name) + '" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex:none">'
      : '<div style="width:56px;height:56px;border-radius:8px;flex:none;display:flex;align-items:center;justify-content:center;background:#e5f3ea;font-weight:700">' + esc((e.name || '?').charAt(0).toUpperCase()) + '</div>';
    return '<article class="card"><div class="card-body" style="display:flex;gap:.75rem;align-items:flex-start">' + logo +
      '<div style="flex:1;min-width:0"><strong>' + esc(e.name) + '</strong> ' + ui.badge(e.verification_status) +
      '<div class="small muted">' + esc(e.sector || 'Secteur non précisé') + (e.address ? ' · ' + esc(short(e.address, 60)) : '') + '</div>' +
      (e.description ? '<p class="small">' + esc(short(e.description, 200)) + '</p>' : '') +
      '<button class="btn btn-sm btn-outline" type="button" data-edit-ent="' + esc(e.id) + '">Modifier</button></div></div></article>';
  }
  /* Enregistre une entreprise : création (puis liaison) ou mise à jour, et logo facultatif. */
  async function saveEntreprise(d, form, b, current) {
    var file = form.querySelector('input[type=file]').files[0];
    if (file) checkImage(file);
    var fields = {
      name: d.name, sector: d.sector || null, phone: d.phone || null, address: d.address || null,
      description: d.description || null, services: d.services || null
    };
    var id;
    if (current) {
      await DP.api.update('establishments', { id: 'eq.' + current.id }, fields);
      id = current.id;
    } else {
      var row = (await DP.api.insert('establishments', Object.assign({ created_by: DP.api.uid, verification_status: 'to_verify' }, fields)))[0];
      id = row.id;
      await DP.api.insert('beneficiary_establishments', { beneficiary_id: b.id, establishment_id: id });
    }
    if (file) {
      var path = DP.api.uid + '/logo-' + Date.now() + '_' + fileSafe(file.name);
      await DP.api.uploadTo('visuels', path, file);
      await DP.api.update('establishments', { id: 'eq.' + id }, { logo_path: path });
    }
  }

  async function renderEntreprises(el) {
    var b = await myBen();
    if (!b) return noBen(el, 'Mes entreprises');
    var list = await withLogos(await loadEntreprises(b));
    var map = byId(list);
    el.innerHTML = ui.header('Mes entreprises', 'Présentez chaque entreprise ou activité que vous possédez. Le logo est facultatif. Votre Hôte vérifie les informations.') +
      '<div class="grid-2">' +
      ui.card('Ajouter une entreprise', '<form class="form" id="f-ent">' + entrepriseFields(null) +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer l’entreprise</button></div></form>') +
      ui.card('Mes entreprises', list.length
        ? list.map(entrepriseCard).join('')
        : ui.empty('Aucune entreprise pour le moment. Ajoutez-la à gauche ; vous pourrez la lier à un projet.')) +
      '</div>';

    ui.bindForm(el.querySelector('#f-ent'), async function (d, form) {
      await saveEntreprise(d, form, b, null);
      refresh();
      return 'Entreprise enregistrée.';
    });
    act(el, '[data-edit-ent]', function (btn) {
      var e = map[btn.dataset.editEnt];
      if (!e) return;
      var m = ui.modal('Modifier l’entreprise', '<form class="form" id="f-ent-edit">' + entrepriseFields(e) +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer</button></div></form>');
      ui.bindForm(m.el.querySelector('#f-ent-edit'), async function (d, form) {
        await saveEntreprise(d, form, b, e);
        m.close();
        refresh();
        return 'Entreprise modifiée.';
      });
    });
  }

  /* ---------- Projets et besoins ---------- */
  async function renderProjects(el) {
    var b = await myBen();
    if (!b) return noBen(el, 'Mes projets et besoins');
    var r = await Promise.all([
      DP.api.get('projects', { select: '*', beneficiary_id: 'eq.' + b.id, order: 'created_at.desc' }),
      loadEntreprises(b)
    ]);
    var rows = r[0];
    /* Le serveur n'accepte de lier un projet qu'à une entreprise créée par ce bénéficiaire. */
    var mine = r[1].filter(function (e) { return e.created_by === DP.api.uid; });
    el.innerHTML = ui.header('Mes projets et besoins', 'Décrivez votre activité et votre besoin. Votre Agent ou votre Hôte vérifie le dossier avant de le rendre présentable aux partenaires.') +
      '<div class="grid-2">' +
      ui.card('Nouveau projet ou besoin', '<form class="form" id="f-proj">' +
        ui.field({ name: 'title', label: 'Intitulé', required: true, full: true }) +
        ui.field({ name: 'establishment_id', label: 'Entreprise concernée', type: 'select', options: mine.map(function (e) { return [e.id, e.name]; }), placeholder: 'Aucune entreprise précise', dataType: 'nullable', full: true, hint: mine.length ? '' : 'Ajoutez d’abord votre entreprise dans « Mes entreprises », si ce projet la concerne.' }) +
        '<div class="field-row">' + ui.field({ name: 'sector', label: 'Secteur d’activité', placeholder: 'ex. commerce, agriculture' }) +
        ui.field({ name: 'currency', label: 'Devise', type: 'select', options: [['USD', 'USD'], ['FC', 'FC']], value: 'USD' }) + '</div>' +
        '<div class="field-row">' + ui.field({ name: 'amount', label: 'Montant nécessaire', type: 'number', dataType: 'number', step: 'any', min: 0.01, required: true }) +
        ui.field({ name: 'due_date', label: 'Échéance souhaitée', type: 'date', dataType: 'nullable' }) + '</div>' +
        ui.field({ name: 'description', label: 'Votre activité et ce projet', type: 'textarea', rows: 4, full: true, dataType: 'nullable' }) +
        ui.field({ name: 'use_of_funds', label: 'À quoi serviront les fonds ?', type: 'textarea', rows: 3, full: true, dataType: 'nullable' }) +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer le brouillon</button></div></form>') +
      ui.card('Mes projets', ui.table([
        { label: 'Projet', render: function (p) { return '<strong>' + esc(p.title) + '</strong><div class="small muted">' + esc(p.sector || '') + '</div>'; } },
        { label: 'Montant', cls: 'num', render: function (p) { return ui.money(p.amount, p.currency); } },
        { label: 'Échéance', render: function (p) { return ui.date(p.due_date); } },
        { label: 'Statut', render: function (p) { return ui.badge(p.status); } }
      ], rows, 'Aucun projet pour le moment. Créez votre premier besoin à gauche.')) + '</div>';

    ui.bindForm(el.querySelector('#f-proj'), async function (d) {
      if (!(d.amount > 0)) throw new Error('Le montant doit être supérieur à 0.');
      await DP.api.insert('projects', {
        beneficiary_id: b.id, created_by: DP.api.uid, title: d.title, sector: d.sector || null,
        establishment_id: d.establishment_id || null,
        description: d.description || null, amount: d.amount, currency: d.currency,
        use_of_funds: d.use_of_funds || null, due_date: d.due_date || null, status: 'draft'
      });
      refresh();
      return 'Projet enregistré en brouillon.';
    });
  }

  /* ---------- Dossiers et consentements ---------- */
  async function renderDossiers(el) {
    var b = await myBen();
    if (!b) return noBen(el, 'Mes dossiers');
    var conns = await DP.api.get('connection_requests', { select: '*', order: 'created_at.desc', limit: 200 });
    var projects = byId(await DP.api.get('projects', { select: 'id,title,amount,currency', id: inq(conns.map(function (c) { return c.project_id; })) || 'is.null' }));
    var partners = byId(await DP.api.get('partners', { select: 'id,legal_name', id: inq(conns.map(function (c) { return c.partner_id; })) || 'is.null' }));
    var docs = await DP.api.get('documents', { select: '*', owner_beneficiary_id: 'eq.' + b.id, confidentiality: 'neq.interne', order: 'created_at.desc' });
    var dmap = byId(docs);
    var shares = conns.length ? await DP.api.get('document_shares', { select: '*', revoked_at: 'is.null', connection_id: inq(conns.map(function (c) { return c.id; })) || 'is.null' }) : [];
    var cmap = byId(conns);

    var html = ui.header('Mes dossiers', 'Suivi de vos mises en relation. Vous êtes informé de chaque étape et vous décidez quelles pièces partager.');
    if (!conns.length) {
      html += ui.card(null, ui.empty('Aucune mise en relation pour le moment. Un partenaire peut étudier vos projets une fois qu’ils sont prêts à être présentés.'));
    } else {
      html += ui.card(null, ui.table([
        { label: 'Projet', render: function (c) { var p = projects[c.project_id]; return '<strong>' + esc(p ? p.title : '—') + '</strong><div class="small muted">' + esc(p ? ui.money(p.amount, p.currency) : '') + '</div>'; } },
        { label: 'Partenaire', render: function (c) { var x = partners[c.partner_id]; return esc(x ? x.legal_name : '—'); } },
        { label: 'Statut', render: function (c) { return ui.badge(c.status) + '<div class="small muted">' + esc(CONN_HELP[c.status] || '') + '</div>' + (c.admin_reason && c.status === 'refused_admin' ? '<div class="small">Motif : ' + esc(c.admin_reason) + '</div>' : ''); } },
        { label: 'Pièces partagées', render: function (c) {
          var s = shares.filter(function (x) { return x.connection_id === c.id; });
          if (!s.length) return '<span class="muted small">Aucune</span>';
          return s.map(function (x) {
            var d = dmap[x.document_id];
            return '<div class="small">' + esc(d ? d.file_name || docTypeLabel(d.doc_type) : 'Pièce') + ' — jusqu’au ' + ui.date(x.expires_at) + '</div>';
          }).join('');
        } },
        { label: 'Action', cls: 'actions', render: function (c) {
          if (c.status === 'approved_admin') return '<button class="btn btn-sm btn-primary" type="button" data-consent="' + esc(c.id) + '">Donner mon consentement</button>';
          return '—';
        } }
      ], conns, 'Aucun dossier.'));
    }
    html += ui.alert('info', 'Votre consentement est donné pour un partenaire et une durée données. Vous pouvez ne rien partager : le dossier avance sans pièce.');
    el.innerHTML = html;

    act(el, '[data-consent]', function (btn) {
      var c = cmap[btn.dataset.consent];
      var checks = docs.length ? docs.map(function (d) {
        return '<label class="field-check" style="display:flex;gap:.5rem;align-items:flex-start;margin:.35rem 0">' +
          '<input type="checkbox" name="doc" value="' + esc(d.id) + '"> <span>' + esc(d.file_name || docTypeLabel(d.doc_type)) + ' <span class="small muted">(' + esc(docTypeLabel(d.doc_type)) + ')</span></span></label>';
      }).join('') : '<p class="small muted">Vous n’avez encore déposé aucune pièce. Vous pouvez tout de même donner votre consentement.</p>';
      var m = ui.modal('Consentement de partage', '<p>Vous autorisez ' + esc((partners[c.partner_id] || {}).legal_name || 'le partenaire') +
        ' à consulter les pièces cochées ci-dessous, pour la durée choisie. Vous pouvez refuser en ne donnant pas votre accord.</p>' +
        '<form class="form" id="cons">' + '<div class="field field-full"><span class="field-label">Pièces à partager</span>' + checks + '</div>' +
        ui.field({ name: 'days', label: 'Durée du partage (jours)', type: 'number', dataType: 'number', min: 1, max: CONSENT_DAYS_MAX, value: 30, required: true, hint: 'Entre 1 et ' + CONSENT_DAYS_MAX + ' jours.' }) +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Je consens</button></div></form>');
      ui.bindForm(m.el.querySelector('#cons'), async function (d, form) {
        var ids = Array.from(form.querySelectorAll('input[name=doc]:checked')).map(function (x) { return x.value; });
        if (!(d.days >= 1 && d.days <= CONSENT_DAYS_MAX)) throw new Error('La durée doit être comprise entre 1 et ' + CONSENT_DAYS_MAX + ' jours.');
        var res = await DP.api.rpc('beneficiary_consent', { p_connection: c.id, p_document_ids: ids, p_days: d.days });
        m.close();
        refresh();
        return res && res.documents_partages ? res.documents_partages + ' pièce(s) transmise(s) au partenaire.' : 'Consentement enregistré.';
      }, null);
    });
  }

  /* ---------- Opportunités ---------- */
  async function renderOpportunities(el) {
    var b = await myBen();
    if (!b) return noBen(el, 'Opportunités');
    var r = await Promise.all([
      DP.api.get('announcements', { select: '*', status: 'eq.visible', order: 'created_at.desc', limit: 50 }),
      DP.api.get('offers', { select: '*', status: 'eq.published', order: 'created_at.desc', limit: 200 })
    ]);
    var anns = r[0];
    var offers = r[1].filter(function (o) { return !o.target_category || o.target_category === 'all' || o.target_category === b.category; });
    var partners = byId(await DP.api.get('partners', { select: 'id,legal_name', id: inq(offers.map(function (o) { return o.partner_id; })) || 'is.null' }));
    el.innerHTML = ui.header('Opportunités', 'Programmes, appels à projets et offres publiés sur DarajaPlus. Une opportunité n’est pas une promesse de financement.') +
      (anns.length ? ui.card('Annonces', '<ul class="notif-list">' + anns.map(function (a) {
        return '<li class="notif"><div class="notif-main"><strong>' + esc(a.title) + '</strong><div class="small">' + esc(a.body) + '</div>' +
          '<div class="small muted">' + ui.dateTime(a.created_at) + '</div></div></li>';
      }).join('') + '</ul>') : '') +
      ui.card('Opportunités pour ma catégorie', offers.length ? '<div class="grid-2">' + offers.map(function (o) {
        var by = o.author_kind === 'partner' ? (partners[o.partner_id] ? partners[o.partner_id].legal_name : 'Partenaire validé') : 'Publié par un Agent DarajaPlus';
        return '<article class="card"><div class="card-body">' +
          '<h3 style="margin:0 0 .25rem">' + esc(o.title) + '</h3>' +
          '<div class="small muted">' + esc(OFFER_LABEL[o.offer_type] || o.offer_type || '') + ' · ' + esc(by) + '</div>' +
          '<p>' + esc(short(o.description, 260)) + '</p>' +
          '<dl class="kv small">' +
          (o.amount_min || o.amount_max ? '<dt>Montant indicatif</dt><dd>' + esc(ui.money(o.amount_min, o.currency) + ' à ' + ui.money(o.amount_max, o.currency)) + '</dd>' : '') +
          (o.sector ? '<dt>Secteur</dt><dd>' + esc(o.sector) + '</dd>' : '') +
          (o.deadline ? '<dt>Date limite</dt><dd>' + ui.date(o.deadline) + '</dd>' : '') +
          '</dl></div></article>';
      }).join('') + '</div>' : ui.empty('Aucune opportunité publiée pour votre catégorie pour le moment.'));
  }
  var OFFER_LABEL = {
    programme_accompagnement: 'Programme d’accompagnement', appel_projets: 'Appel à projets',
    offre_financement: 'Offre de financement', opportunite_investissement: 'Opportunité d’investissement'
  };

  /* ---------- Carrefours ---------- */
  async function renderCarrefours(el) {
    var b = await myBen();
    if (!b) return noBen(el, 'Carrefours');
    var r = await Promise.all([
      DP.api.get('settings', { select: 'value', key: 'eq.carrefour_enabled' }),
      DP.api.get('carrefours', { select: '*', status: 'in.(open,full,running)', order: 'created_at.desc' }),
      DP.api.get('carrefour_members', { select: '*', beneficiary_id: 'eq.' + b.id })
    ]);
    if (r[0][0] && r[0][0].value !== true) {
      el.innerHTML = ui.header('Carrefours') + ui.alert('info', 'L’espace Carrefours n’est pas ouvert pour le moment.');
      return;
    }
    var carrefours = r[1], mine = r[2];
    var mmap = byId(mine.map(function (m) { return { id: m.carrefour_id, status: m.status }; }));
    el.innerHTML = ui.header('Carrefours', 'Contribution mutuelle entre membres de votre zone : chacun cotise à une caisse commune, qui est remise à tour de rôle.') +
      ui.alert('warn', '<strong>À savoir :</strong> DarajaPlus ne reçoit ni ne distribue les fonds des Carrefours. Les règles (cotisation, rotation, retards, sorties) sont fixées par l’Agent organisateur et doivent être acceptées avant d’adhérer.') +
      ui.card(null, ui.table([
        { label: 'Carrefour', render: function (c) { return '<strong>' + esc(c.name) + '</strong><div class="small">' + esc(short(c.objective, 120)) + '</div>'; } },
        { label: 'Cotisation', cls: 'num', render: function (c) { return ui.money(c.contribution_amount, c.currency) + '<div class="small muted">' + esc(c.frequency) + '</div>'; } },
        { label: 'Membres', cls: 'num', render: function (c) { return c.max_members + ' places'; } },
        { label: 'Règles', render: function (c) { return '<span class="small">' + esc(short(c.rules, 160) || 'à préciser par l’organisateur') + '</span>'; } },
        { label: 'Votre adhésion', render: function (c) { return mmap[c.id] ? ui.badge(mine.filter(function (m) { return m.carrefour_id === c.id; })[0].status) : '—'; } },
        { label: 'Action', cls: 'actions', render: function (c) {
          if (mmap[c.id]) return '—';
          return '<button class="btn btn-sm btn-primary" type="button" data-join="' + esc(c.id) + '">Demander à rejoindre</button>';
        } }
      ], carrefours, 'Aucun Carrefour ouvert dans votre zone pour le moment.'));

    act(el, '[data-join]', async function (btn) {
      if (!(await ui.confirm('Demander à rejoindre ce Carrefour ? L’organisateur examinera votre demande. Vous gardez votre Agent actuel.', 'Demander'))) return;
      await DP.api.insert('carrefour_members', { carrefour_id: btn.dataset.join, beneficiary_id: b.id, status: 'requested' });
      ui.toast('Demande envoyée à l’organisateur.', 'ok');
      refresh();
    });
  }

  /* ---------- Visibilité ---------- */
  async function renderVisibility(el) {
    var b = await myBen();
    if (!b) return noBen(el, 'Visibilité');
    var r = await Promise.all([
      DP.api.get('settings', { select: 'value', key: 'eq.visibility_rate_fc_per_day' }),
      DP.api.get('visibility_orders', { select: '*', owner_id: 'eq.' + DP.api.uid, order: 'created_at.desc', limit: 100 })
    ]);
    var rate = ((r[0][0] || {}).value || {})[b.category] || 0;
    var rows = r[1];
    el.innerHTML = ui.header('Visibilité', 'Faites connaître votre activité auprès des partenaires. Tarif indicatif : ' + ui.money(rate, 'FC') + ' par jour, non définitif.') +
      '<div class="grid-2">' +
      ui.card('Commander une visibilité', '<form class="form" id="f-vis" data-reset="false">' +
        ui.field({ name: 'days', label: 'Durée en jours', type: 'number', dataType: 'number', min: 1, max: 365, value: 30, required: true, hint: 'Entre 1 et 365 jours.' }) +
        '<p class="small muted">Montant estimé : <strong id="vis-amount">' + ui.money(rate * 30, 'FC') + '</strong></p>' +
        '<p class="small muted">Le paiement n’est pas encore activé : la commande reste en attente de paiement.</p>' +
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
      return 'Commande enregistrée : ' + ui.money(res.amount_fc, 'FC') + ' (en attente de paiement).';
    });
  }

  /* ---------- Routes ---------- */
  DP.register([
    { path: '/espace', roles: ROLE, title: 'Mon tableau de bord', render: renderHome },
    { path: '/espace/categorie', roles: ROLE, title: 'Ma catégorie', render: renderCategory },
    { path: '/espace/profil', roles: ROLE, title: 'Mon profil et mes pièces', render: renderProfile },
    { path: '/espace/entreprises', roles: ROLE, title: 'Mes entreprises', render: renderEntreprises },
    { path: '/espace/projets', roles: ROLE, title: 'Mes projets et besoins', render: renderProjects },
    { path: '/espace/dossiers', roles: ROLE, title: 'Mes dossiers', render: renderDossiers },
    { path: '/espace/opportunites', roles: ROLE, title: 'Opportunités', render: renderOpportunities },
    { path: '/espace/carrefours', roles: ROLE, title: 'Carrefours', render: renderCarrefours },
    { path: '/espace/visibilite', roles: ROLE, title: 'Visibilité', render: renderVisibility }
  ]);
})();
