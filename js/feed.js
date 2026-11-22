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
      return '<li class="notif feed-item"><div class="notif-main">' +
        '<div class="small muted">Annonce · ' + esc(DP.labels.audience[x.audience] || '') + ' · ' + ui.dateTime(x.created_at) + '</div>' +
        '<strong>' + esc(x.title) + '</strong>' +
        DP.photo.picture('annonces', x.photo_path, 'Photo de l’annonce', 'ann-photo') +
        '<div class="small">' + esc(full ? body : short(body, 220)) + '</div></div></li>';
    }
    var o = x;
    var desc = o.description || '';
    return '<li class="notif feed-item"><div class="notif-main">' +
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
  }

  DP.register([
    { path: '/actualites', roles: ALL_ROLES, title: 'Actualités', render: renderPage }
  ]);

  DP.feed = { mount: mount, load: load };
})();
