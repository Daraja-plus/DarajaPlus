/* Client API minimal (sans dépendance) : Auth, PostgREST, RPC et Storage de Supabase. */
(function () {
  var DP = window.DP;
  var KEY = 'daraja.session.v1';
  var session = null;

  function base() { return DP.config.SUPABASE_URL; }
  function anon() { return DP.config.SUPABASE_KEY; }

  function readStorage() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function writeStorage(s) {
    try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch (e) { /* navigation privée */ }
  }
  function setSession(data) {
    if (!data || !data.access_token) { session = null; writeStorage(null); return null; }
    session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user: data.user
    };
    writeStorage(session);
    return session;
  }

  function translate(m) {
    var text = String(m || '');
    var map = {
      'Invalid login credentials': 'E-mail ou mot de passe incorrect.',
      'User already registered': 'Un compte existe déjà avec cette adresse e-mail.',
      'Email not confirmed': 'Adresse e-mail non confirmée. Vérifiez votre boîte de réception.',
      'Password should be at least 6 characters': 'Le mot de passe doit contenir au moins 6 caractères.',
      'For security purposes': 'Pour des raisons de sécurité, patientez quelques instants avant de réessayer.',
      'Failed to fetch': 'Connexion au serveur impossible. Vérifiez votre connexion Internet.',
      'JWT expired': 'Votre session a expiré. Reconnectez-vous.',
      'new row violates row-level security': 'Action non autorisée pour votre compte.'
    };
    for (var k in map) { if (text.indexOf(k) !== -1) return map[k]; }
    return text;
  }

  function parseError(body, status) {
    var raw = (body && (body.message || body.msg || body.error_description || body.error || body.hint)) || ('Erreur ' + status);
    return new Error(translate(raw));
  }

  async function refreshIfNeeded() {
    if (!session) return;
    if (session.expires_at - 60 > Date.now() / 1000) return;
    try {
      var res = await fetch(base() + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { apikey: anon(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) { setSession(null); return; }
      setSession(body);
    } catch (e) { /* hors ligne : on garde la session locale */ }
  }

  async function call(method, url, opts) {
    opts = opts || {};
    await refreshIfNeeded();
    var headers = {
      apikey: anon(),
      Authorization: 'Bearer ' + (session ? session.access_token : anon())
    };
    if (opts.headers) Object.keys(opts.headers).forEach(function (k) { headers[k] = opts.headers[k]; });
    if (opts.body !== undefined && !opts.raw) headers['Content-Type'] = 'application/json';
    if (opts.prefer) headers.Prefer = opts.prefer;
    var res;
    try {
      res = await fetch(url, {
        method: method,
        headers: headers,
        body: opts.body === undefined ? undefined : (opts.raw ? opts.body : JSON.stringify(opts.body))
      });
    } catch (e) {
      throw new Error(translate('Failed to fetch'));
    }
    var text = await res.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) throw parseError(data, res.status);
    return data;
  }

  function qs(params) {
    var usp = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v !== undefined && v !== null && v !== '') usp.append(k, v);
    });
    var s = usp.toString();
    return s ? '?' + s : '';
  }

  /* ---- Fichiers : buckets privés « documents » (pièces) et « visuels » (photos, logos) ---- */
  function uploadTo(bucket, path, file) {
    return call('POST', base() + '/storage/v1/object/' + bucket + '/' + encodeURI(path), {
      body: file, raw: true,
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' }
    });
  }
  async function signedUrlFor(bucket, path, seconds) {
    var r = await call('POST', base() + '/storage/v1/object/sign/' + bucket + '/' + encodeURI(path), { body: { expiresIn: seconds || 300 } });
    return base() + '/storage/v1' + r.signedURL;
  }

  DP.api = {
    translate: translate,
    get session() { return session; },
    get uid() { return session && session.user ? session.user.id : null; },
    get email() { return session && session.user ? session.user.email : null; },
    init: function () { setSession(readStorage()); },

    /* ---- Authentification ---- */
    signIn: async function (email, password) {
      var data = await call('POST', base() + '/auth/v1/token?grant_type=password', { body: { email: email, password: password } });
      setSession(data);
      return data;
    },
    signUp: async function (email, password, meta) {
      var res = await call('POST', base() + '/auth/v1/signup', { body: { email: email, password: password, data: meta || {} } });
      if (res && res.access_token) setSession(res);
      return res;
    },
    signOut: async function () {
      try { if (session) await call('POST', base() + '/auth/v1/logout'); } catch (e) { /* ignoré */ }
      setSession(null);
    },
    resetPassword: function (email) {
      return call('POST', base() + '/auth/v1/recover', { body: { email: email } });
    },
    updatePassword: function (password) {
      return call('PUT', base() + '/auth/v1/user', { body: { password: password } });
    },
    /* Changement d'adresse : Supabase envoie un lien de confirmation à la nouvelle adresse ;
       l'adresse ne change qu'après confirmation. */
    updateEmail: function (email) {
      return call('PUT', base() + '/auth/v1/user', { body: { email: email } });
    },
    /* Lien reçu par e-mail (réinitialisation du mot de passe) : Supabase renvoie les jetons dans l'adresse. */
    adoptRecoveryLink: async function (accessToken, refreshToken, expiresIn) {
      setSession({ access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn });
      var user = await call('GET', base() + '/auth/v1/user');
      if (!user || !user.id) { setSession(null); throw new Error('Lien invalide ou expiré. Demandez un nouveau lien.'); }
      return setSession({ access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, user: user });
    },

    /* ---- Données (PostgREST) : params = { select, colonne: 'eq.valeur', order, limit, offset } ---- */
    get: function (table, params) {
      return call('GET', base() + '/rest/v1/' + table + qs(params));
    },
    insert: function (table, row) {
      return call('POST', base() + '/rest/v1/' + table, { body: row, prefer: 'return=representation' });
    },
    update: function (table, match, patch) {
      return call('PATCH', base() + '/rest/v1/' + table + qs(match), { body: patch, prefer: 'return=representation' });
    },
    remove: function (table, match) {
      return call('DELETE', base() + '/rest/v1/' + table + qs(match), { prefer: 'return=representation' });
    },

    /* ---- Fonctions métier côté serveur ---- */
    rpc: function (name, args) {
      return call('POST', base() + '/rest/v1/rpc/' + name, { body: args || {} });
    },

    /* ---- Pièces privées (bucket « documents ») ---- */
    upload: function (path, file) { return uploadTo('documents', path, file); },
    signedUrl: function (path, seconds) { return signedUrlFor('documents', path, seconds); },

    /* ---- Fichiers d'un bucket donné : « visuels » pour photos de profil et logos d'entreprise ---- */
    uploadTo: uploadTo,
    signedUrlFor: signedUrlFor,
    /* Supprime un ou plusieurs fichiers d'un bucket (la politique n'autorise que le propriétaire du dossier). */
    removeFrom: function (bucket, paths) {
      return call('DELETE', base() + '/storage/v1/object/' + bucket, { body: { prefixes: [].concat(paths) } });
    }
  };
})();
