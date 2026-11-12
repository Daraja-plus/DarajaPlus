/* Notifications sur téléphone (Web Push) : activation, désactivation et gestion de l'appareil.
   Le message reçu reste générique : l'utilisateur ouvre l'application pour lire le détail. */
(function () {
  var DP = window.DP;
  var esc = DP.ui.esc;

  function isIos() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isInstalled() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }
  function hasPush() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('Délai dépassé. Réessayez.')); }, ms);
    })]);
  }
  function keyToBytes(b64) {
    var pad = '='.repeat((4 - (b64.length % 4)) % 4);
    var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  async function currentSubscription() {
    var reg = await withTimeout(navigator.serviceWorker.ready, 5000);
    return reg.pushManager.getSubscription();
  }

  /* État de l'appareil : unsupported | ios-browser | denied | on | off */
  async function status() {
    if (isIos() && !isInstalled()) return 'ios-browser';
    if (!hasPush()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    var sub = await currentSubscription();
    return sub ? 'on' : 'off';
  }

  async function enable() {
    if (!DP.api.uid) throw new Error('Connexion requise.');
    var permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Notifications non autorisées. Vous pourrez les activer plus tard dans les réglages du navigateur.');
    }
    var reg = await withTimeout(navigator.serviceWorker.ready, 5000);
    var sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyToBytes(DP.config.VAPID_PUBLIC_KEY)
      });
    }
    var json = sub.toJSON();
    try {
      await DP.api.rpc('push_register_subscription', {
        p_endpoint: json.endpoint,
        p_p256dh: json.keys.p256dh,
        p_auth: json.keys.auth,
        p_user_agent: navigator.userAgent.slice(0, 200)
      });
    } catch (e) {
      // Enregistrement impossible : on annule côté navigateur pour rester cohérent.
      try { await sub.unsubscribe(); } catch (x) { /* ignoré */ }
      throw e;
    }
    return 'Notifications activées sur cet appareil.';
  }

  async function disable() {
    var sub = await currentSubscription();
    if (sub) {
      await DP.api.remove('push_subscriptions', { endpoint: 'eq.' + sub.endpoint });
      await sub.unsubscribe();
    }
    return 'Notifications désactivées sur cet appareil.';
  }

  function panelHtml(st) {
    var text, button = '';
    switch (st) {
      case 'ios-browser':
        text = 'Sur iPhone, les notifications sont disponibles uniquement depuis l’application installée. Appuyez sur Partager, puis « Sur l’écran d’accueil », ouvrez DarajaPlus depuis l’écran d’accueil et revenez ici.';
        break;
      case 'unsupported':
        text = 'Votre navigateur ne permet pas les notifications sur cet appareil. Vous pouvez tout de même consulter vos notifications dans l’application.';
        break;
      case 'denied':
        text = 'Les notifications sont bloquées pour ce site. Autorisez-les dans les réglages du navigateur, puis revenez ici.';
        break;
      case 'on':
        text = 'Notifications activées sur cet appareil. Une alerte apparaît quand une nouvelle notification vous est adressée.';
        button = '<button class="btn btn-outline" type="button" data-push="off">Désactiver sur cet appareil</button>';
        break;
      default:
        text = 'Recevez une alerte sur ce téléphone quand une nouvelle notification vous est adressée. Le message reste général : ouvrez l’application pour le lire.';
        button = '<button class="btn btn-primary" type="button" data-push="on">Activer les notifications</button>';
    }
    return '<p>' + esc(text) + '</p>' + (button ? '<div class="form-actions">' + button + '</div>' : '');
  }

  DP.push = {
    /* Remplit la zone indiquée avec l'état actuel de l'appareil. */
    render: async function (box) {
      if (!box) return;
      var st;
      try { st = await status(); } catch (e) { st = 'unsupported'; }
      box.innerHTML = panelHtml(st);
    },
    /* Gère les clics sur les boutons de la zone (délégation : survit aux nouveaux rendus). */
    bind: function (box) {
      if (!box) return;
      box.addEventListener('click', async function (e) {
        var b = e.target.closest && e.target.closest('[data-push]');
        if (!b || b.disabled) return;
        b.disabled = true;
        try {
          var message = b.getAttribute('data-push') === 'on' ? await enable() : await disable();
          DP.ui.toast(message, 'ok');
        } catch (err) {
          DP.ui.toast(DP.ui.errMsg(err), 'bad');
        }
        await DP.push.render(box);
      });
    },
    /* Appelée à la déconnexion : l'appareil ne doit plus recevoir les alertes du compte qui se déconnecte. */
    forgetOnSignOut: async function () {
      try {
        if (!hasPush()) return;
        var sub = await currentSubscription();
        if (!sub) return;
        await DP.api.remove('push_subscriptions', { endpoint: 'eq.' + sub.endpoint });
        await sub.unsubscribe();
      } catch (e) { /* hors ligne : rien à faire, l'abonnement sera remplacé à la prochaine connexion */ }
    }
  };
})();
