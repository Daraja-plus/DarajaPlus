/* Fil d'actualités : annonces diffusées et opportunités publiées.
   Présent en bas de la page d'accueil de chaque compte connecté, et dans la page « Actualités ».
   Les droits sont appliqués par la base (politiques RLS) : chacun ne voit que ce qu'il a le droit de lire.
   Le bénéficiaire ne voit en plus que les offres de sa catégorie, comme dans « Opportunités ».
   Lecture seule : ce module ne crée et ne modifie rien. */
(function () {
  var DP = window.DP;
  var esc = DP.ui.esc;
  var ui = DP.ui;
  var ALL_ROLES = ['admin', 'host', 'agent', 'beneficiary', 'partner'];
  var HOME_LIMIT = 5;
  var PAGE_LIMIT = 100;
  var OFFER_TYPE = {
    programme_accompagnement: 'Programme d’accompagnement', appel_projets: 'Appel à projets',
    offre_financement: 'Offre de financement', opportunite_investissement: 'Opportunité d’investissement'
  };
  var FILTERS = [['tout', 'Tout'], ['annonces', 'Annonces'], ['opportunites', 'Opportunités']];

  function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

  /* Catégorie du bénéficiaire connecté (Ba, Bb ou Bg). */
  async function beneficiaryCategory() {
    var rows = await DP.api.get('beneficiaries', { select: 'category', user_id: 'eq.' + DP.api.uid });
    return rows[0] ? rows[0].category : null;
  }

  /* Annonces visibles et offres publiées, fusionnées, les plus récentes d'abord. */
  async function load(limit) {
    var isBen = DP.app.profile && DP.app.profile.role === 'beneficiary';
    var category = isBen ? await beneficiaryCategory() : null;
    var r = await Promise.all([
      DP.api.get('announcements', { select: '*', status: 'eq.visible', order: 'created_at.desc', limit: limit }),
      /* Plus d'offres que nécessaire : le filtre par catégorie peut en écarter. */
      DP.api.get('offers', { select: '*', status: 'eq.published', order: 'created_at.desc', limit: limit * 3 })
    ]);
    var anns = r[0];
    var offers = r[1];
    if (isBen) {
      offers = offers.filter(function (o) {
        return !o.target_category || o.target_category === 'all' || o.target_category === category;
      });
    }
    offers = offers.slice(0, limit);

    /* Nom des partenaires auteurs d'offres ; à défaut, un libellé générique. */
    var partners = {};
    var pIds = offers.filter(function (o) { return o.author_kind === 'partner' && o.partner_id; })
      .map(function (o) { return o.partner_id; });
    if (pIds.length) {
      try {
        var prows = await DP.api.get('partners', { select: 'id,legal_name', id: 'in.(' + Array.from(new Set(pIds)).join(',') + ')' });
        prows.forEach(function (p) { partners[p.id] = p.legal_name; });
      } catch (e) { /* nom indisponible : libellé générique ci-dessous */ }
    }

    var items = anns.map(function (a) { return { kind: 'annonce', at: a.created_at, row: a }; })
      .concat(offers.map(function (o) { return { kind: 'offre', at: o.created_at, row: o }; }));
    items.sort(function (x, y) { return new Date(y.at) - new Date(x.at); });
    return { items: items, partners: partners };
  }

  function author(o, partners) {
    if (o.author_kind === 'partner') return partners[o.partner_id] || 'Partenaire validé';
    if (o.author_kind === 'agent') return 'Publié par un Agent DarajaPlus';
    return 'DarajaPlus';
  }

  function itemHtml(it, partners, full) {
    var x = it.row;
    if (it.kind === 'annonce') {
      var body = x.body || '';
      return '<li class="notif feed-item" data-kind="annonce" data-pub="' + esc(x.id) + '"><div class="notif-main">' +
        '<div class="small muted">Annonce · ' + esc(DP.labels.audience[x.audience] || '') + ' · ' + ui.dateTime(x.created_at) + '</div>' +
        '<strong>' + esc(x.title) + '</strong>' +
        DP.photo.picture('annonces', x.photo_path, 'Photo de l’annonce', 'ann-photo') +
        '<div class="small">' + esc(full ? body : short(body, 220)) + '</div></div></li>';
    }
    var o = x;
    var desc = o.description || '';
    return '<li class="notif feed-item" data-kind="offre" data-pub="' + esc(o.id) + '"><div class="notif-main">' +
      '<div class="small muted">Opportunité · ' + esc(OFFER_TYPE[o.offer_type] || o.offer_type || '') + ' · ' +
      esc(author(o, partners)) + ' · ' + ui.dateTime(o.created_at) + '</div>' +
      '<strong>' + esc(o.title) + '</strong>' +
      '<p class="small">' + esc(full ? desc : short(desc, 220)) + '</p>' +
      '<dl class="kv small">' +
      (o.amount_min || o.amount_max ? '<dt>Montant indicatif</dt><dd>' + esc(ui.money(o.amount_min, o.currency) + ' à ' + ui.money(o.amount_max, o.currency)) + '</dd>' : '') +
      (o.sector ? '<dt>Secteur</dt><dd>' + esc(o.sector) + '</dd>' : '') +
      (o.deadline ? '<dt>Date limite</dt><dd>' + ui.date(o.deadline) + '</dd>' : '') +
      '</dl></div></li>';
  }

  function listHtml(items, partners, full, emptyText) {
    if (!items.length) return ui.empty(emptyText);
    return '<ul class="notif-list">' + items.map(function (it) { return itemHtml(it, partners, full); }).join('') + '</ul>';
  }

  /* Bloc du fil en bas d'une page d'accueil : les dernières publications et un accès à la page complète.
     Ne bloque jamais l'accueil : en cas d'erreur, seul ce bloc affiche un message. */
  async function mount(el) {
    var html;
    try {
      var d = await load(HOME_LIMIT);
      html = ui.card('Fil d’actualités', listHtml(d.items.slice(0, HOME_LIMIT), d.partners, false,
        'Aucune annonce ni opportunité publiée pour le moment.') +
        '<div class="btn-row"><a class="btn btn-outline" href="#/actualites">Voir toutes les actualités</a></div>');
    } catch (e) {
      html = ui.card('Fil d’actualités', ui.alert('warn', 'Le fil d’actualités n’a pas pu être chargé. Rechargez la page dans un instant.'));
    }
    var slot = document.createElement('section');
    slot.className = 'feed-home';
    slot.innerHTML = html;
    el.appendChild(slot);
    DP.photo.hydrate(slot);
    suivreVues(slot);
  }

  /* Page « Actualités » : toutes les annonces et opportunités, avec un filtre (Tout, Annonces, Opportunités). */
  async function renderPage(el, ctx) {
    var type = (ctx.query && ctx.query.get('type')) || 'tout';
    if (!FILTERS.some(function (f) { return f[0] === type; })) type = 'tout';
    var d;
    try {
      d = await load(PAGE_LIMIT);
    } catch (e) {
      el.innerHTML = ui.header('Actualités', '') + ui.alert('warn', 'Les actualités n’ont pas pu être chargées. Rechargez la page dans un instant.');
      return;
    }
    var items = d.items.filter(function (it) {
      return type === 'tout' || (type === 'annonces' ? it.kind === 'annonce' : it.kind === 'offre');
    });
    var tabs = '<nav class="btn-row feed-tabs" aria-label="Filtrer les actualités">' + FILTERS.map(function (f) {
      var on = f[0] === type;
      return '<a class="btn ' + (on ? 'btn-primary' : 'btn-outline') + '" href="#/actualites?type=' + f[0] + '"' +
        (on ? ' aria-current="page"' : '') + '>' + esc(f[1]) + '</a>';
    }).join('') + '</nav>';
    el.innerHTML = ui.header('Actualités', 'Annonces de la plateforme et opportunités publiées, les plus récentes d’abord. Une opportunité n’est pas une promesse de financement.') +
      tabs + ui.card(null, listHtml(items, d.partners, true, 'Aucune actualité pour le moment.'));
    DP.photo.hydrate(el);
    suivreVues(el);
  }

  /* Vues des publications. Une publication compte une vue quand au moins la moitié de sa carte reste affichée
     une seconde. Une personne ne compte qu'une fois par publication, et les envois sont regroupés.
     L'auteur et l'Administrateur ne sont pas comptés : la base l'applique aussi. */
  var VUE_DELAI = 1000;
  var ENVOI_DELAI = 2000;
  var attente = { annonce: [], offre: [] };
  var envoyees = { annonce: {}, offre: {} };
  var envoiPrevu = false;

  async function envoyerVues() {
    envoiPrevu = false;
    var kinds = ['annonce', 'offre'];
    for (var i = 0; i < kinds.length; i++) {
      var kind = kinds[i];
      var ids = attente[kind];
      attente[kind] = [];
      if (!ids.length) continue;
      try {
        await DP.api.rpc('enregistrer_vues', { p_kind: kind, p_ids: ids });
      } catch (e) {
        /* Hors connexion : la publication pourra être comptée au prochain affichage. */
        ids.forEach(function (id) { delete envoyees[kind][id]; });
      }
    }
  }

  function marquerVue(carte) {
    var kind = carte.getAttribute('data-kind');
    var id = carte.getAttribute('data-pub');
    if (!envoyees[kind] || !id || envoyees[kind][id]) return;
    envoyees[kind][id] = true;
    attente[kind].push(id);
    if (!envoiPrevu) { envoiPrevu = true; setTimeout(envoyerVues, ENVOI_DELAI); }
  }

  function suivreVues(racine) {
    if (!racine || !DP.api.uid) return;
    var cartes = racine.querySelectorAll('[data-pub]');
    if (!cartes.length) return;
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(cartes, function (c) { marquerVue(c); });
      return;
    }
    var minuteries = {};
    var observateur = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (e) {
        var carte = e.target;
        var cle = carte.getAttribute('data-kind') + ':' + carte.getAttribute('data-pub');
        if (e.isIntersecting && e.intersectionRatio >= 0.5) {
          if (!minuteries[cle]) {
            minuteries[cle] = setTimeout(function () {
              delete minuteries[cle];
              observateur.unobserve(carte);
              marquerVue(carte);
            }, VUE_DELAI);
          }
        } else if (minuteries[cle]) {
          clearTimeout(minuteries[cle]);
          delete minuteries[cle];
        }
      });
    }, { threshold: [0, 0.5] });
    Array.prototype.forEach.call(cartes, function (c) { observateur.observe(c); });
  }

  /* Nombre de vues par publication, pour les publications dont ce compte peut voir les vues. */
  async function compterVues(kind) {
    var rows = await DP.api.rpc('compter_vues', { p_kind: kind });
    var map = {};
    (Array.isArray(rows) ? rows : []).forEach(function (r) { map[r.publication_id] = Number(r.vues); });
    return map;
  }

  /* Cellule « Vues » d'un tableau. Administrateur (attrAdmin renseigné) : le nombre et le réglage
     « l'auteur voit les vues ». Auteur : le nombre si l'Administrateur l'a autorisé, sinon « Non communiqué ». */
  function celluleVues(map, id, flag, attrAdmin) {
    var n = map[id];
    if (attrAdmin) {
      return '<strong>' + (n === undefined ? 0 : n) + '</strong>' +
        '<div class="small muted">' + (flag ? 'L’auteur voit les vues' : 'L’auteur ne voit pas les vues') + '</div>' +
        '<button class="btn btn-sm btn-outline" type="button" ' + attrAdmin + '="' + esc(id) + '" data-to="' + (flag ? 'false' : 'true') + '">' +
        (flag ? 'Retirer à l’auteur' : 'Autoriser l’auteur') + '</button>';
    }
    return n === undefined ? '<span class="small muted">Non communiqué</span>' : '<strong>' + n + '</strong>';
  }

  DP.register([
    { path: '/actualites', roles: ALL_ROLES, title: 'Actualités', render: renderPage }
  ]);

  DP.feed = { mount: mount, load: load };
  DP.vues = { suivre: suivreVues, compter: compterVues, cellule: celluleVues };
})();
