/* DarajaPlus — photos : photo de profil (tous les comptes) et photos d'activité des entreprises.
   Règles : JPG, PNG ou WebP ; 3 Mo maximum (bucket privé « visuels »).
   Si la photo dépasse 3 Mo, on propose de la compresser. Une photo compressée respecte la limite :
   elle est alors validée et enregistrée. Elle peut être remplacée à tout moment. */
(function () {
  'use strict';

  var DP = window.DP;
  var esc = DP.ui.esc;
  var MAX = 3 * 1024 * 1024;
  var ACCEPT = '.jpg,.jpeg,.png,.webp';
  var seq = 0;

  function mo(bytes) { return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' Mo'; }
  function isImage(file) {
    return /^image\/(jpeg|png|webp)$/.test(file.type || '') || /\.(jpe?g|png|webp)$/i.test(file.name || '');
  }
  function safeName(name) { return String(name || 'photo').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60); }
  function baseName(name) { return safeName(name).replace(/\.[A-Za-z0-9]+$/, '') || 'photo'; }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Impossible de lire cette image. Choisissez un autre fichier.'));
      };
      img.src = url;
    });
  }
  function toBlob(canvas, quality) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', quality); });
  }

  /* Réduit la photo : côté le plus long 1600 px, puis 1200, puis 900 ; qualité JPEG décroissante,
     jusqu'à passer sous 3 Mo. Renvoie un fichier JPEG. */
  async function compress(file) {
    var img = await loadImage(file);
    var longest = Math.max(img.naturalWidth, img.naturalHeight) || 1;
    var sizes = [1600, 1200, 900];
    var qualities = [0.85, 0.75, 0.65, 0.5];
    for (var s = 0; s < sizes.length; s++) {
      var k = Math.min(1, sizes[s] / longest);
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (var q = 0; q < qualities.length; q++) {
        var blob = await toBlob(canvas, qualities[q]);
        if (blob && blob.size <= MAX) {
          return new File([blob], baseName(file.name) + '.jpg', { type: 'image/jpeg' });
        }
      }
    }
    throw new Error('Cette photo ne peut pas être réduite sous 3 Mo. Choisissez une autre image.');
  }

  /* Envoi d'un fichier dans le dossier de l'utilisateur (le premier niveau du chemin est son identifiant). */
  async function upload(file) {
    var path = DP.api.uid + '/photo-' + Date.now() + '_' + safeName(file.name);
    await DP.api.uploadTo('visuels', path, file);
    return path;
  }

  /* Photo de profil : envoi, enregistrement du chemin dans le profil, suppression de l'ancienne photo. */
  async function saveProfile(file) {
    var old = DP.app.profile && DP.app.profile.photo_path;
    var path = await upload(file);
    await DP.api.update('profiles', { id: 'eq.' + DP.api.uid }, { photo_path: path });
    if (old && old.indexOf(DP.api.uid + '/') === 0) DP.api.removeFrom('visuels', old).catch(function () {});
    await DP.app.loadProfile();
    return path;
  }

  function avatar(url, initials, alt) {
    return url
      ? '<img src="' + esc(url) + '" alt="' + esc(alt || 'Photo') + '" class="photo-avatar">'
      : '<div class="photo-avatar photo-avatar-empty" aria-hidden="true">' + esc(initials || '?') + '</div>';
  }

  /* Champ photo (HTML). opts : { mode: 'save' | 'form', url, initials, alt, label }
     « save » : la photo est enregistrée dès qu'elle est validée (Mon compte, profil).
     « form » : la photo est gardée et envoyée avec le formulaire (inscription, photos d'activité). */
  function html(opts) {
    seq += 1;
    var id = 'photo-input-' + seq;
    return '<div class="photo-field" data-photo data-mode="' + esc(opts.mode || 'form') + '">' +
      '<div class="photo-row">' +
        '<div data-photo-preview>' + avatar(opts.url, opts.initials, opts.alt) + '</div>' +
        '<div class="photo-input">' +
          '<label class="field-label" for="' + id + '">' + esc(opts.label || 'Photo (JPG, PNG ou WebP — 3 Mo maximum)') + '</label>' +
          '<input class="input" id="' + id + '" type="file" accept="' + ACCEPT + '" data-photo-input>' +
          '<p class="small muted">Si votre photo dépasse 3 Mo, nous vous proposerons de la réduire.</p>' +
        '</div>' +
      '</div>' +
      '<div data-photo-notice aria-live="polite"></div>' +
    '</div>';
  }

  /* Relie le champ photo situé dans root. Renvoie { file(), reset() } : file() donne la photo validée (ou null).
     opts : { mode, save(file) (mode « save » : enregistre et renvoie le chemin), onSaved() }. */
  function bind(root, opts) {
    opts = opts || {};
    var mode = opts.mode || 'form';
    var field = root.querySelector('[data-photo]');
    var input = field.querySelector('[data-photo-input]');
    var notice = field.querySelector('[data-photo-notice]');
    var preview = field.querySelector('[data-photo-preview]');
    var chosen = null;

    function say(kind, body) { notice.innerHTML = body ? DP.ui.alert(kind, body) : ''; }
    function showPreview(file) {
      preview.innerHTML = '<img src="' + URL.createObjectURL(file) + '" alt="Aperçu de la photo" class="photo-avatar">';
    }
    function button(label, attr) {
      return '<div class="btn-row" style="margin-top:.5rem"><button type="button" class="btn btn-primary btn-sm" ' + attr + '>' + esc(label) + '</button></div>';
    }

    async function saveNow(file, compressed) {
      say('info', 'Enregistrement de la photo…');
      try {
        await opts.save(file);
        chosen = null;
        input.value = '';
        say('ok', (compressed ? 'Photo compressée (' + mo(file.size) + ') : elle est validée et enregistrée.' : 'Photo enregistrée.') +
          ' Vous pourrez la remplacer à tout moment.');
        if (opts.onSaved) opts.onSaved();
      } catch (e) {
        say('bad', esc(DP.ui.errMsg(e)));
      }
    }

    function accept(file, compressed) {
      showPreview(file);
      if (mode === 'form') {
        chosen = file;
        say('ok', (compressed ? 'Photo compressée (' + mo(file.size) + ') : elle est validée.' : 'Photo prête (' + mo(file.size) + ').') +
          ' Elle sera enregistrée avec le formulaire.');
        return;
      }
      if (compressed) { saveNow(file, true); return; }
      say('info', 'Photo prête (' + mo(file.size) + ').' + button('Enregistrer la photo', 'data-save'));
      notice.querySelector('[data-save]').addEventListener('click', function () { saveNow(file, false); });
    }

    async function compressNow(file) {
      say('info', 'Compression de la photo en cours…');
      try {
        var small = await compress(file);
        accept(small, true);
      } catch (e) {
        say('bad', esc(DP.ui.errMsg(e)));
      }
    }

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      chosen = null;
      if (!file) { say('', ''); return; }
      if (!isImage(file)) {
        input.value = '';
        say('bad', 'Format non accepté : choisissez une image JPG, PNG ou WebP.');
        return;
      }
      if (file.size > MAX) {
        say('warn', 'Cette photo fait ' + mo(file.size) + ' ; le maximum est de 3 Mo. Nous pouvons la réduire pour qu’elle convienne.' +
          button('Compresser la photo', 'data-compress'));
        notice.querySelector('[data-compress]').addEventListener('click', function () { compressNow(file); });
        return;
      }
      accept(file, false);
    });

    return {
      file: function () { return chosen; },
      reset: function () { chosen = null; input.value = ''; say('', ''); }
    };
  }

  DP.photo = {
    MAX: MAX,
    ACCEPT: ACCEPT,
    mo: mo,
    isImage: isImage,
    compress: compress,
    upload: upload,
    saveProfile: saveProfile,
    avatar: avatar,
    html: html,
    bind: bind
  };
})();
