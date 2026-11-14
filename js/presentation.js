/* DarajaPlus — « Présenter mon projet » (espace bénéficiaire).
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
  var ROLE = ['beneficiary'];
  var TITLE_MAX = 120;
  var TEXT_MAX = 600;
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
    { key: 'vision', label: 'Vision et contact', help: 'Où en sera le projet dans 1 à 3 ans si vous obtenez le financement. Vos coordonnées (téléphone, e-mail, adresse) ne sont pas montrées aux partenaires avant la conclusion du marché.',
      example: 'Dans trois ans : quarante kiosques dans deux villes.' }
  ];

  /* Ma fiche de présentation (une seule par bénéficiaire). */
  async function loadRow() {
    var rows = await DP.api.get('presentations', { select: '*', user_id: 'eq.' + DP.api.uid });
    return rows[0] || null;
  }

  function fieldFor(s, value) {
    if (s.key === 'titre') {
      return ui.field({ name: s.key, label: 'Votre réponse', value: value, placeholder: 'Nom du projet',
        hint: 'Une ligne, ' + TITLE_MAX + ' caractères maximum.' });
    }
    return ui.field({ name: s.key, label: 'Votre réponse', type: 'textarea', rows: 4, value: value,
      hint: 'Quelques lignes, ' + TEXT_MAX + ' caractères maximum.' });
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

  async function renderPresentation(el) {
    var row = await loadRow();
    var content = (row && row.content) || {};
    var photos = (row && row.photos) || [];
    var urls = await Promise.all(photos.map(function (p) {
      return DP.api.signedUrlFor('visuels', p, 3600).catch(function () { return ''; });
    }));

    el.innerHTML = ui.header('Présenter mon projet', 'Rédigez votre projet rubrique par rubrique, en quelques lignes : clair, concis et précis.') +
      statusAlert(row) +
      '<form class="form" id="f-pres" data-reset="false" novalidate>' +
        '<input type="hidden" name="cible" value="brouillon">' +
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
      var newContent = {};
      SECTIONS.forEach(function (s) { newContent[s.key] = d[s.key] || ''; });

      /* Une photo choisie remplace celle de son emplacement ; sinon l'ancienne est gardée. */
      var kept = [];
      var replaced = [];
      for (var k = 0; k < PHOTO_SLOTS; k++) {
        var file = binders[k].file();
        if (file) {
          kept.push(await DP.photo.upload(file));
          if (photos[k]) replaced.push(photos[k]);
        } else if (photos[k]) {
          kept.push(photos[k]);
        }
      }

      var payload = { content: newContent, photos: kept, statut: publier ? 'publiee' : 'brouillon', updated_at: new Date().toISOString() };
      var updated = await DP.api.update('presentations', { user_id: 'eq.' + DP.api.uid }, payload);
      if (!updated || !updated.length) {
        await DP.api.insert('presentations', Object.assign({ user_id: DP.api.uid }, payload));
      }
      /* Anciennes photos remplacées : supprimées du stockage (uniquement celles du dossier du bénéficiaire). */
      var old = replaced.filter(function (p) { return p.indexOf(DP.api.uid + '/') === 0; });
      if (old.length) DP.api.removeFrom('visuels', old).catch(function () {});
      DP.navigate();
      return publier
        ? 'Présentation publiée. L’administrateur va la vérifier.'
        : 'Brouillon enregistré. Seul vous le voyez.';
    });
  }

  /* ---------- Lecture d'une présentation (administrateur et partenaire) ---------- */
  /* Pour un partenaire, la rubrique « vision » (vision et contact) n'est jamais montrée. */
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
    var rows = await DP.api.get('presentations', { select: '*', order: 'updated_at.desc', limit: 300 });
    var people = await DP.api.get('profiles', { select: 'id,identifiant,prenom,nom', role: 'eq.beneficiary' });
    var byUser = {};
    people.forEach(function (p) { byUser[p.id] = p; });

    el.innerHTML = ui.header('Présentations des projets',
        'Présentations publiées par les bénéficiaires. Vérifiez le contenu avant de la rendre visible : la rubrique « Vision et contact » peut contenir des coordonnées.') +
      ui.card(null, ui.table([
        { label: 'Bénéficiaire', render: function (r) {
          var p = byUser[r.user_id] || {};
          return '<strong>' + esc(p.identifiant || '—') + '</strong><div class="small">' + esc([p.prenom, p.nom].filter(Boolean).join(' ')) + '</div>';
        } },
        { label: 'Titre', render: function (r) { return esc((r.content && r.content.titre) || 'Sans titre'); } },
        { label: 'Statut', render: function (r) { return STATUT_ADMIN[r.statut] || ''; } },
        { label: 'Dernière modification', render: function (r) { return ui.dateTime(r.updated_at); } },
        { label: 'Action', cls: 'actions', render: function (r) {
          return '<button class="btn btn-sm btn-outline" type="button" data-revoir="' + esc(r.user_id) + '">Vérifier</button>';
        } }
      ], rows, 'Aucune présentation publiée pour le moment. Les brouillons ne sont pas visibles de l’administrateur.'));

    el.querySelectorAll('[data-revoir]').forEach(function (b) {
      b.addEventListener('click', function () {
        var row = rows.find(function (r) { return r.user_id === b.dataset.revoir; });
        if (row) ouvrirRevue(row, byUser[row.user_id] || {});
      });
    });
  }

  async function ouvrirRevue(row, p) {
    var urls = await Promise.all((row.photos || []).map(function (ph) {
      return DP.api.signedUrlFor('visuels', ph, 3600).catch(function () { return ''; });
    }));
    var visible = row.statut === 'visible';
    var actions = visible
      ? '<button type="button" class="btn btn-outline" data-set="retirer">Retirer la visibilité</button>'
      : '<button type="button" class="btn btn-primary" data-set="visible">Rendre visible aux partenaires</button>';
    var m = ui.modal('Présentation de ' + (p.identifiant || 'ce bénéficiaire'),
      '<p class="small muted">Statut : ' + (STATUT_ADMIN[row.statut] || '') + ' · Dernière modification : ' + ui.dateTime(row.updated_at) + '</p>' +
        readHtml(row.content || {}, urls),
      actions + ' <button type="button" class="btn btn-ghost" data-close>Fermer</button>');

    m.el.querySelector('[data-set]').addEventListener('click', async function (e) {
      var rendreVisible = e.currentTarget.dataset.set === 'visible';
      if (rendreVisible) {
        var ok = await ui.confirm('Rendre cette présentation visible des partenaires ? Vérifiez tout le contenu, en particulier la rubrique « Vision et contact ».', 'Rendre visible');
        if (!ok) return;
      }
      try {
        await DP.api.rpc('admin_set_presentation_visibility', { p_user: row.user_id, p_visible: rendreVisible });
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
      '<p class="small muted">Présentation rédigée par le bénéficiaire et vérifiée par l’administrateur de DarajaPlus.</p>' +
      readHtml(res.content || {}, urls, true));
  }

  DP.presentation = { show: montrerPartenaire };

  /* ---------- Routes ---------- */
  DP.register([
    { path: '/espace/presentation', roles: ROLE, title: 'Présenter mon projet', render: renderPresentation },
    { path: '/admin/presentations', roles: ['admin'], title: 'Présentations', render: renderRevue }
  ]);
})();
