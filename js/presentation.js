/* DarajaPlus — « Présenter mon projet » (espace bénéficiaire).
   Une fiche rédigée rubrique par rubrique, en quelques lignes, avec 1 à 4 photos du produit ou des réalisations.
   Chaque rubrique a une aide et un exemple fictif. La fiche est privée : seul le bénéficiaire la voit pour l'instant
   (l'administrateur et les partenaires n'y ont pas accès ; ce point reste à décider). */
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
    { key: 'vision', label: 'Vision et contact', help: 'Où en sera le projet dans 1 à 3 ans si vous obtenez le financement, et comment vous joindre.',
      example: 'Dans trois ans : quarante kiosques dans deux villes. Contact : nom, téléphone, adresse e-mail.' }
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

  async function renderPresentation(el) {
    var row = await loadRow();
    var content = (row && row.content) || {};
    var photos = (row && row.photos) || [];
    var urls = await Promise.all(photos.map(function (p) {
      return DP.api.signedUrlFor('visuels', p, 3600).catch(function () { return ''; });
    }));

    el.innerHTML = ui.header('Présenter mon projet', 'Rédigez votre projet rubrique par rubrique, en quelques lignes : clair, concis et précis.') +
      ui.alert('info', 'Votre présentation est enregistrée et vous pouvez la modifier à tout moment. Pour le moment, vous seul la voyez.') +
      '<form class="form" id="f-pres" data-reset="false" novalidate>' +
        SECTIONS.map(function (s, i) {
          return sectionCard(s, i, content[s.key] || '', s.photos ? photosHtml(urls) : '');
        }).join('') +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer ma présentation</button></div>' +
      '</form>';

    var binders = [];
    for (var n = 0; n < PHOTO_SLOTS; n++) {
      binders.push(DP.photo.bind(el.querySelector('#pres-photo-' + n), { mode: 'form' }));
    }

    ui.bindForm(el.querySelector('#f-pres'), async function (d) {
      SECTIONS.forEach(function (s) {
        var max = s.key === 'titre' ? TITLE_MAX : TEXT_MAX;
        if ((d[s.key] || '').length > max) {
          throw new Error('« ' + s.label + ' » dépasse ' + max + ' caractères. Raccourcissez le texte.');
        }
      });
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

      var payload = { content: newContent, photos: kept, updated_at: new Date().toISOString() };
      var updated = await DP.api.update('presentations', { user_id: 'eq.' + DP.api.uid }, payload);
      if (!updated || !updated.length) {
        await DP.api.insert('presentations', Object.assign({ user_id: DP.api.uid }, payload));
      }
      /* Anciennes photos remplacées : supprimées du stockage (uniquement celles du dossier du bénéficiaire). */
      var old = replaced.filter(function (p) { return p.indexOf(DP.api.uid + '/') === 0; });
      if (old.length) DP.api.removeFrom('visuels', old).catch(function () {});
      DP.navigate();
      return 'Présentation enregistrée.';
    });
  }

  /* ---------- Routes ---------- */
  DP.register([
    { path: '/espace/presentation', roles: ROLE, title: 'Présenter mon projet', render: renderPresentation }
  ]);
})();
