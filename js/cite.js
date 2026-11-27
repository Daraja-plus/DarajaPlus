/* Visite de la Cité 1 DarajaPlus : les 5 000 établissements, classés par Hôte (zone), puis Agent (quartier),
   puis Bg, Bb et Ba (R1, R2, R3).
   - Tout compte actif (Administrateur, Hôte, Agent, Partenaire, Bénéficiaire) voit le code, la catégorie et le statut
     (libre ou occupé). La lecture passe par la vue etablissements_visite : aucun propriétaire, aucun nom.
   - Seul l’Administrateur voit les totaux exacts et les propriétaires : il lit la table etablissements, que la base
     réserve à son rôle. Les autres comptes ne peuvent pas la lire.
   Les quartiers ne sont dessinés qu’à l’ouverture, pour rester rapides sur téléphone. */
(function () {
  var DP = window.DP;
  var ui = DP.ui;
  var esc = ui.esc;
  var PAGE = 1000;
  var CATEGORIES = ['bg', 'bb', 'ba'];
  var RUE = {
    bg: 'R1 · entreprises moyennes (Gamma)',
    bb: 'R2 · petites entreprises (Bêta)',
    ba: 'R3 · microentreprises (Alpha)'
  };
  var SELECT_VISITE = 'code,zone_id,quartier_id,quartier_rang,rue,categorie,place,ordre,statut';
  var SELECT_ADMIN = SELECT_VISITE + ',nom,owner:profiles!owner_profile_id(prenom,nom,email,code)';

  function nomPersonne(p) {
    if (!p) return '—';
    return ([p.prenom, p.nom].filter(Boolean).join(' ')) || p.email || p.code || '—';
  }

  function statut(s) {
    return s === 'occupe' ? '<span class="badge badge-muted">Occupé</span>' : '<span class="badge badge-ok">Libre</span>';
  }

  function intro(admin) {
    var base = 'Les 5 000 établissements de la Cité 1, classés par Hôte (zone), Agent (quartier), puis Bg, Bb et Ba. ';
    return admin
      ? base + 'Vous voyez les totaux exacts et les propriétaires.'
      : base + 'Vous voyez le code, la catégorie et si l’établissement est libre ou occupé. Les propriétaires sont réservés à l’Administrateur.';
  }

  /* Lit toutes les lignes, par tranches de 1 000 (limite de lecture du serveur). */
  async function lireTout(table, select) {
    var lignes = [];
    for (var debut = 0; ; debut += PAGE) {
      var tranche = await DP.api.get(table, { select: select, order: 'code.asc', limit: PAGE, offset: debut });
      lignes = lignes.concat(tranche);
      if (tranche.length < PAGE) return lignes;
    }
  }

  /* Hôte (zone) → Agent (quartier) → catégories. Les emplacements sont triés par leur ordre de catégorie. */
  function classer(lignes, zones, quartiers) {
    var nomZone = {}, nomQuartier = {};
    zones.forEach(function (z) { nomZone[z.id] = z.name; });
    quartiers.forEach(function (q) { nomQuartier[q.id] = q.name; });
    var parZone = {};
    lignes.forEach(function (e) {
      var z = parZone[e.zone_id] || (parZone[e.zone_id] = {
        id: e.zone_id, nom: nomZone[e.zone_id] || ('Zone ' + e.zone_id), quartiers: {}, occupes: 0, libres: 0
      });
      var q = z.quartiers[e.quartier_id] || (z.quartiers[e.quartier_id] = {
        rang: e.quartier_rang, nom: nomQuartier[e.quartier_id] || '',
        categories: { bg: [], bb: [], ba: [] }, occupes: 0, libres: 0
      });
      q.categories[e.categorie].push(e);
      if (e.statut === 'occupe') { q.occupes++; z.occupes++; } else { q.libres++; z.libres++; }
    });
    return Object.keys(parZone).map(function (k) { return parZone[k]; })
      .sort(function (a, b) { return a.id - b.id; })
      .map(function (z) {
        z.liste = Object.keys(z.quartiers).map(function (k) { return z.quartiers[k]; })
          .sort(function (a, b) { return a.rang - b.rang; });
        z.liste.forEach(function (q) {
          CATEGORIES.forEach(function (c) { q.categories[c].sort(function (a, b) { return a.ordre - b.ordre; }); });
        });
        return z;
      });
  }

  function colonnes(admin) {
    var cols = [
      { label: 'Code', render: function (e) { return '<code>' + esc(e.code) + '</code>'; } },
      { label: 'Catégorie', render: function (e) { return ui.categoryBadge(e.categorie); } },
      { label: 'Statut', render: function (e) { return statut(e.statut); } }
    ];
    if (admin) {
      cols.push({ label: 'Nom de l’établissement', render: function (e) { return e.nom ? esc(e.nom) : '<span class="muted">Non renseigné</span>'; } });
      cols.push({ label: 'Propriétaire', render: function (e) {
        if (!e.owner) return '<span class="muted">—</span>';
        return esc(nomPersonne(e.owner)) + (e.owner.code ? '<div class="small muted">' + esc(e.owner.code) + '</div>' : '');
      } });
    }
    return cols;
  }

  function corpsQuartier(q, admin) {
    return CATEGORIES.map(function (c) {
      return '<h4 class="cite-cat">' + ui.categoryBadge(c) + ' <span class="small muted">' + esc(RUE[c]) + '</span></h4>' +
        ui.table(colonnes(admin), q.categories[c], 'Aucun emplacement.');
    }).join('');
  }

  function bilan(x, admin) {
    return admin ? ' <span class="small muted">— ' + x.occupes + ' occupés, ' + x.libres + ' libres</span>' : '';
  }

  function zoneHtml(z, admin, registre) {
    var quartiers = z.liste.map(function (q) {
      registre.push(q);
      return '<details class="cite-quartier" data-index="' + (registre.length - 1) + '">' +
        '<summary>Quartier ' + esc(q.rang) + (q.nom ? ' · ' + esc(q.nom) : '') + ' · Agent' + bilan(q, admin) + '</summary>' +
        '<div class="cite-corps"></div></details>';
    }).join('');
    return '<details class="cite-zone"><summary>' + esc(z.nom) + ' · Hôte' + bilan(z, admin) + '</summary>' +
      '<div class="cite-quartiers">' + quartiers + '</div></details>';
  }

  async function renderVisite(el) {
    var admin = DP.app.isAdmin();
    var titre = DP.app.profile.role === 'beneficiary' ? 'Voir les autres établissements' : 'Visiter la Cité 1 DarajaPlus';
    el.innerHTML = ui.header(titre, intro(admin)) + '<div class="loading" role="status">Chargement…</div>';

    var donnees;
    try {
      donnees = await Promise.all([
        DP.api.get('zones', { select: 'id,name', order: 'id.asc' }),
        DP.api.get('quartiers', { select: 'id,zone_id,name', order: 'id.asc' }),
        lireTout(admin ? 'etablissements' : 'etablissements_visite', admin ? SELECT_ADMIN : SELECT_VISITE)
      ]);
    } catch (e) {
      el.innerHTML = ui.header(titre, intro(admin)) +
        ui.card(null, ui.alert('warn', 'La visite de la Cité 1 n’est pas disponible pour le moment. Réessayez plus tard.'));
      return;
    }

    var lignes = donnees[2];
    if (!lignes.length) {
      el.innerHTML = ui.header(titre, intro(admin)) +
        ui.card(null, ui.empty('Les établissements de la Cité 1 ne sont pas encore créés.'));
      return;
    }

    var zones = classer(lignes, donnees[0], donnees[1]);
    var occupes = lignes.filter(function (e) { return e.statut === 'occupe'; }).length;
    var registre = [];
    var haut = ui.header(titre, intro(admin)) +
      (admin ? ui.stats([
        ['Établissements', lignes.length, 'Cité 1'],
        ['Occupés', occupes, 'Avec un propriétaire'],
        ['Libres', lignes.length - occupes, 'Disponibles']
      ]) : '');
    el.innerHTML = haut + '<div class="cite-zones">' + zones.map(function (z) { return zoneHtml(z, admin, registre); }).join('') + '</div>';

    /* Le contenu d’un quartier (100 emplacements) n’est dessiné qu’à son ouverture. */
    el.querySelectorAll('details[data-index]').forEach(function (d) {
      d.addEventListener('toggle', function () {
        if (!d.open || d.dataset.rendu) return;
        d.dataset.rendu = '1';
        d.querySelector('.cite-corps').innerHTML = corpsQuartier(registre[Number(d.dataset.index)], admin);
      });
    });
  }

  DP.register([
    { path: '/cite', roles: ['admin', 'host', 'agent', 'partner'], title: 'Visiter la Cité 1 DarajaPlus', render: renderVisite },
    { path: '/espace/etablissements', roles: ['beneficiary'], title: 'Voir les autres établissements', render: renderVisite }
  ]);
})();
