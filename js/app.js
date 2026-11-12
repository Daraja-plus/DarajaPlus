/* Routeur, garde-fous par rôle, shells (public / espace privé), session, pages communes. */
(function () {
  var DP = window.DP;
  var esc = DP.ui.esc;
  var routes = [];
  var navToken = 0;

  var homes = {
    admin: '#/admin', host: '#/hote', agent: '#/agent',
    beneficiary: '#/espace', partner: '#/partenaire'
  };

  /* Menus des espaces privés (chaque lien correspond à une route enregistrée). */
  var menus = {
    admin: [
      ['Vue générale', '#/admin'], ['Comptes à valider', '#/admin/comptes'], ['Hôtes', '#/admin/hotes'],
      ['Agents', '#/admin/agents'], ['Bénéficiaires', '#/admin/beneficiaires'], ['Partenaires', '#/admin/partenaires'],
      ['Projets & besoins', '#/admin/projets'], ['Ponts / mises en relation', '#/admin/ponts'],
      ['Résultats déclarés', '#/admin/resultats'], ['Offres', '#/admin/offres'], ['Carrefours', '#/admin/carrefours'],
      ['Annonces', '#/admin/annonces'], ['Finances & visibilité', '#/admin/finances'],
      ['Messages privés', '#/admin/messages'], ['Contacts', '#/admin/contacts'], ['Territoires', '#/admin/territoires'],
      ['Audit', '#/admin/audit'], ['Configuration', '#/admin/configuration'],
      ['Notifications', '#/notifications'], ['Mon compte', '#/mon-compte']
    ],
    host: [
      ['Tableau de zone', '#/hote'], ['Agents', '#/hote/agents'], ['Bénéficiaires', '#/hote/beneficiaires'],
      ['Dossiers & projets', '#/hote/dossiers'], ['Ponts', '#/hote/ponts'], ['Carrefours', '#/hote/carrefours'],
      ['Annonces', '#/hote/annonces'], ['Messages (Administrateur)', '#/messages'],
      ['Notifications', '#/notifications'], ['Mon compte', '#/mon-compte']
    ],
    agent: [
      ['Accueil', '#/agent'], ['Mes bénéficiaires', '#/agent/beneficiaires'], ['Catégories à proposer', '#/agent/categories'], ['Nouveau bénéficiaire', '#/agent/beneficiaires/nouveau'],
      ['Projets & besoins', '#/agent/projets'], ['Publications', '#/agent/offres'], ['Carrefours', '#/agent/carrefours'],
      ['Annonces', '#/agent/annonces'], ['Visibilité', '#/agent/visibilite'], ['Messages (Administrateur)', '#/messages'],
      ['Notifications', '#/notifications'], ['Mon compte', '#/mon-compte']
    ],
    beneficiary: [
      ['Mon tableau de bord', '#/espace'], ['Ma catégorie', '#/espace/categorie'], ['Mon profil', '#/espace/profil'],
      ['Mes entreprises', '#/espace/entreprises'], ['Mes projets & besoins', '#/espace/projets'],
      ['Mes dossiers', '#/espace/dossiers'], ['Opportunités', '#/espace/opportunites'], ['Carrefours', '#/espace/carrefours'],
      ['Visibilité', '#/espace/visibilite'], ['Messages (Administrateur)', '#/messages'],
      ['Notifications', '#/notifications'], ['Mon compte', '#/mon-compte']
    ],
    partner: [
      ['Accueil', '#/partenaire'], ['Mon profil', '#/partenaire/profil'], ['Mes offres', '#/partenaire/offres'],
      ['Rechercher des projets', '#/partenaire/recherche'], ['Mes dossiers', '#/partenaire/dossiers'],
      ['Messages (Administrateur)', '#/messages'], ['Notifications', '#/notifications'], ['Mon compte', '#/mon-compte']
    ]
  };

  var publicNav = [
    ['Accueil', '#/'], ['Fonctionnement', '#/fonctionnement'], ['Bénéficiaires', '#/beneficiaires'],
    ['Partenaires', '#/partenaires'], ['Carrefours', '#/carrefours'], ['Tarifs', '#/tarifs'],
    ['FAQ', '#/faq'], ['Contact', '#/contact']
  ];

  /* ---------- Routes ---------- */
  function toRegex(path) {
    var keys = [];
    var re = path.replace(/\/:([a-zA-Z]+)/g, function (_, k) { keys.push(k); return '/([^/]+)'; });
    return { re: new RegExp('^' + re + '/?$'), keys: keys };
  }

  /* def = { path, public: bool, roles: [...], title, render(el, ctx) } */
  DP.route = function (def) {
    var m = toRegex(def.path);
    routes.push({ def: def, re: m.re, keys: m.keys });
  };
  DP.register = function (list) { list.forEach(DP.route); };

  function find(path) {
    for (var i = 0; i < routes.length; i++) {
      var m = path.match(routes[i].re);
      if (m) {
        var params = {};
        routes[i].keys.forEach(function (k, idx) { params[k] = decodeURIComponent(m[idx + 1]); });
        return { route: routes[i].def, params: params };
      }
    }
    return null;
  }

  /* Adapte un lien enregistré en base (ex. mise en relation) au rôle du destinataire. */
  function resolveLink(link, role) {
    if (!link) return DP.app.homeFor(role);
    if (link.indexOf('/mises-en-relation') !== -1) {
      var map = { admin: '#/admin/ponts', host: '#/hote/ponts', agent: '#/agent', beneficiary: '#/espace/dossiers', partner: '#/partenaire/dossiers' };
      return map[role] || DP.app.homeFor(role);
    }
    return link;
  }

  /* ---------- Session et profil ---------- */
  DP.app = {
    profile: null,
    async loadProfile() {
      if (!DP.api.uid) { this.profile = null; return null; }
      var rows = await DP.api.get('profiles', { select: '*', id: 'eq.' + DP.api.uid });
      this.profile = rows && rows[0] ? rows[0] : null;
      return this.profile;
    },
    homeFor(role) { return homes[role] || '#/'; },
    isAdmin() { return !!(this.profile && this.profile.role === 'admin'); },
    displayName(p) {
      p = p || this.profile;
      if (!p) return '';
      return ((p.prenom || '') + ' ' + (p.nom || '')).trim() || p.email || '';
    },
    async afterLogin(next) {
      var p = await this.loadProfile();
      if (!p) {
        await DP.api.signOut();
        throw new Error('Profil introuvable pour ce compte. Contactez l’administrateur.');
      }
      var target;
      if (p.role !== 'admin' && p.status !== 'active') target = '#/en-attente';
      else if (next && next.charAt(0) === '/' && next.indexOf('/connexion') !== 0 && next.indexOf('/inscription') !== 0) target = '#' + next;
      else target = this.homeFor(p.role);
      location.hash = target;
      await navigate();
    },
    async logout() {
      await DP.api.signOut();
      this.profile = null;
      location.hash = '#/';
      await navigate();
    },
    async unreadCount() {
      if (!DP.api.uid) return 0;
      try {
        var rows = await DP.api.get('notifications', { select: 'id', recipient_id: 'eq.' + DP.api.uid, read_at: 'is.null', limit: 100 });
        return rows.length;
      } catch (e) { return 0; }
    }
  };

  /* ---------- Messagerie privée (utilisateur <-> Administrateur uniquement) ---------- */
  function bubble(m, isAdmin, title) {
    var mine = isAdmin ? !!m.from_admin : !m.from_admin;
    var who = mine ? 'Vous' : (m.from_admin ? 'Administrateur général' : (title || 'Utilisateur'));
    return '<div class="bubble ' + (mine ? 'me' : 'them') + '"><div class="bubble-who">' + esc(who) + ' · ' + DP.ui.dateTime(m.created_at) +
      '</div><div class="bubble-body">' + esc(m.body).replace(/\n/g, '<br>') + '</div></div>';
  }

  DP.messages = {
    /* opts: { title, header } ; userId = propriétaire du fil */
    async thread(el, userId, opts) {
      opts = opts || {};
      var isAdmin = DP.app.isAdmin();
      var me = DP.api.uid;
      var msgs = await DP.api.get('messages', { select: '*', thread_user_id: 'eq.' + userId, order: 'created_at.asc', limit: 300 });
      try {
        if (isAdmin) await DP.api.update('messages', { thread_user_id: 'eq.' + userId, from_admin: 'eq.false', read_by_admin: 'eq.false' }, { read_by_admin: true });
        else await DP.api.update('messages', { thread_user_id: 'eq.' + userId, from_admin: 'eq.true', read_by_user: 'eq.false' }, { read_by_user: true });
      } catch (e) { /* lecture non bloquante */ }
      el.innerHTML = (opts.header || '') +
        '<div class="card"><div class="card-body"><div class="thread" aria-live="polite">' +
        (msgs.length ? msgs.map(function (m) { return bubble(m, isAdmin, opts.title); }).join('') :
          DP.ui.empty(isAdmin ? 'Aucun message de cet utilisateur.' : 'Aucun message pour le moment. Écrivez à l’Administrateur général.')) +
        '</div>' +
        '<form class="form thread-form" autocomplete="off"><div class="field field-full">' +
        '<label for="msg-body">Votre message</label>' +
        '<textarea id="msg-body" name="body" class="input" rows="3" maxlength="2000" required placeholder="Écrivez ici…"></textarea>' +
        '<div class="hint">Message privé : visible uniquement par vous et l’Administrateur général. Ne partagez pas de mot de passe.</div></div>' +
        '<div class="form-actions"><button type="submit" class="btn btn-primary">Envoyer</button></div></form></div></div>';
      var box = el.querySelector('.thread');
      if (box) box.scrollTop = box.scrollHeight;
      var form = el.querySelector('.thread-form');
      DP.ui.bindForm(form, async function (data) {
        if (!data.body) throw new Error('Le message est vide.');
        await DP.api.insert('messages', {
          thread_user_id: userId, from_user_id: me, from_admin: isAdmin, body: data.body,
          read_by_admin: isAdmin, read_by_user: !isAdmin
        });
        await DP.messages.thread(el, userId, opts);
        return 'Message envoyé.';
      });
    }
  };

  /* ---------- Pages communes ---------- */
  var ALL = ['admin', 'host', 'agent', 'beneficiary', 'partner'];

  DP.register([
    {
      path: '/notifications', roles: ALL, title: 'Notifications',
      render: async function (el) {
        var rows = await DP.api.get('notifications', { select: '*', recipient_id: 'eq.' + DP.api.uid, order: 'created_at.desc', limit: 100 });
        var unread = rows.filter(function (r) { return !r.read_at; }).length;
        var role = DP.app.profile.role;
        el.innerHTML = DP.ui.header('Notifications', unread ? unread + ' non lue(s)' : 'Tout est lu',
          unread ? '<button class="btn btn-outline" type="button" data-read-all>Tout marquer comme lu</button>' : '') +
          DP.ui.card(null, rows.length ? '<ul class="notif-list">' + rows.map(function (n) {
            return '<li class="notif' + (n.read_at ? '' : ' unread') + '"><div class="notif-main"><strong>' + esc(n.title) + '</strong>' +
              (n.body ? '<div class="small">' + esc(n.body) + '</div>' : '') +
              '<div class="small muted">' + DP.ui.dateTime(n.created_at) + '</div></div>' +
              '<a class="btn btn-sm btn-outline" href="' + esc(resolveLink(n.link, role)) + '" data-mark="' + esc(n.id) + '">Ouvrir</a></li>';
          }).join('') + '</ul>' : DP.ui.empty('Aucune notification pour le moment.'));
        el.querySelectorAll('[data-mark]').forEach(function (a) {
          a.addEventListener('click', async function () {
            try { await DP.api.update('notifications', { id: 'eq.' + a.dataset.mark }, { read_at: new Date().toISOString() }); } catch (e) { /* ignoré */ }
          });
        });
        var all = el.querySelector('[data-read-all]');
        if (all) all.addEventListener('click', async function () {
          try {
            await DP.api.update('notifications', { recipient_id: 'eq.' + DP.api.uid, read_at: 'is.null' }, { read_at: new Date().toISOString() });
            DP.ui.toast('Notifications marquées comme lues.', 'ok');
            navigate();
          } catch (e) { DP.ui.toast(DP.ui.errMsg(e), 'bad'); }
        });
      }
    },
    {
      path: '/messages', roles: ['host', 'agent', 'beneficiary', 'partner'], title: 'Messages privés',
      render: async function (el, ctx) {
        await DP.messages.thread(el, DP.api.uid, {
          title: 'Administrateur général',
          header: DP.ui.header('Messages privés', 'Échanges privés avec l’Administrateur général. Aucun message direct entre comptes.')
        });
      }
    },
    {
      path: '/mon-compte', roles: ALL, title: 'Mon compte',
      render: async function (el, ctx) {
        var p = DP.app.profile;
        el.innerHTML = DP.ui.header('Mon compte', 'Vos informations personnelles et votre mot de passe') +
          '<div class="grid-2">' +
          DP.ui.card('Informations', '<form class="form" id="f-profile">' +
            '<div class="field-row">' + DP.ui.field({ name: 'nom', label: 'Nom', value: p.nom, required: true }) +
            DP.ui.field({ name: 'postnom', label: 'Post-nom', value: p.postnom, required: true }) + '</div>' +
            DP.ui.field({ name: 'prenom', label: 'Prénom', value: p.prenom, required: true }) +
            DP.ui.field({ name: 'phone', label: 'Téléphone', value: p.phone, placeholder: '+243…', hint: 'Facultatif sauf indication contraire.' }) +
            '<div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer</button></div></form>' +
            '<p class="small muted">Adresse e-mail : ' + esc(p.email || '—') + ' · Rôle : ' + esc(DP.labels.role[p.role]) +
            (p.code ? ' · Identifiant : ' + esc(p.code) : '') + '</p>') +
          DP.ui.card('Mot de passe', '<form class="form" id="f-pw">' +
            DP.ui.field({ name: 'password', label: 'Nouveau mot de passe', type: 'password', required: true, hint: 'Au moins 6 caractères (8 recommandés).' }) +
            DP.ui.field({ name: 'confirm', label: 'Confirmer le mot de passe', type: 'password', required: true }) +
            '<div class="form-actions"><button class="btn btn-primary" type="submit">Changer le mot de passe</button></div></form>') +
          '</div>';
        DP.ui.bindForm(el.querySelector('#f-profile'), async function (data) {
          await DP.api.update('profiles', { id: 'eq.' + DP.api.uid }, { nom: data.nom, postnom: data.postnom, prenom: data.prenom, phone: data.phone || null });
          await DP.app.loadProfile();
          return 'Informations enregistrées.';
        });
        DP.ui.bindForm(el.querySelector('#f-pw'), async function (data) {
          if (data.password.length < 6) throw new Error('Le mot de passe doit contenir au moins 6 caractères.');
          if (data.password !== data.confirm) throw new Error('Les deux mots de passe ne correspondent pas.');
          await DP.api.updatePassword(data.password);
          return 'Mot de passe modifié.';
        });
      }
    }
  ]);

  /* ---------- Shells et navigation ---------- */
  function publicTopbar() {
    return '<div class="topbar-inner"><a class="brand" href="#/" aria-label="DarajaPlus, accueil">' +
      '<img src="assets/logo-daraja.png" alt="" class="logo" width="40" height="40"><span>DarajaPlus</span></a>' +
      '<nav class="topnav" aria-label="Navigation principale">' +
      publicNav.map(function (n) { return '<a href="' + n[1] + '">' + esc(n[0]) + '</a>'; }).join('') + '</nav>' +
      '<div class="topbar-actions">' +
      (DP.api.uid ? '<a class="btn btn-primary btn-sm" href="' + esc(DP.app.homeFor(DP.app.profile && DP.app.profile.role)) + '">Mon espace</a>' :
        '<a class="btn btn-outline btn-sm" href="#/connexion">Connexion</a> <a class="btn btn-primary btn-sm" href="#/inscription">Inscription</a>') +
      '</div></div>';
  }

  function privateTopbar(profile, unread) {
    return '<div class="topbar-inner"><a class="brand" href="' + esc(DP.app.homeFor(profile.role)) + '" aria-label="DarajaPlus, mon espace">' +
      '<img src="assets/logo-daraja.png" alt="" class="logo" width="40" height="40"><span>DarajaPlus</span></a>' +
      '<div class="topbar-actions">' +
      '<span class="who"><strong>' + esc(DP.app.displayName(profile)) + '</strong><span class="muted small">' +
      esc(DP.labels.role[profile.role]) + (profile.category ? ' · ' + esc(DP.labels.category[profile.category]) : '') + '</span></span>' +
      '<a class="icon-btn" href="#/notifications" aria-label="Notifications (' + unread + ' non lues)">🔔' +
      (unread ? '<span class="count">' + (unread > 99 ? '99+' : unread) + '</span>' : '') + '</a>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-logout>Déconnexion</button>' +
      '</div></div>';
  }

  function sideHtml(profile, unread) {
    var cur = location.hash.split('?')[0];
    var items = (menus[profile.role] || []).map(function (m) {
      var active = cur === m[1] || (m[1].split('/').length > 2 && cur.indexOf(m[1] + '/') === 0);
      var count = m[1] === '#/notifications' && unread ? ' <span class="count">' + (unread > 99 ? '99+' : unread) + '</span>' : '';
      return '<a href="' + m[1] + '"' + (active ? ' class="active" aria-current="page"' : '') + '>' + esc(m[0]) + count + '</a>';
    }).join('');
    return '<aside class="sidebar" aria-label="Menu de l’espace"><div class="side-role">' + esc(DP.labels.role[profile.role]) +
      '</div><nav class="side-nav">' + items + '</nav></aside>';
  }

  function footerHtml() {
    return '<footer class="site-footer"><div class="footer-inner"><div><strong>DarajaPlus</strong> — DarajaPlus facilite la mise en relation. ' +
      'Il ne garantit aucun financement : le partenaire reste seul décideur.</div>' +
      '<nav aria-label="Pied de page"><a href="#/mentions">Mentions légales</a> <a href="#/mentions">Confidentialité</a> ' +
      '<a href="#/a-propos">À propos</a> <a href="#/contact">Contact</a></nav>' +
      '<div class="small muted">Inscription gratuite pour les bénéficiaires et les partenaires.</div></div></footer>';
  }

  async function navigate() {
    var token = ++navToken;
    var hash = location.hash || '#/';
    var parts = hash.slice(1).split('?');
    var path = (parts[0] || '/').replace(/\/+$/, '') || '/';
    var query = new URLSearchParams(parts[1] || '');
    var app = document.getElementById('app');
    var topbar = document.getElementById('topbar');
    var found = find(path);

    if (!DP.api.uid) DP.app.profile = null;
    var profile = null;
    if (DP.api.uid) {
      try { profile = DP.app.profile || await DP.app.loadProfile(); } catch (e) { profile = null; }
      if (token !== navToken) return;
    }

    if (!found) {
      topbar.innerHTML = publicTopbar();
      app.innerHTML = '<section class="view public-view" id="view"></section>' + footerHtml();
      document.getElementById('view').innerHTML = '<div class="empty big">Cette page n’existe pas. <a href="#/">Retour à l’accueil</a></div>';
      return;
    }

    var route = found.route;
    if (!route.public) {
      if (!DP.api.uid) { location.hash = '#/connexion?next=' + encodeURIComponent(path); return; }
      if (!profile) {
        topbar.innerHTML = publicTopbar();
        app.innerHTML = '<section class="view public-view" id="view"></section>' + footerHtml();
        document.getElementById('view').innerHTML = DP.ui.alert('warn', 'Profil introuvable pour ce compte. Contactez l’administrateur.') +
          '<button class="btn btn-outline" type="button" data-logout>Se déconnecter</button>';
        return;
      }
      if (profile.role !== 'admin' && profile.status !== 'active') {
        location.hash = '#/en-attente';
        return;
      }
      if (route.roles && route.roles.indexOf(profile.role) === -1) {
        location.hash = DP.app.homeFor(profile.role);
        return;
      }
    }

    var priv = !route.public && profile;
    var unread = priv ? await DP.app.unreadCount() : 0;
    if (token !== navToken) return;

    if (priv) {
      topbar.innerHTML = privateTopbar(profile, unread);
      app.innerHTML = '<div class="shell">' + sideHtml(profile, unread) + '<section class="view" id="view" tabindex="-1"></section></div>';
    } else {
      topbar.innerHTML = publicTopbar();
      app.innerHTML = '<section class="view public-view" id="view" tabindex="-1"></section>' + footerHtml();
    }

    var view = document.getElementById('view');
    try {
      await route.render(view, { params: found.params, query: query, path: path, profile: profile });
    } catch (e) {
      if (token === navToken) view.innerHTML = DP.ui.errorBox(e);
    }
    if (token === navToken && priv) await validationBanner(view, token);
    if (token === navToken) window.scrollTo(0, 0);
  }

  /* Confirmation de validation : tant que la personne n'a pas accusé réception, la date et l'heure
     de validation s'affichent en haut de son espace. La notification reste dans « Notifications ». */
  async function validationBanner(view, token) {
    if (!DP.api.uid) return;
    var rows = [];
    try {
      rows = await DP.api.get('notifications', { select: 'id,body,link', recipient_id: 'eq.' + DP.api.uid,
        kind: 'eq.compte_valide', read_at: 'is.null', order: 'created_at.desc', limit: 1 });
    } catch (e) { return; }
    if (token !== navToken || !rows.length) return;
    var n = rows[0];
    var box = document.createElement('div');
    box.className = 'validation-banner';
    /* Le lien de la notification mène à la première étape (pour un bénéficiaire : le choix de catégorie). */
    var next = n.link && n.link.indexOf('#/') === 0 ? n.link : '';
    box.innerHTML = DP.ui.alert('ok', '<strong>Votre compte est validé.</strong><br>' + esc(n.body) +
      '<div class="btn-row">' +
        (next ? '<a class="btn btn-sm btn-primary" href="' + esc(next) + '">' + (next === '#/espace/categorie' ? 'Choisir ma catégorie' : 'Continuer') + '</a>' : '') +
        '<button class="btn btn-sm btn-outline" type="button" data-ack-validation="' + esc(n.id) + '">J’ai compris</button>' +
      '</div>');
    view.insertBefore(box, view.firstChild);
    var btn = box.querySelector('[data-ack-validation]');
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      try {
        await DP.api.update('notifications', { id: 'eq.' + n.id }, { read_at: new Date().toISOString() });
        box.remove();
      } catch (e) { btn.disabled = false; DP.ui.toast(DP.ui.errMsg(e), 'bad'); }
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-logout]');
    if (b) { e.preventDefault(); DP.app.logout(); }
  });

  DP.navigate = navigate;

  /* Retour d'un lien e-mail (réinitialisation du mot de passe) : on ouvre une session à partir des jetons
     contenus dans l'adresse, on efface les jetons de l'adresse, puis on envoie l'utilisateur vers « Mon compte »
     pour qu'il choisisse son nouveau mot de passe. */
  async function handleAuthLink() {
    var h = location.hash || '';
    if (h.indexOf('access_token=') === -1) return;
    var p = new URLSearchParams(h.replace(/^#/, ''));
    var access = p.get('access_token');
    var refresh = p.get('refresh_token');
    var expiresIn = parseInt(p.get('expires_in'), 10) || 3600;
    history.replaceState(null, '', location.pathname + location.search + '#/mon-compte');
    if (!access) return;
    try {
      await DP.api.adoptRecoveryLink(access, refresh, expiresIn);
      DP.app.profile = null;
      DP.ui.toast('Choisissez votre nouveau mot de passe ci-dessous, puis enregistrez.', 'ok');
    } catch (e) {
      DP.ui.toast(DP.api.translate(e && e.message) || 'Lien invalide ou expiré.', 'bad');
      location.hash = '#/mot-de-passe-oublie';
    }
  }

  DP.start = async function () {
    DP.api.init();
    window.addEventListener('hashchange', navigate);
    await handleAuthLink();
    if (!location.hash) location.hash = '#/';
    await navigate();
  };
})();
