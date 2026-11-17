/* DarajaPlus — « Présenter mon projet » (espaces bénéficiaire et agent) : une fiche par projet. La fiche contient le projet et son besoin : « Présenter mon projet » crée le projet et sa fiche, et la même fiche permet ensuite de le modifier (il n'existe pas d'autre formulaire de création).
   Une fiche rédigée rubrique par rubrique, en quelques lignes, avec 1 à 4 photos du produit ou des réalisations.
   Chaque rubrique a une aide et un exemple fictif.
   Trois statuts : « brouillon » (seul le bénéficiaire voit la fiche), « publiée » (l'administrateur la vérifie),
   « visible » (l'administrateur l'a rendue visible aux partenaires). Le statut « visible » n'est jamais envoyé par le site :
   la base le refuse pour le bénéficiaire. Une modification d'une fiche visible la renvoie à la vérification. */
(function () {
  'use strict';

  var DP = window.DP;
  var esc = DP.ui.esc;
  var ui = DP.ui;
  /* Un agent peut aussi présenter ses propres projets (sans fiche bénéficiaire). */
  var ROLE = ['beneficiary', 'agent'];
  var TITLE_MAX = 120;
  var TEXT_MAX = 300;
  var PHOTO_SLOTS = 4;

  var SECTIONS = [
    { key: 'titre', label: 'Titre', help: 'Le nom de votre projet, en une ligne.',
      example: '« Kiosque solaire de recharge pour commerçants »' },
    { key: 'probleme', label: 'Problème', help: 'La douleur précise de votre client : qui souffre, de quoi, à quelle fréquence.',
      example: 'Dans mon quartier, les commerçants perdent deux à trois heures par jour faute de courant pour recharger leur téléphone.' },
    { key: 'solution', label: 'Solution', help: 'Comment votre projet résout ce problème.',
      example: 'Un kiosque alimenté par panneau solaire loue des batteries chargées, à l’heure ou à l’abonnement.' },
    { key: 'produit', label: 'Produit ou service', help: 'Décrivez le prototype ou ce que vous avez déjà réalisé. Ajoutez ensuite 1 à 4 photos.',
      example: 'Prototype en bois avec un panneau de 100 W, testé pendant un mois auprès de douze commerçants.', photos: true },
    { key: 'marche', label: 'Marché', help: 'La taille du marché : TAM (marché total), SAM (marché accessible), SOM (part que vous visez).',
      example: 'TAM : 40 000 commerçants de la ville. SAM : 8 000 qui utilisent leur téléphone toute la journée. SOM : 800 clients en trois ans.' },
    { key: 'modele', label: 'Modèle économique', help: 'Comment vous gagnez de l’argent.',
      example: 'Location à l’heure et abonnement mensuel de 5 000 FC. Marge brute visée : 45 %.' },
    { key: 'concurrence', label: 'Concurrence', help: 'Quelles sont les alternatives, et ce qui vous différencie.',
      example: 'Les groupes électrogènes coûtent plus cher et font du bruit. Nous sommes moins chers et sans carburant.' },
    { key: 'go_to_market', label: 'Go-to-market', help: 'Comment vous allez obtenir vos premiers clients.',
      example: 'Partenariat avec trois marchés, démonstrations gratuites la première semaine, bouche-à-oreille auprès de commerçants pilotes.' },
    { key: 'equipe', label: 'Équipe', help: 'Seul ou avec d’autres personnes ? Combien ? Qui fait quoi ?',
      example: 'Nous sommes trois : moi (gestion), un technicien (installation) et une commerciale (ventes).' },
    { key: 'demande', label: 'Demande', help: 'Le montant recherché, l’usage prévu et les jalons à atteindre.',
      example: '3 000 USD pour acheter dix kiosques. Jalons : dix kiosques installés en quatre mois, cinquante clients réguliers en six mois.' },
    { key: 'vision', label: 'Vision', help: 'Où en sera le projet dans 1 à 3 ans si vous obtenez le financement.',
      example: 'Dans trois ans : quarante kiosques dans deux villes.' }
  ];

  /* La fiche de présentation d'un projet (une par projet). */
  async function loadRow(projectId) {
    var rows = await DP.api.get('presentations', { select: '*', project_id: 'eq.' + projectId });
    return rows[0] || null;
  }

  /* Le projet du bénéficiaire connecté : la base ne renvoie que ses propres projets. */
  async function loadProjet(projectId) {
    var rows = await DP.api.get('projects', { select: '*', id: 'eq.' + projectId });
    return rows[0] || null;
  }

  /* Une présentation rédigée sans projet (avant le montant) : elle est reprise par « Présenter mon projet ». */
  async function loadEnAttente() {
    var rows = await DP.api.get('presentations', { select: '*', user_id: 'eq.' + DP.api.uid, project_id: 'is.null', order: 'updated_at.desc', limit: 1 });
    return rows[0] || null;
  }

  /* Entreprises créées par ce compte : seules celles-là peuvent être liées à un projet (règle de la base). */
  async function loadEtablissements() {
    return DP.api.get('establishments', { select: 'id,name', created_by: 'eq.' + DP.api.uid, order: 'name.asc' });
  }

  /* Secteurs d'activité proposés. Une valeur déjà enregistrée et absente de cette liste reste proposée. */
  var SECTEURS = ['Agriculture', 'Élevage et pêche', 'Commerce', 'Artisanat', 'Transformation alimentaire', 'Services',
    'Construction', 'Industrie', 'Transport et logistique', 'Technologies et numérique', 'Santé', 'Éducation', 'Énergie', 'Autre'];

  function secteurOptions(actuel) {
    var liste = SECTEURS.slice();
    if (actuel && liste.indexOf(actuel) === -1) liste.unshift(actuel);
    return liste.map(function (s) { return [s, s]; });
  }

  /* « Le besoin » : toutes les informations du projet. La même carte sert à créer un projet et à le modifier. */
  function besoinCard(projet, etablissements) {
    var p = projet || {};
    return ui.card('Le besoin',
      '<p class="small muted">Ces informations décrivent votre projet et votre besoin de financement. Le montant n’est pas une promesse de financement.</p>' +
      '<div class="field-row">' +
      ui.field({ name: 'amount', label: 'Montant nécessaire', type: 'number', dataType: 'number', step: 'any', min: 0.01, required: true, value: p.amount }) +
      ui.field({ name: 'currency', label: 'Devise', type: 'select', options: [['USD', 'USD'], ['FC', 'FC']], value: p.currency || 'USD' }) +
      '</div>' +
      '<div class="field-row">' +
      ui.field({ name: 'sector', label: 'Secteur d’activité', type: 'select', options: secteurOptions(p.sector), value: p.sector || '',
        placeholder: 'Choisissez un secteur', dataType: 'nullable' }) +
      ui.field({ name: 'due_date', label: 'Échéance souhaitée', type: 'date', value: p.due_date, dataType: 'nullable' }) +
      '</div>' +
      ui.field({ name: 'establishment_id', label: 'Entreprise concernée', type: 'select',
        options: etablissements.map(function (e) { return [e.id, e.name]; }), value: p.establishment_id,
        placeholder: 'Aucune entreprise précise', dataType: 'nullable', full: true,
        hint: etablissements.length ? '' : 'Ajoutez d’abord votre entreprise dans « Mes entreprises », si ce projet la concerne.' }) +
      ui.field({ name: 'description', label: 'Votre activité et ce projet', type: 'textarea', rows: 3, value: p.description, full: true, dataType: 'nullable' }) +
      ui.field({ name: 'use_of_funds', label: 'À quoi serviront les fonds ?', type: 'textarea', rows: 3, value: p.use_of_funds, full: true, dataType: 'nullable' }));
  }

  /* Où retrouver la liste des projets : l'espace bénéficiaire, ou l'espace agent pour ses propres projets. */
  function listeProjets() {
    var agent = DP.app.profile && DP.app.profile.role === 'agent';
    return { href: agent ? '#/agent/projets' : '#/espace/projets', libelle: agent ? '« Projets & besoins »' : '« Mes projets et besoins »' };
  }

  function alerteNouveau(row) {
    return ui.alert('info', '<strong>Nouveau projet.</strong> Indiquez votre besoin (montant et devise au minimum), puis enregistrez. ' +
      (row ? 'Votre présentation déjà rédigée sera reprise pour ce projet.' : 'Le projet apparaît ensuite dans ' + listeProjets().libelle + '.'));
  }

  /* Contrôles communs aux deux écrans : longueur des rubriques, puis rubriques complètes si la fiche est publiée. */
  function verifierRubriques(d, publier) {
    SECTIONS.forEach(function (s) {
      var max = s.key === 'titre' ? TITLE_MAX : TEXT_MAX;
      if ((d[s.key] || '').length > max) {
        throw new Error('« ' + s.label + ' » dépasse ' + max + ' caractères. Raccourcissez le texte.');
      }
    });
    if (publier) {
      var manque = SECTIONS.filter(function (s) { return !String(d[s.key] || '').trim(); }).map(function (s) { return s.label; });
      if (manque.length) {
        throw new Error('Pour publier, remplissez encore : ' + manque.join(', ') + '.');
      }
    }
  }

  function contenuDuFormulaire(d) {
    var contenu = {};
    SECTIONS.forEach(function (s) { contenu[s.key] = d[s.key] || ''; });
    return contenu;
  }

  /* Une photo choisie remplace celle de son emplacement ; sinon l'ancienne est gardée. */
  async function photosAEnregistrer(binders, anciennes) {
    var kept = [];
    var replaced = [];
    for (var k = 0; k < PHOTO_SLOTS; k++) {
      var file = binders[k].file();
      if (file) {
        kept.push(await DP.photo.upload(file));
        if (anciennes[k]) replaced.push(anciennes[k]);
      } else if (anciennes[k]) {
        kept.push(anciennes[k]);
      }
    }
    return { kept: kept, replaced: replaced };
  }

  /* Anciennes photos remplacées : supprimées du stockage (uniquement celles du dossier du bénéficiaire). */
  function supprimerAnciennesPhotos(replaced) {
    var old = replaced.filter(function (p) { return p.indexOf(DP.api.uid + '/') === 0; });
    if (old.length) DP.api.removeFrom('visuels', old).catch(function () {});
  }

  function fieldFor(s, value) {
    if (s.key === 'titre') {
      return ui.field({ name: s.key, label: 'Votre réponse', value: value, placeholder: 'Nom du projet',
        hint: 'Une ligne, ' + TITLE_MAX + ' caractères maximum.' });
    }
    return ui.field({ name: s.key, label: 'Votre réponse', type: 'textarea', rows: 4, value: value,
      hint: 'Clair, concis et précis : ' + TEXT_MAX + ' caractères maximum.' });
  }

  function photosHtml(urls) {
    var slots = '';
    for (var n = 0; n < PHOTO_SLOTS; n++) {
      slots += '<div class="pres-photo" id="pres-photo-' + n + '">' +
        DP.photo.html({ mode: 'form', url: urls[n] || '', initials: String(n + 1), alt: 'Photo ' + (n + 1),
          label: 'Photo ' + (n + 1) + ' (facultative, 3 Mo maximum)' }) + '</div>';
    }
    return '<div class="pres-photos"><p class="small"><strong>Photos du produit ou des réalisations</strong> : 1 à 4 photos, JPG, PNG ou WebP.</p>' +
      slots + '</div>';
  }

  function sectionCard(s, i, value, extra) {
    var body = '<p class="small muted">' + esc(s.help) + '</p>' +
      '<div class="example"><strong>Exemple</strong> (fictif) : ' + esc(s.example) + '</div>' +
      fieldFor(s, value) + (extra || '');
    return ui.card((i + 1) + '. ' + s.label, body);
  }

  /* Bannière selon le statut : ce que voient le bénéficiaire, l'administrateur et les partenaires. */
  function statusAlert(row) {
    var statut = row ? row.statut : 'brouillon';
    if (statut === 'visible') {
      return ui.alert('ok', '<strong>Visible des partenaires</strong> depuis le ' + ui.date(row.visible_at) + '. ' +
        'Toute modification la renvoie à la vérification de l’administrateur. « Enregistrer comme brouillon » la retire des partenaires.');
    }
    if (statut === 'publiee') {
      return ui.alert('warn', '<strong>Publiée le ' + ui.date(row.publiee_at) + '.</strong> ' +
        'L’administrateur la vérifie ; elle n’est pas encore visible des partenaires. Toute modification la renvoie à la vérification.');
    }
    return ui.alert('info', '<strong>Brouillon.</strong> Seul vous voyez cette présentation. ' +
      'Publiez-la quand elle est complète : l’administrateur la vérifiera avant toute visibilité auprès des partenaires.');
  }

  async function renderPresentation(el, ctx) {
    /* « nouveau » : Présenter mon projet crée le projet ; sinon on rédige la présentation d'un projet existant. */
    var nouveau = ctx.params.id === 'nouveau';
    var projectId = nouveau ? null : ctx.params.id;
    var projet = null;
    var row = null;
    if (nouveau) {
      row = await loadEnAttente();
    } else {
      projet = await loadProjet(projectId);
      if (!projet) {
        el.innerHTML = ui.header('Présentation du projet', '') + ui.card(null, ui.empty('Ce projet n’existe pas, ou il ne vous appartient pas.'));
        return;
      }
      row = await loadRow(projectId);
    }
    var etablissements = await loadEtablissements();
    var content = (row && row.content) || {};
    var photos = (row && row.photos) || [];
    var urls = await Promise.all(photos.map(function (p) {
      return DP.api.signedUrlFor('visuels', p, 3600).catch(function () { return ''; });
    }));

    var titre = nouveau ? 'Présenter mon projet' : 'Présentation : ' + projet.title;
    var intro = nouveau
      ? 'Rédigez votre projet rubrique par rubrique, de façon claire, concise et précise. Le projet apparaît ensuite dans ' + listeProjets().libelle + '.'
      : 'Rédigez ce projet rubrique par rubrique, en quelques lignes : clair, concis et précis. Le besoin et les rubriques se modifient ici.';
    el.innerHTML = ui.header(titre, intro) +
      (nouveau ? alerteNouveau(row) : statusAlert(row)) +
      '<form class="form" id="f-pres" data-reset="false" novalidate>' +
        '<input type="hidden" name="cible" value="brouillon">' +
        besoinCard(projet, etablissements) +
        SECTIONS.map(function (s, i) {
          return sectionCard(s, i, content[s.key] || '', s.photos ? photosHtml(urls) : '');
        }).join('') +
        '<div class="form-actions">' +
          '<button class="btn btn-outline" type="submit" data-cible="brouillon">Enregistrer comme brouillon</button> ' +
          '<button class="btn btn-primary" type="submit" data-cible="publiee">Publier</button>' +
        '</div>' +
        '<p class="small muted">« Publier » envoie la présentation à l’administrateur pour vérification. Pour publier, toutes les rubriques doivent être remplies ; les photos sont facultatives.</p>' +
      '</form>';

    var form = el.querySelector('#f-pres');
    /* Le bouton cliqué indique si la fiche est enregistrée comme brouillon ou publiée. */
    el.querySelectorAll('[data-cible]').forEach(function (b) {
      b.addEventListener('click', function () { form.elements.cible.value = b.dataset.cible; });
    });

    var binders = [];
    for (var n = 0; n < PHOTO_SLOTS; n++) {
      binders.push(DP.photo.bind(el.querySelector('#pres-photo-' + n), { mode: 'form' }));
    }

    ui.bindForm(form, async function (d) {
      var publier = d.cible === 'publiee';
      verifierRubriques(d, publier);
      if (!String(d.titre || '').trim()) throw new Error('Le titre du projet est obligatoire.');
      if (!(Number(d.amount) > 0)) throw new Error('Le montant doit être supérieur à 0.');
      if (d.currency !== 'USD' && d.currency !== 'FC') throw new Error('Choisissez la devise : USD ou FC.');

      var photosRes = await photosAEnregistrer(binders, photos);
      /* La base enregistre le projet (créé ou modifié) et sa présentation en une seule opération.
         Une présentation rédigée sans projet est reprise à la création. */
      var retour = await DP.api.rpc('presentation_enregistrer', {
        p_projet: nouveau ? null : projectId,
        p_amount: Number(d.amount),
        p_currency: d.currency,
        p_content: contenuDuFormulaire(d),
        p_photos: photosRes.kept,
        p_statut: publier ? 'publiee' : 'brouillon',
        p_sector: d.sector || null,
        p_establishment_id: d.establishment_id || null,
        p_description: d.description || null,
        p_use_of_funds: d.use_of_funds || null,
        p_due_date: d.due_date || null
      });
      supprimerAnciennesPhotos(photosRes.replaced);
      var projetId = typeof retour === 'string' ? retour : (retour && retour.id);
      if (!projetId) throw new Error('Le projet n’a pas pu être enregistré. Réessayez.');

      var message = publier
        ? (nouveau ? 'Projet créé et présentation publiée. L’administrateur va la vérifier.' : 'Présentation publiée. L’administrateur va la vérifier.')
        : (nouveau ? 'Projet créé. Le brouillon de présentation est enregistré.' : 'Brouillon enregistré. Seul vous le voyez.');
      if (nouveau) {
        location.hash = '#/espace/presentation/' + projetId;
      } else {
        DP.navigate();
      }
      return message;
    });
  }

  /* ---------- Lecture d'une présentation (administrateur et partenaire) ---------- */
  /* Pour un partenaire, la rubrique « vision » n'est pas montrée pour l'instant (décision en attente). */
  function readHtml(content, urls, pourPartenaire) {
    var rubriques = SECTIONS.filter(function (s) { return !(pourPartenaire && s.key === 'vision'); });
    return rubriques.map(function (s, i) {
      var text = String(content[s.key] || '').trim();
      var body = text ? '<p class="pre-wrap">' + esc(text) + '</p>' : '<p class="small muted">Non renseigné.</p>';
      var gallery = '';
      if (s.photos && urls && urls.length) {
        gallery = '<div class="gallery">' + urls.map(function (u, n) {
          return '<figure class="gallery-item">' +
            (u ? '<img src="' + esc(u) + '" alt="Photo ' + (n + 1) + '">' : '<div class="gallery-missing">Photo indisponible</div>') +
            '</figure>';
        }).join('') + '</div>';
      }
      return '<h3 class="h-sub">' + (i + 1) + '. ' + esc(s.label) + '</h3>' + body + gallery;
    }).join('');
  }

  var STATUT_ADMIN = {
    publiee: '<span class="badge badge-warn">À vérifier</span>',
    visible: '<span class="badge badge-ok">Visible des partenaires</span>'
  };

  /* ---------- Administrateur : vérifier et rendre visible ---------- */
  async function renderRevue(el) {
    /* Les présentations sans projet (écrites avant la fusion) ne peuvent pas être vérifiées ici : elles sont exclues. */
    var rows = (await DP.api.get('presentations', { select: '*', order: 'updated_at.desc', limit: 300 }))
      .filter(function (r) { return r.project_id; });
    var people = await DP.api.get('profiles', { select: 'id,identifiant,prenom,nom,role', role: 'in.(beneficiary,agent)' });
    var projets = await DP.api.get('projects', { select: 'id,title', limit: 500 });
    var byUser = {};
    people.forEach(function (p) { byUser[p.id] = p; });
    var byProjet = {};
    projets.forEach(function (pj) { byProjet[pj.id] = pj; });

    el.innerHTML = ui.header('Présentations des projets',
        'Une présentation par projet, publiée par le bénéficiaire ou par l’agent porteur du projet. Vérifiez le contenu avant de la rendre visible.') +
      ui.card(null, ui.table([
        { label: 'Porteur', render: function (r) {
          var p = byUser[r.user_id] || {};
          return '<strong>' + esc(p.identifiant || '—') + '</strong><div class="small">' + esc([p.prenom, p.nom].filter(Boolean).join(' ')) + '</div>' +
            '<div class="small muted">' + (p.role === 'agent' ? 'Agent' : 'Bénéficiaire') + '</div>';
        } },
        { label: 'Projet', render: function (r) { var pj = byProjet[r.project_id]; return esc(pj ? pj.title : 'Projet introuvable'); } },
        { label: 'Statut', render: function (r) { return STATUT_ADMIN[r.statut] || ''; } },
        { label: 'Dernière modification', render: function (r) { return ui.dateTime(r.updated_at); } },
        { label: 'Action', cls: 'actions', render: function (r) {
          return '<button class="btn btn-sm btn-outline" type="button" data-revoir="' + esc(r.project_id) + '">Vérifier</button>';
        } }
      ], rows, 'Aucune présentation publiée pour le moment. Les brouillons ne sont pas visibles de l’administrateur.'));

    el.querySelectorAll('[data-revoir]').forEach(function (b) {
      b.addEventListener('click', function () {
        var row = rows.find(function (r) { return r.project_id === b.dataset.revoir; });
        if (row) ouvrirRevue(row, byUser[row.user_id] || {}, (byProjet[row.project_id] || {}).title || '');
      });
    });
  }

  async function ouvrirRevue(row, p, titreProjet) {
    var urls = await Promise.all((row.photos || []).map(function (ph) {
      return DP.api.signedUrlFor('visuels', ph, 3600).catch(function () { return ''; });
    }));
    var visible = row.statut === 'visible';
    var actions = visible
      ? '<button type="button" class="btn btn-outline" data-set="retirer">Retirer la visibilité</button>'
      : '<button type="button" class="btn btn-primary" data-set="visible">Rendre visible aux partenaires</button>';
    var m = ui.modal('Présentation de ' + (p.identifiant || 'ce porteur de projet') + (titreProjet ? ' — ' + titreProjet : ''),
      '<p class="small muted">Statut : ' + (STATUT_ADMIN[row.statut] || '') + ' · Dernière modification : ' + ui.dateTime(row.updated_at) + '</p>' +
        readHtml(row.content || {}, urls),
      actions + ' <button type="button" class="btn btn-ghost" data-close>Fermer</button>');

    m.el.querySelector('[data-set]').addEventListener('click', async function (e) {
      var rendreVisible = e.currentTarget.dataset.set === 'visible';
      if (rendreVisible) {
        var ok = await ui.confirm('Rendre cette présentation visible des partenaires ? Vérifiez tout le contenu avant de confirmer.', 'Rendre visible');
        if (!ok) return;
      }
      try {
        await DP.api.rpc('admin_set_presentation_visibility', { p_project: row.project_id, p_visible: rendreVisible });
        m.close();
        ui.toast(rendreVisible ? 'Présentation visible des partenaires.' : 'Visibilité retirée.', 'ok');
        DP.navigate();
      } catch (err) {
        ui.toast(ui.errMsg(err), 'bad');
      }
    });
  }

  /* ---------- Partenaire : lire la présentation d'un projet disponible ---------- */
  async function montrerPartenaire(projectId) {
    var res = await DP.api.rpc('partner_presentation', { p_project: projectId });
    if (!res) {
      ui.toast('Cette présentation n’est pas disponible.', 'bad');
      return;
    }
    var urls = await Promise.all((res.photos || []).map(function (ph) {
      return DP.api.signedUrlFor('visuels', ph, 3600).catch(function () { return ''; });
    }));
    ui.modal('Présentation du projet',
      '<p class="small muted">Présentation rédigée par le porteur du projet (bénéficiaire ou agent) et vérifiée par l’administrateur de DarajaPlus.</p>' +
      readHtml(res.content || {}, urls, true));
  }

  DP.presentation = { show: montrerPartenaire };

  /* ---------- Routes ---------- */
  DP.register([
    { path: '/espace/presentation/:id', roles: ROLE, title: 'Présenter mon projet', render: renderPresentation },
    /* Ancien lien (une fiche par bénéficiaire) : renvoie à la liste des projets, où chaque projet a sa présentation. */
    { path: '/espace/presentation', roles: ROLE, title: 'Présenter mon projet', render: function () { location.hash = listeProjets().href; } },
    { path: '/admin/presentations', roles: ['admin'], title: 'Présentations', render: renderRevue }
  ]);
})();
