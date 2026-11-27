/* Visite de la Cité 1 DarajaPlus : les établissements, classés par Hôte (zone), puis Agent (quartier),
   puis Bg, Bb et Ba (R1, R2, R3).
   - Ce que chaque compte voit (réponses du promoteur, 26 et 27 nov.) :
       Administrateur : tout, avec les totaux, les propriétaires et la publication aux partenaires ;
       Hôte : les établissements de sa zone ; Agent : ceux de son quartier ;
       Bénéficiaire : toute la Cité 1 ; Partenaire : seulement les établissements rendus publics.
     Tous voient le code, la catégorie et le statut (libre ou occupé). La lecture passe par la vue
     etablissements_visite : aucun propriétaire, aucun nom.
   - Seul l’Administrateur lit la table etablissements (totaux exacts, propriétaires). Il peut rendre public
     un établissement aux partenaires ou le retirer, par la fonction set_etablissement_publie.
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
  var SELECT_ADMIN = SELECT_VISITE + ',nom,publie,owner:profiles!owner_profile_id(prenom,nom,email,code)';
  /* Page affichée (admin : données de la table, pour que la publication soit mise à jour sur place). */
  var courant = null;

  function nomPersonne(p) {
    if (!p) return '—';
    return ([p.prenom, p.nom].filter(Boolean).join(' ')) || p.email || p.code || '—';
  }

  function statut(s) {
    return s === 'occupe' ? '<span class="badge badge-muted">Occupé</span>' : '<span class="badge badge-ok">Libre</span>';
  }

  function intro(role) {
    var base = 'Classés par Hôte (zone), Agent (quartier), puis Bg, Bb et Ba. ';
    var cite = 'La Cité 1 compte 5 000 établissements. ';
    var libreOccupe = 'Vous voyez le code, la catégorie et si l’établissement est libre ou occupé. ';
    var proprietaires = 'Les propriétaires sont réservés à l’Administrateur.';
    if (role === 'admin') {
      return base + cite + 'Vous voyez les totaux exacts, les propriétaires, et les établissements rendus publics aux partenaires.';
    }
    if (role === 'host') return base + 'Vous voyez les établissements de votre zone. ' + libreOccupe + proprietaires;
    if (role === 'agent') return base + 'Vous voyez les établissements de votre quartier. ' + libreOccupe + proprietaires;
    if (role === 'partner') return base + 'Vous voyez les établissements que l’Administrateur a rendus publics. ' + libreOccupe;
    return base + cite + libreOccupe + proprietaires;
  }

  function messageVide(role) {
    if (role === 'partner') return 'Aucun établissement n’est encore rendu public par l’Administrateur.';
    if (role === 'host') return 'Aucune zone ne vous est encore rattachée : aucun établissement à afficher.';
    if (role === 'agent') return 'Aucun quartier ne vous est encore rattaché : aucun établissement à afficher.';
    return 'Les établissements de la Cité 1 ne sont pas encore créés.';
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
      cols.push({ label: 'Rendu public', render: function (e) {
        var publie = e.publie === true;
        return (publie ? '<span class="badge badge-ok">Oui</span>' : '<span class="badge badge-muted">Non</span>') +
          ' <button type="button" class="btn btn-outline" data-publie="' + esc(e.code) + '" data-valeur="' + (publie ? 'false' : 'true') + '">' +
          (publie ? 'Retirer' : 'Rendre public') + '</button>';
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

  /* Redessine le contenu d’un quartier après une publication (les lignes sont partagées avec courant.lignes). */
  async function basculerPublication(bouton) {
    var code = bouton.getAttribute('data-publie');
    var valeur = bouton.getAttribute('data-valeur') === 'true';
    bouton.disabled = true;
    try {
      await DP.api.rpc('set_etablissement_publie', { p_code: code, p_publie: valeur });
    } catch (e) {
      bouton.disabled = false;
      ui.toast((e && e.message) || 'La publication n’a pas pu être modifiée.', 'bad');
      return;
    }
    var ligne = courant.lignes.find(function (e) { return e.code === code; });
    if (ligne) ligne.publie = valeur;
    var quartier = bouton.closest('details[data-index]');
    if (quartier) {
      quartier.querySelector('.cite-corps').innerHTML = corpsQuartier(courant.registre[Number(quartier.dataset.index)], true);
    }
    ui.toast(valeur ? 'Établissement rendu public aux partenaires.' : 'Établissement retiré de la vue des partenaires.', 'ok');
  }

  /* Un seul écouteur pour toute l’application : il ne concerne que la page affichée. */
  document.addEventListener('click', function (ev) {
    var bouton = ev.target && ev.target.closest && ev.target.closest('button[data-publie]');
    if (!bouton || !courant || !courant.admin || !courant.el.contains(bouton)) return;
    basculerPublication(bouton);
  });

  async function renderVisite(el) {
    var role = DP.app.profile.role;
    var admin = DP.app.isAdmin();
    var titre = role === 'beneficiary' ? 'Voir les autres établissements' : 'Visiter la Cité 1 DarajaPlus';
    courant = null;
    el.innerHTML = ui.header(titre, intro(role)) + '<div class="loading" role="status">Chargement…</div>';

    var donnees;
    try {
      donnees = await Promise.all([
        DP.api.get('zones', { select: 'id,name', order: 'id.asc' }),
        DP.api.get('quartiers', { select: 'id,zone_id,name', order: 'id.asc' }),
        lireTout(admin ? 'etablissements' : 'etablissements_visite', admin ? SELECT_ADMIN : SELECT_VISITE)
      ]);
    } catch (e) {
      el.innerHTML = ui.header(titre, intro(role)) +
        ui.card(null, ui.alert('warn', 'La visite de la Cité 1 n’est pas disponible pour le moment. Réessayez plus tard.'));
      return;
    }

    var lignes = donnees[2];
    if (!lignes.length) {
      el.innerHTML = ui.header(titre, intro(role)) + ui.card(null, ui.empty(messageVide(role)));
      return;
    }

    var zones = classer(lignes, donnees[0], donnees[1]);
    var occupes = lignes.filter(function (e) { return e.statut === 'occupe'; }).length;
    var registre = [];
    var haut = ui.header(titre, intro(role)) +
      (admin ? ui.stats([
        ['Établissements', lignes.length, 'Cité 1'],
        ['Occupés', occupes, 'Avec un propriétaire'],
        ['Libres', lignes.length - occupes, 'Disponibles']
      ]) : '');
    el.innerHTML = haut + '<div class="cite-zones">' + zones.map(function (z) { return zoneHtml(z, admin, registre); }).join('') + '</div>';
    courant = { el: el, admin: admin, lignes: lignes, registre: registre };

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
