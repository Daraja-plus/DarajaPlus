/* Helpers d'interface communs : formatage, tableaux, formulaires, modales, notifications. */
(function () {
  var DP = window.DP;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(amount, currency) {
    if (amount === null || amount === undefined || amount === '') return '—';
    var n = Number(amount);
    var s = n.toLocaleString('fr-FR', { maximumFractionDigits: currency === 'FC' ? 0 : 2 }).replace(/[  ]/g, ' ');
    return s + ' ' + (currency || 'USD');
  }

  function date(d) {
    if (!d) return '—';
    var x = new Date(d);
    if (isNaN(x)) return esc(d);
    return x.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function dateTime(d) {
    if (!d) return '—';
    var x = new Date(d);
    if (isNaN(x)) return esc(d);
    return x.toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function errMsg(e) { return (e && e.message) ? e.message : String(e); }

  /* ---- Labels métier (statuts, rôles, catégories) ---- */
  DP.labels = {
    role: {
      admin: 'Administrateur général', host: 'Hôte territorial', agent: 'Agent',
      beneficiary: 'Bénéficiaire', partner: 'Partenaire'
    },
    category: { ba: 'Ba — Alpha', bb: 'Bb — Bêta', bg: 'Bg — Gamma' },
    categoryShort: { ba: 'Ba', bb: 'Bb', bg: 'Bg' },
    partnerCategory: {
      institution_financiere: 'Institution financière',
      investisseur: 'Investisseur / particulier financeur',
      incubateur: 'Incubateur / structure d’accompagnement',
      autre: 'Autre (à définir)'
    },
    status: {
      pending: 'En attente', active: 'Actif', rejected: 'Refusé', suspended: 'Suspendu',
      draft: 'Brouillon', incomplete: 'Incomplet', to_verify: 'À vérifier', archived: 'Archivé',
      ready: 'Prêt à présenter', in_progress: 'En cours', closed: 'Clôturé',
      requested: 'Demande envoyée', approved_admin: 'Validée par l’administrateur',
      refused_admin: 'Refusée par l’administrateur', consent_given: 'Consentement donné',
      transmitted: 'Documents autorisés transmis', under_study: 'En étude par le partenaire',
      complement_requested: 'Complément demandé', accepted: 'Acceptée', refused: 'Refusée',
      cancelled: 'Annulée', pending_payment: 'En attente de paiement', published: 'Publiée',
      hidden: 'Masquée', expired: 'Expirée', paid: 'Payée', open: 'Ouvert', full: 'Complet',
      running: 'En cours', visible: 'Visible', confirmed: 'Confirmé', validated: 'Validé'
    },
    audience: {
      all: 'Toute la plateforme', zone: 'Ma zone', agent_beneficiaries: 'Mes bénéficiaires'
    }
  };

  var tones = {
    active: 'ok', validated: 'ok', published: 'ok', accepted: 'ok', ready: 'ok', visible: 'ok', paid: 'ok', confirmed: 'ok',
    pending: 'warn', requested: 'warn', to_verify: 'warn', incomplete: 'warn', pending_payment: 'warn',
    complement_requested: 'warn', under_study: 'warn', draft: 'muted', archived: 'muted', closed: 'muted',
    cancelled: 'muted', expired: 'muted', hidden: 'muted',
    rejected: 'bad', refused: 'bad', refused_admin: 'bad', suspended: 'bad'
  };

  function badge(status) {
    var label = DP.labels.status[status] || status || '—';
    return '<span class="badge badge-' + (tones[status] || 'info') + '">' + esc(label) + '</span>';
  }

  function categoryBadge(cat) {
    if (!cat) return '<span class="muted">—</span>';
    return '<span class="badge badge-cat cat-' + esc(cat) + '">' + esc(DP.labels.categoryShort[cat] || cat) + '</span>';
  }

  /* ---- Structures ---- */
  function header(title, subtitle, actionsHtml) {
    return '<div class="page-head"><div><h1>' + esc(title) + '</h1>' +
      (subtitle ? '<p class="page-sub">' + esc(subtitle) + '</p>' : '') + '</div>' +
      (actionsHtml ? '<div class="page-actions">' + actionsHtml + '</div>' : '') + '</div>';
  }

  function card(title, bodyHtml, actionsHtml) {
    return '<div class="card">' + (title ? '<div class="card-head"><h2>' + esc(title) + '</h2>' +
      (actionsHtml ? '<div class="card-actions">' + actionsHtml + '</div>' : '') + '</div>' : '') +
      '<div class="card-body">' + (bodyHtml || '') + '</div></div>';
  }

  function stat(label, value, hint, tone) {
    return '<div class="stat' + (tone ? ' stat-' + tone : '') + '"><div class="stat-value">' + esc(value) +
      '</div><div class="stat-label">' + esc(label) + '</div>' +
      (hint ? '<div class="stat-hint">' + esc(hint) + '</div>' : '') + '</div>';
  }

  function stats(items) {
    return '<div class="stats">' + items.map(function (i) { return stat(i[0], i[1], i[2], i[3]); }).join('') + '</div>';
  }

  /* columns: [{label, render(row) -> html, key?, cls?}] */
  function table(columns, rows, emptyText) {
    if (!rows || !rows.length) return empty(emptyText || 'Aucun élément pour le moment.');
    var head = columns.map(function (c) { return '<th class="' + (c.cls || '') + '">' + esc(c.label) + '</th>'; }).join('');
    var body = rows.map(function (r) {
      return '<tr>' + columns.map(function (c) {
        var v = c.render ? c.render(r) : esc(r[c.key]);
        return '<td class="' + (c.cls || '') + '" data-label="' + esc(c.label) + '">' + (v === undefined || v === null ? '' : v) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="table-wrap"><table class="table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function empty(msg) { return '<div class="empty">' + esc(msg) + '</div>'; }

  function alert(kind, html) { return '<div class="alert alert-' + (kind || 'info') + '">' + html + '</div>'; }

  function loading(el) { el.innerHTML = '<div class="loading" role="status">Chargement…</div>'; }

  function errorBox(e) {
    return alert('bad', '<strong>Une erreur est survenue.</strong> ' + esc(errMsg(e)));
  }

  /* ---- Formulaires ---- */
  /* opts: {name, label, type, value, required, options:[[val,label]], hint, placeholder, min, max, rows, full, disabled} */
  function field(o) {
    var id = 'f_' + o.name + '_' + Math.random().toString(36).slice(2, 7);
    var req = o.required ? ' required' : '';
    var attrs = ' name="' + esc(o.name) + '" id="' + id + '"' + req + (o.disabled ? ' disabled' : '') +
      (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') +
      (o.min !== undefined ? ' min="' + o.min + '"' : '') + (o.max !== undefined ? ' max="' + o.max + '"' : '') +
      (o.step ? ' step="' + o.step + '"' : '') + (o.dataType ? ' data-type="' + o.dataType + '"' : '');
    var input;
    var val = o.value === undefined || o.value === null ? '' : o.value;
    if (o.type === 'select') {
      input = '<select class="input"' + attrs + '>' + (o.placeholder ? '<option value="">' + esc(o.placeholder) + '</option>' : '') +
        (o.options || []).map(function (opt) {
          return '<option value="' + esc(opt[0]) + '"' + (String(opt[0]) === String(val) ? ' selected' : '') + '>' + esc(opt[1]) + '</option>';
        }).join('') + '</select>';
    } else if (o.type === 'textarea') {
      input = '<textarea class="input" rows="' + (o.rows || 4) + '"' + attrs + '>' + esc(val) + '</textarea>';
    } else if (o.type === 'checkbox') {
      return '<div class="field field-check' + (o.full ? ' field-full' : '') + '"><label><input type="checkbox" name="' + esc(o.name) + '" id="' + id + '"' +
        (o.value ? ' checked' : '') + '> ' + esc(o.label) + '</label>' + (o.hint ? '<div class="hint">' + esc(o.hint) + '</div>' : '') + '</div>';
    } else {
      input = '<input class="input" type="' + (o.type || 'text') + '" value="' + esc(val) + '"' + attrs + '>';
    }
    return '<div class="field' + (o.full ? ' field-full' : '') + '"><label for="' + id + '">' + esc(o.label) +
      (o.required ? ' <span class="req" aria-hidden="true">*</span>' : '') + '</label>' + input +
      (o.hint ? '<div class="hint">' + esc(o.hint) + '</div>' : '') + '</div>';
  }

  /* Lit les valeurs d'un formulaire. data-type="number" -> nombre ; checkbox -> booléen. */
  function formData(form) {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === 'checkbox') { out[el.name] = el.checked; return; }
      var v = el.value;
      if (el.dataset.type === 'number') v = v === '' ? null : Number(v);
      else if (el.dataset.type === 'nullable') v = v === '' ? null : v;
      else v = v.trim();
      out[el.name] = v;
    });
    return out;
  }

  /* Attache un gestionnaire de soumission : désactive le bouton, affiche le retour, gère les erreurs. */
  function bindForm(form, handler, okMessage) {
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var btn = form.querySelector('[type=submit]');
      var old = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.innerHTML = 'Patientez…'; }
      try {
        var result = await handler(formData(form), form);
        var msg = typeof result === 'string' ? result : okMessage;
        if (msg) toast(msg, 'ok');
        if (result !== false && form.dataset.reset !== 'false') form.reset();
      } catch (e) {
        toast(errMsg(e), 'bad');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = old; }
      }
    });
  }

  /* ---- Notifications légères ---- */
  function toast(msg, kind) {
    var host = document.getElementById('toasts');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast toast-' + (kind || 'info');
    el.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(function () { el.classList.add('toast-out'); }, 3800);
    setTimeout(function () { el.remove(); }, 4300);
  }

  /* ---- Modale et confirmation ---- */
  function modal(title, bodyHtml, footerHtml) {
    var wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<div class="modal-head"><h2>' + esc(title) + '</h2><button type="button" class="btn btn-ghost btn-sm" data-close aria-label="Fermer">✕</button></div>' +
      '<div class="modal-body">' + bodyHtml + '</div>' +
      (footerHtml ? '<div class="modal-foot">' + footerHtml + '</div>' : '') + '</div>';
    document.body.appendChild(wrap);
    function close() { wrap.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    wrap.addEventListener('click', function (e) { if (e.target === wrap || e.target.hasAttribute('data-close')) close(); });
    document.addEventListener('keydown', onKey);
    return { el: wrap, close: close };
  }

  function confirmBox(message, okLabel) {
    return new Promise(function (resolve) {
      var m = modal('Confirmation', '<p>' + esc(message) + '</p>',
        '<button type="button" class="btn btn-outline" data-cancel>Annuler</button> <button type="button" class="btn btn-primary" data-ok>' + esc(okLabel || 'Confirmer') + '</button>');
      m.el.querySelector('[data-cancel]').addEventListener('click', function () { m.close(); resolve(false); });
      m.el.querySelector('[data-ok]').addEventListener('click', function () { m.close(); resolve(true); });
      m.el.addEventListener('click', function (e) { if (e.target === m.el) resolve(false); });
    });
  }

  DP.ui = {
    esc: esc, money: money, date: date, dateTime: dateTime, errMsg: errMsg,
    badge: badge, categoryBadge: categoryBadge,
    header: header, card: card, stat: stat, stats: stats, table: table, empty: empty,
    alert: alert, loading: loading, errorBox: errorBox,
    field: field, formData: formData, bindForm: bindForm,
    toast: toast, modal: modal, confirm: confirmBox
  };
})();
