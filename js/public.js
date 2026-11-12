/* Pages publiques : accueil en rubriques, informations, contact, inscription, connexion, statut du compte. */
(function () {
  var DP = window.DP;
  var esc = DP.ui.esc;

  /* ---------- Outils de mise en page ---------- */
  function crumb(label) {
    return '<nav class="crumbs" aria-label="Fil d’Ariane"><a href="#/">Accueil</a> › <span>' + esc(label) + '</span></nav>';
  }
  function head(title, sub, label) {
    return (label ? crumb(label) : '') + DP.ui.header(title, sub || '');
  }
  function box(title, html) {
    return '<section class="section"><h2>' + esc(title) + '</h2>' + html + '</section>';
  }
  function legal(text) {
    return '<p class="legal-note">' + esc(text) + '</p>';
  }
  function ctaInscription(title, text) {
    return '<div class="cta-band"><div><strong>' + esc(title) + '</strong><p>' + esc(text) + '</p></div>' +
      '<div class="btn-row"><a class="btn btn-accent" href="#/inscription">S’inscrire gratuitement</a>' +
      '<a class="btn" style="background:#fff;color:var(--green-dark)" href="#/connexion">Connexion</a></div></div>';
  }
  function steps(list) {
    return '<ol class="steps">' + list.map(function (s) {
      return '<li><strong>' + esc(s[0]) + '</strong><span>' + esc(s[1]) + '</span></li>';
    }).join('') + '</ol>';
  }

  /* ---------- Contenus partagés ---------- */
  var RUBRICS = [
    ['🧭', 'Fonctionnement', '#/fonctionnement', 'Comment se déroule une mise en relation, étape par étape.'],
    ['👥', 'Bénéficiaires', '#/beneficiaires', 'MPME et porteurs de projets : catégories Ba, Bb et Bg.'],
    ['🤝', 'Partenaires', '#/partenaires', 'Institutions financières, investisseurs et incubateurs.'],
    ['🔄', 'Carrefours', '#/carrefours', 'Cotisations mutuelles versées à tour de rôle.'],
    ['🏷️', 'Tarifs & visibilité', '#/tarifs', 'Tarifs indicatifs et règles de commission.'],
    ['❓', 'FAQ', '#/faq', 'Les questions les plus fréquentes.'],
    ['✉️', 'Contact', '#/contact', 'Écrire à l’administration de DarajaPlus.'],
    ['🏛️', 'À propos', '#/a-propos', 'Mission, principes et réseau de terrain.']
  ];

  var PARTNER_CATS = [
    ['Institutions financières', 'Banques, institutions de microfinance et autres organismes de financement.'],
    ['Investisseurs et particuliers financeurs', 'Personnes ou structures capables d’investir. Le partenaire indique ses domaines, ses tickets minimum et maximum et ses zones.'],
    ['Incubateurs et structures d’accompagnement', 'Programmes d’accompagnement, de formation ou de conseil pour les porteurs de projets.'],
    ['Autre', 'Catégorie d’attente pour les autres contributeurs. Les champs et droits sont à définir avant activation.']
  ];

  var PARTNER_CAT_OPTIONS = Object.keys(DP.labels.partnerCategory).map(function (k) {
    return [k, DP.labels.partnerCategory[k]];
  });

  var CONTACT_SUBJECTS = [
    ['information', 'Demande d’information'],
    ['inscription', 'Question sur mon inscription'],
    ['compte', 'Problème de compte'],
    ['autre', 'Autre']
  ];

  var ROLE_CARDS = [
    ['beneficiary', 'Bénéficiaire', 'Micro, petite ou moyenne entreprise, ou porteur de projet.'],
    ['agent', 'Agent', 'Accompagnateur de terrain qui prépare les dossiers des bénéficiaires.'],
    ['host', 'Hôte territorial', 'Responsable d’une zone et de ses Agents.'],
    ['partner', 'Partenaire', 'Institution financière, investisseur, incubateur ou autre contributeur.']
  ];

  /* Envoi du message de contact : retour « minimal » car l’accès anonyme ne peut pas relire la ligne. */
  async function postContact(row) {
    var res;
    try {
      res = await fetch(DP.config.SUPABASE_URL + '/rest/v1/contact_requests', {
        method: 'POST',
        headers: {
          apikey: DP.config.SUPABASE_KEY,
          Authorization: 'Bearer ' + DP.config.SUPABASE_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(row)
      });
    } catch (e) {
      throw new Error(DP.api.translate('Failed to fetch'));
    }
    if (!res.ok) {
      var body = await res.json().catch(function () { return {}; });
      throw new Error(DP.api.translate(body.message || 'Envoi impossible. Réessayez plus tard.'));
    }
  }

  /* ---------- Pages ---------- */
  DP.register([
    {
      path: '/', public: true, title: 'Accueil',
      render: function (el) {
        el.innerHTML =
          '<section class="hero"><div>' +
            '<span class="hero-badge">Inscription gratuite</span>' +
            '<h1>Le pont entre vos projets et les partenaires qui peuvent les accompagner</h1>' +
            '<p class="lead">DarajaPlus organise votre activité, prépare votre dossier et facilite la mise en relation avec des partenaires financiers ou d’accompagnement.</p>' +
            legal('DarajaPlus ne garantit aucun financement : le partenaire reste seul décideur.') +
            '<div class="btn-row"><a class="btn btn-primary" href="#/inscription">Créer mon compte</a>' +
            '<a class="btn btn-outline" href="#/connexion">Se connecter</a></div>' +
          '</div>' +
          '<div class="hero-art"><img class="hero-poster" src="assets/affiche-daraja-plus.webp" alt="Affiche DarajaPlus : Vos idées méritent de devenir réalités. Entrepreneurs, porteurs de projets, investisseurs et partenaires, ensemble." width="900" height="1125" fetchpriority="high"></div></section>' +
          '<h2>Découvrir DarajaPlus</h2>' +
          '<div class="rubric-grid">' + RUBRICS.map(function (r) {
            return '<a class="rubric" href="' + r[2] + '"><span class="rubric-icon" aria-hidden="true">' + r[0] + '</span>' +
              '<strong>' + esc(r[1]) + '</strong><span>' + esc(r[3]) + '</span></a>';
          }).join('') + '</div>' +
          ctaInscription('Prêt à commencer ?', 'Votre compte est examiné par l’administrateur avant toute activation.');
      }
    },
    {
      path: '/fonctionnement', public: true, title: 'Fonctionnement',
      render: function (el) {
        el.innerHTML = head('Comment fonctionne DarajaPlus', 'Un parcours clair, de l’inscription à la décision du partenaire.', 'Fonctionnement') +
          box('Les étapes du pont', steps([
            ['Enregistrement', 'Vous créez votre compte. L’Administrateur général valide votre accès.'],
            ['Qualification', 'Votre activité, vos besoins et vos pièces sont structurés. Le système signale ce qui manque.'],
            ['Dossier prêt à présenter', 'Un dossier n’est présenté qu’après contrôles et lorsqu’il est complet.'],
            ['Demande de mise en relation', 'Un partenaire repère un dossier autorisé et envoie une demande motivée.'],
            ['Validation de l’Administrateur', 'L’Administrateur accepte ou refuse la demande, avec un motif.'],
            ['Votre consentement', 'Vous êtes informé et vous autorisez explicitement le partage.'],
            ['Transmission limitée', 'Seules les pièces choisies sont transmises, au partenaire désigné, pour une durée définie.'],
            ['Décision du partenaire', 'Le partenaire étudie le dossier et décide seul : accord, refus ou demande de compléments.'],
            ['Suivi par l’Hôte', 'L’Hôte de votre zone coordonne le suivi jusqu’à la conclusion du dossier.']
          ])) +
          box('Qui fait quoi ?',
            '<div class="pillars">' +
              '<div class="pillar"><strong>Agent</strong><p class="small">Vous accompagne sur le terrain, prépare et complète votre dossier.</p></div>' +
              '<div class="pillar"><strong>Hôte territorial</strong><p class="small">Coordonne la zone, suit les dossiers et les mises en relation.</p></div>' +
              '<div class="pillar"><strong>Administrateur général</strong><p class="small">Valide les comptes et les demandes de mise en relation, et supervise la plateforme.</p></div>' +
            '</div>') +
          legal('Une mise en relation n’est pas une promesse de financement. Le partenaire conserve sa décision et ses conditions.') +
          ctaInscription('Commencer le parcours', 'L’inscription est gratuite.');
      }
    },
    {
      path: '/beneficiaires', public: true, title: 'Bénéficiaires',
      render: function (el) {
        var cats = [
          ['ba', 'Alpha', 'Très petites activités, petits entrepreneurs et petites initiatives économiques.', '100 à 500 USD'],
          ['bb', 'Bêta', 'Petites entreprises et activités en développement, entrepreneurs ayant déjà une expérience.', '500 à 2 000 USD'],
          ['bg', 'Gamma', 'Moyennes entreprises, entreprises structurées et projets nécessitant des financements plus importants.', '2 000 à 5 000 USD']
        ];
        el.innerHTML = head('Pour les MPME et les porteurs de projets', 'Trois catégories pour organiser les besoins de financement.', 'Bénéficiaires') +
          '<div class="grid">' + cats.map(function (c) {
            return '<div class="card"><div class="card-body">' +
              '<span class="badge badge-cat cat-' + c[0] + '">' + esc(DP.labels.categoryShort[c[0]]) + '</span>' +
              '<h2 style="margin-top:.5rem">' + esc(DP.labels.category[c[0]]) + '</h2>' +
              '<p>' + esc(c[2]) + '</p>' +
              '<p class="small"><strong>Fourchette indicative :</strong> ' + esc(c[3]) + '<br><span class="muted">Non garantie, ce n’est pas une promesse de financement.</span></p>' +
            '</div></div>';
          }).join('') + '</div>' +
          box('Comment vous inscrire', steps([
            ['Inscription gratuite', 'Vous créez votre compte et décrivez votre activité.'],
            ['Validation', 'L’Administrateur général examine votre demande et valide votre accès.'],
            ['Rattachement', 'L’Administrateur décide de votre catégorie et de l’Agent qui vous accompagne.'],
            ['Votre dossier', 'Vous complétez votre profil, vos projets, vos besoins et vos pièces.']
          ])) +
          box('À savoir', '<ul class="small"><li>Ba, Bb et Bg sont des catégories propres à DarajaPlus. Elles ne désignent pas la taille juridique de votre entreprise.</li>' +
            '<li>Les classes d’établissement R1, R2 et R3 sont un autre axe, à confirmer dans le modèle de données.</li>' +
            '<li>Les avantages propres à chaque catégorie restent à définir : aucun privilège n’est promis à ce stade.</li></ul>') +
          ctaInscription('Vous êtes entrepreneur ?', 'Créez votre compte gratuitement.');
      }
    },
    {
      path: '/partenaires', public: true, title: 'Partenaires',
      render: function (el) {
        el.innerHTML = head('Pour les partenaires financiers et d’accompagnement', 'Trouvez des projets adaptés à vos critères, dans un cadre encadré.', 'Partenaires') +
          box('Catégories de partenaires', '<div class="pillars">' + PARTNER_CATS.map(function (c) {
            return '<div class="pillar"><strong>' + esc(c[0]) + '</strong><p class="small">' + esc(c[1]) + '</p></div>';
          }).join('') + '</div>') +
          box('Le processus', steps([
            ['Inscription gratuite', 'Vous présentez votre organisation, vos critères et vos capacités.'],
            ['Validation', 'L’Administrateur général vérifie votre profil et peut demander un complément.'],
            ['Recherche de projets autorisés', 'Vous consultez les profils que la plateforme rend disponibles, sans documents confidentiels.'],
            ['Demande motivée', 'Vous demandez une mise en relation sur un dossier précis.'],
            ['Décision de votre seul ressort', 'Vous étudiez le dossier et décidez seul des suites à donner.']
          ])) +
          legal('Les documents confidentiels ne sont transmis qu’après le consentement du bénéficiaire et la validation de l’Administrateur. L’inscription partenaire est gratuite.') +
          '<div class="btn-row"><a class="btn btn-primary" href="#/inscription">Demander une inscription partenaire</a></div>';
      }
    },
    {
      path: '/carrefours', public: true, title: 'Carrefours',
      render: function (el) {
        el.innerHTML = head('Les Carrefours', 'Des cotisations mutuelles à tour de rôle.', 'Carrefours') +
          box('Le principe', '<p>Un Carrefour est un groupe de membres. Chacun verse une somme à intervalles réguliers, et la collecte est remise à chaque membre à tour de rôle. Le principe s’inspire de la tontine.</p>' +
            '<p>Ce mécanisme est distinct du financement par un partenaire.</p>') +
          '<div class="grid-2">' +
            '<div class="card"><div class="card-body"><h2>Ce que la plateforme fait</h2><ul>' +
              '<li>Affiche le calendrier et les règles du groupe.</li>' +
              '<li>Gère les demandes d’adhésion, acceptées par l’Agent organisateur.</li>' +
              '<li>Enregistre les cotisations et les remises, avec leurs preuves et leur historique.</li></ul></div></div>' +
            '<div class="card"><div class="card-body"><h2>Ce que la plateforme ne fait pas</h2><ul>' +
              '<li>Elle ne reçoit, ne garde ni ne redistribue les fonds par défaut.</li>' +
              '<li>Elle n’est pas une messagerie entre membres. Les messages privés passent uniquement par l’Administrateur.</li>' +
              '<li>Aucune commission de financement n’est appliquée automatiquement aux Carrefours.</li></ul></div></div>' +
          '</div>' +
          box('Règles à valider avant tout lancement', '<ul class="small">' +
            '<li>Montant de la cotisation et périodicité</li><li>Nombre de participants et durée</li>' +
            '<li>Ordre de rotation (convenu, tiré au sort ou négocié)</li><li>Retards, défaut et sortie</li>' +
            '<li>Détenteur des fonds, responsabilités et prestataire</li></ul>') +
          legal('Aucun Carrefour ne démarre tant que ces règles ne sont pas validées par l’administration.');
      }
    },
    {
      path: '/tarifs', public: true, title: 'Tarifs & visibilité',
      render: function (el) {
        var rates = [['Ba — Alpha', '100 FC', '0,0435 USD'], ['Bb — Bêta', '150 FC', '0,0652 USD'],
          ['Bg — Gamma', '200 FC', '0,0870 USD'], ['Agent', '300 FC', '0,1304 USD']];
        el.innerHTML = head('Tarifs et règles de commission', 'Les montants ci-dessous sont indicatifs et ne sont pas encore facturés en ligne.', 'Tarifs & visibilité') +
          box('Visibilité journalière',
            '<div class="table-wrap"><table class="price-table"><thead><tr><th>Catégorie</th><th>Tarif journalier</th><th>Équivalent indicatif</th></tr></thead><tbody>' +
            rates.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td></tr>'; }).join('') +
            '</tbody></table></div>' +
            '<p class="small muted">Référence de calcul : 1 USD = 2 300 FC, à titre indicatif. La date et la source du taux seront précisées.</p>') +
          box('Publications des Agents', '<p>Chaque Agent dispose de <strong>5 publications gratuites par mois</strong>. Le prix au-delà de ce quota est <strong>à définir</strong>.</p>') +
          box('Commission sur un financement obtenu',
            '<div class="table-wrap"><table class="price-table"><thead><tr><th>Part</th><th>Taux</th><th>Exemple pour 5 000 USD</th></tr></thead><tbody>' +
            '<tr><td>DarajaPlus</td><td>7 %</td><td>350 USD</td></tr>' +
            '<tr><td>Hôte responsable</td><td>3 % (inclus dans les 10 %)</td><td>150 USD</td></tr>' +
            '<tr><td>Agent</td><td>0 %</td><td>0 USD</td></tr>' +
            '<tr><th>Total</th><th>10 %</th><th>500 USD</th></tr></tbody></table></div>' +
            legal('Cette commission s’applique uniquement après validation des règles de paiement : qui paie, à quel moment et sur quelle base. Elle n’est pas active actuellement.')) +
          box('Points en attente', '<ul class="small"><li>Les paiements en ligne ne sont pas encore activés.</li>' +
            '<li>Le forfait de 3 000 FC par mois est à clarifier avant toute publication.</li>' +
            '<li>Les tarifs de publicité et de popularité sont à définir.</li></ul>');
      }
    },
    {
      path: '/faq', public: true, title: 'Questions fréquentes',
      render: function (el) {
        var qa = [
          ['Mon inscription est-elle payante ?', 'Non. L’inscription des bénéficiaires et des partenaires est gratuite.'],
          ['Pourquoi mon compte est-il en attente ?', 'Chaque compte est examiné par l’Administrateur général avant activation. Vous ne pouvez accéder à votre espace qu’après validation.'],
          ['Une mise en relation garantit-elle un financement ?', 'Non. La mise en relation organise la rencontre et le dossier. Le partenaire décide seul.'],
          ['Qui décide du financement ?', 'Le partenaire financeur ou accompagnateur. DarajaPlus ne finance pas directement les bénéficiaires.'],
          ['Qui peut voir mes documents ?', 'Vos pièces ne sont jamais publiques. Un document n’est transmis qu’après votre consentement, à un partenaire désigné, pour une durée limitée.'],
          ['Puis-je écrire à un autre membre ?', 'Non. Les messages privés sont réservés à l’Administrateur général. Il n’existe pas de messagerie directe entre membres.'],
          ['Qu’est-ce qu’un Carrefour ?', 'Un groupe de cotisations mutuelles versées à tour de rôle, inspiré de la tontine. Il est distinct du financement.'],
          ['DarajaPlus garde-t-il l’argent des Carrefours ?', 'Non, par défaut. Cette fonction ne sera activée qu’après validation du cadre juridique et du prestataire.'],
          ['Combien coûte la commission ?', '10 % du montant concerné en cas de financement obtenu : 7 % pour DarajaPlus, 3 % pour l’Hôte, 0 % pour l’Agent. Son application attend la validation des règles de paiement.'],
          ['Mes données sont-elles protégées ?', 'Nous ne collectons que ce qui est nécessaire. Vous pouvez demander la correction de vos données. Les durées de conservation restent à valider juridiquement.'],
          ['Quel est le rôle de l’Administrateur général ?', 'Il valide les comptes et les demandes de mise en relation, décide des annonces et supervise la plateforme. Ses décisions sensibles sont journalisées.'],
          ['Je ne trouve pas ma réponse.', 'Écrivez-nous depuis la page Contact.']
        ];
        el.innerHTML = head('Questions fréquentes', 'Les réponses courtes aux questions les plus posées.', 'FAQ') +
          '<section class="section faq">' + qa.map(function (q) {
            return '<details><summary>' + esc(q[0]) + '</summary><p>' + esc(q[1]) + '</p></details>';
          }).join('') + '</section>' +
          '<p>Vous ne trouvez pas la réponse ? <a href="#/contact">Écrivez à l’administration</a>.</p>';
      }
    },
    {
      path: '/contact', public: true, title: 'Contact',
      render: function (el) {
        el.innerHTML = head('Contacter l’administration', 'Votre message est lu par l’Administrateur général.', 'Contact') +
          '<div class="auth-wrap"><div class="card"><div class="card-body" id="contact-box">' +
          '<form class="form" id="f-contact" novalidate>' +
            DP.ui.field({ name: 'name', label: 'Nom complet', required: true, placeholder: 'Prénom et nom' }) +
            '<div class="field-row">' +
              DP.ui.field({ name: 'email', label: 'Adresse e-mail', type: 'email', placeholder: 'vous@exemple.com', hint: 'Pour vous répondre.' }) +
              DP.ui.field({ name: 'phone', label: 'Téléphone (facultatif)', type: 'tel' }) +
            '</div>' +
            DP.ui.field({ name: 'subject', label: 'Objet', type: 'select', options: CONTACT_SUBJECTS, value: 'information' }) +
            DP.ui.field({ name: 'message', label: 'Message', type: 'textarea', rows: 5, required: true, hint: 'Entre 10 et 2 000 caractères. Ne joignez pas de mot de passe.' }) +
            '<div class="form-actions"><button class="btn btn-primary btn-block" type="submit">Envoyer le message</button></div>' +
          '</form></div></div></div>';
        var form = el.querySelector('#f-contact');
        form.addEventListener('submit', async function (ev) {
          ev.preventDefault();
          var fd = new FormData(form);
          var v = function (k) { return String(fd.get(k) || '').trim(); };
          var btn = form.querySelector('[type=submit]');
          try {
            if (v('name').length < 2) throw new Error('Indiquez votre nom complet.');
            var msg = v('message');
            if (msg.length < 10 || msg.length > 2000) throw new Error('Le message doit contenir entre 10 et 2 000 caractères.');
            var email = v('email');
            if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Adresse e-mail invalide.');
            if (btn) btn.disabled = true;
            await postContact({ name: v('name'), email: email || null, phone: v('phone') || null, subject: v('subject') || 'information', message: msg });
            el.querySelector('#contact-box').innerHTML = DP.ui.alert('ok', '<strong>Message envoyé.</strong> L’administrateur vous répondra.');
          } catch (e) {
            DP.ui.toast(DP.ui.errMsg(e), 'bad');
            if (btn) btn.disabled = false;
          }
        });
      }
    },
    {
      path: '/a-propos', public: true, title: 'À propos',
      render: function (el) {
        el.innerHTML = head('À propos de DarajaPlus', 'Une plateforme pour rapprocher les entrepreneurs et ceux qui peuvent les soutenir.', 'À propos') +
          box('Notre mission', '<p>DarajaPlus, « pont » en swahili, veut faciliter l’accès des entrepreneurs aux financements, aux partenaires et aux opportunités. La plateforme ne se substitue ni aux banques, ni aux investisseurs : elle prépare les dossiers et organise la rencontre.</p>') +
          box('Nos principes', '<div class="pillars">' +
            ['Accessibilité', 'Proximité', 'Transparence', 'Confidentialité', 'Responsabilité', 'Traçabilité'].map(function (p) {
              return '<div class="pillar"><strong>' + esc(p) + '</strong></div>';
            }).join('') + '</div>') +
          box('Un réseau de terrain', '<p>La plateforme s’appuie sur des Agents qui accompagnent les entrepreneurs et des Hôtes qui coordonnent cinq zones. L’Administrateur général supervise l’ensemble.</p>') +
          box('Coordonnées officielles', '<p class="muted">À compléter par l’organisation : adresse, téléphone et e-mail officiels.</p>') +
          '<div class="btn-row"><a class="btn btn-outline" href="#/contact">Nous écrire</a></div>';
      }
    },
    {
      path: '/mentions', public: true, title: 'Mentions légales',
      render: function (el) {
        el.innerHTML = head('Mentions légales et confidentialité', '', 'Mentions légales') +
          box('Éditeur', '<p class="muted">Identité de l’éditeur, siège et représentant : à compléter.</p>') +
          box('Conditions d’utilisation', '<ul class="small"><li>DarajaPlus est un intermédiaire de mise en relation.</li>' +
            '<li>Chaque utilisateur est responsable de l’exactitude de ses informations.</li>' +
            '<li>Les comptes peuvent être suspendus en cas de manquement, après examen.</li>' +
            '<li>Les contenus interdits et les réclamations seront précisés dans les conditions définitives.</li></ul>') +
          box('Confidentialité', '<ul class="small"><li>Nous collectons seulement les informations nécessaires à la qualification et au service.</li>' +
            '<li>Un document n’est partagé qu’après votre consentement explicite, pour un partenaire désigné et une durée définie.</li>' +
            '<li>Vous pouvez demander la correction de vos données.</li>' +
            '<li>Les durées de conservation et de suppression restent à définir.</li></ul>') +
          legal('Textes juridiques définitifs à valider par un juriste avant publication.');
      }
    },
    {
      path: '/connexion', public: true, title: 'Connexion',
      render: function (el, ctx) {
        if (DP.api.uid) {
          var p = DP.app.profile;
          if (p && (p.role === 'admin' || p.status === 'active')) { location.hash = DP.app.homeFor(p.role); return; }
          location.hash = '#/en-attente';
          return;
        }
        el.innerHTML = head('Connexion', 'Accédez à votre espace DarajaPlus.') +
          '<div class="auth-wrap"><div class="card"><div class="card-body">' +
          '<form class="form" id="f-login">' +
            DP.ui.field({ name: 'email', label: 'Adresse e-mail', type: 'email', required: true, placeholder: 'vous@exemple.com' }) +
            DP.ui.field({ name: 'password', label: 'Mot de passe', type: 'password', required: true }) +
            '<div class="form-actions"><button class="btn btn-primary btn-block" type="submit">Se connecter</button></div>' +
          '</form>' +
          '<p class="small" style="margin-top:1rem">Pas encore de compte ? <a href="#/inscription">Inscription gratuite</a><br>' +
          '<a href="#/mot-de-passe-oublie">Mot de passe oublié ?</a></p>' +
          '</div></div></div>';
        var next = ctx.query.get('next');
        DP.ui.bindForm(el.querySelector('#f-login'), async function (data) {
          await DP.api.signIn(data.email, data.password);
          await DP.app.afterLogin(next);
          return 'Connexion réussie.';
        });
      }
    },
    {
      path: '/inscription', public: true, title: 'Inscription',
      render: function (el) {
        var roleHtml = ROLE_CARDS.map(function (r, i) {
          return '<label style="display:flex;gap:.6rem;align-items:flex-start;padding:.7rem;border:1px solid var(--line);border-radius:10px;cursor:pointer;min-height:44px">' +
            '<input type="radio" name="requested_role" value="' + r[0] + '"' + (i === 0 ? ' checked' : '') + ' style="margin-top:.3rem">' +
            '<span><strong>' + esc(r[1]) + '</strong><br><span class="small muted">' + esc(r[2]) + '</span></span></label>';
        }).join('');
        el.innerHTML = head('Créer un compte', 'L’inscription est gratuite. Votre compte doit être validé avant tout accès.', 'Inscription') +
          '<div class="auth-wrap"><div class="card"><div class="card-body" id="signup-box">' +
          '<form class="form" id="f-signup" novalidate>' +
            '<fieldset style="border:0;padding:0;margin:0"><legend style="font-weight:700;margin-bottom:.5rem">Vous êtes</legend>' +
              '<div class="form">' + roleHtml + '</div></fieldset>' +
            '<div class="field-row three">' +
              DP.ui.field({ name: 'nom', label: 'Nom (obligatoire)' }) +
              DP.ui.field({ name: 'postnom', label: 'Post-nom (obligatoire)' }) +
              DP.ui.field({ name: 'prenom', label: 'Prénom (obligatoire)' }) +
            '</div>' +
            '<div class="field-row">' +
              DP.ui.field({ name: 'email', label: 'Adresse e-mail', type: 'email', placeholder: 'vous@exemple.com' }) +
              DP.ui.field({ name: 'phone', label: 'Téléphone', type: 'tel', placeholder: '+243…' }) +
            '</div>' +
            '<div class="field-row">' +
              DP.ui.field({ name: 'password', label: 'Mot de passe', type: 'password', hint: 'Au moins 6 caractères (8 recommandés).' }) +
              DP.ui.field({ name: 'confirm', label: 'Confirmer le mot de passe', type: 'password' }) +
            '</div>' +
            '<fieldset id="partner-fields" hidden style="border:1px solid var(--line);border-radius:12px;padding:1rem;margin:0">' +
              '<legend style="font-weight:700;padding:0 .3rem">Informations partenaire</legend>' +
              '<div class="form">' +
                DP.ui.field({ name: 'partner_category', label: 'Catégorie (obligatoire)', type: 'select', options: PARTNER_CAT_OPTIONS, placeholder: 'Choisissez…' }) +
                '<div class="field-row">' +
                  DP.ui.field({ name: 'legal_name', label: 'Raison sociale ou nom (obligatoire)' }) +
                  DP.ui.field({ name: 'representative', label: 'Représentant' }) +
                '</div>' +
                DP.ui.field({ name: 'sectors', label: 'Secteurs d’intervention', placeholder: 'Ex. agriculture, commerce' }) +
                DP.ui.field({ name: 'geography', label: 'Zone géographique', placeholder: 'Ex. Kinshasa, Lubumbashi' }) +
                '<div class="field-row">' +
                  DP.ui.field({ name: 'ticket_min', label: 'Ticket minimum (USD)', type: 'number', min: 0, step: 'any' }) +
                  DP.ui.field({ name: 'ticket_max', label: 'Ticket maximum (USD)', type: 'number', min: 0, step: 'any' }) +
                '</div>' +
                DP.ui.field({ name: 'description', label: 'Présentation', type: 'textarea', rows: 3 }) +
              '</div></fieldset>' +
            '<div class="field field-check"><label><input type="checkbox" name="consent" id="f-consent"> ' +
              'J’accepte les conditions et la politique de confidentialité <span class="muted">(à valider juridiquement)</span>.</label></div>' +
            '<div class="form-actions"><button class="btn btn-primary btn-block" type="submit">Créer mon compte</button></div>' +
          '</form>' +
          '<p class="small muted" style="margin-top:1rem">Vous ne recevrez l’accès à votre espace qu’après validation par l’Administrateur général.</p>' +
          '</div></div></div>';

        var form = el.querySelector('#f-signup');
        var pf = el.querySelector('#partner-fields');
        function syncRole() { pf.hidden = form.querySelector('input[name=requested_role]:checked').value !== 'partner'; }
        form.querySelectorAll('input[name=requested_role]').forEach(function (r) { r.addEventListener('change', syncRole); });
        syncRole();

        form.addEventListener('submit', async function (ev) {
          ev.preventDefault();
          var fd = new FormData(form);
          var v = function (k) { return String(fd.get(k) || '').trim(); };
          var role = v('requested_role');
          var btn = form.querySelector('[type=submit]');
          try {
            if (!v('nom') || !v('postnom') || !v('prenom')) throw new Error('Le nom, le post-nom et le prénom sont obligatoires.');
            var email = v('email').toLowerCase();
            if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Adresse e-mail invalide.');
            var pw = String(fd.get('password') || '');
            if (pw.length < 6) throw new Error('Le mot de passe doit contenir au moins 6 caractères.');
            if (pw !== String(fd.get('confirm') || '')) throw new Error('Les deux mots de passe ne correspondent pas.');
            if (!fd.get('consent')) throw new Error('Vous devez accepter les conditions pour créer un compte.');

            var meta = { requested_role: role, nom: v('nom'), postnom: v('postnom'), prenom: v('prenom'), phone: v('phone') || null };
            if (role === 'partner') {
              if (!v('partner_category')) throw new Error('Choisissez la catégorie de votre organisation.');
              if (!v('legal_name')) throw new Error('Indiquez la raison sociale ou le nom de votre organisation.');
              var tmin = v('ticket_min') === '' ? null : Number(v('ticket_min'));
              var tmax = v('ticket_max') === '' ? null : Number(v('ticket_max'));
              if ((tmin !== null && tmin < 0) || (tmax !== null && tmax < 0)) throw new Error('Les tickets ne peuvent pas être négatifs.');
              if (tmin !== null && tmax !== null && tmin > tmax) throw new Error('Le ticket minimum ne peut pas dépasser le maximum.');
              Object.assign(meta, {
                partner_category: v('partner_category'), legal_name: v('legal_name'), representative: v('representative') || null,
                sectors: v('sectors') || null, geography: v('geography') || null, ticket_min: tmin, ticket_max: tmax,
                description: v('description') || null
              });
            }
            if (btn) btn.disabled = true;
            var res = await DP.api.signUp(email, pw, meta);
            if (res && res.access_token) { await DP.app.afterLogin(null); return; }
            el.querySelector('#signup-box').innerHTML = DP.ui.alert('ok',
              '<strong>Compte créé.</strong> Si une confirmation par e-mail est demandée, validez-la. ' +
              'L’Administrateur général examinera ensuite votre demande. Tant que votre compte n’est pas validé, vous n’avez accès à aucun espace.');
          } catch (e) {
            DP.ui.toast(DP.ui.errMsg(e), 'bad');
            if (btn) btn.disabled = false;
          }
        });
      }
    },
    {
      path: '/mot-de-passe-oublie', public: true, title: 'Mot de passe oublié',
      render: function (el) {
        el.innerHTML = head('Mot de passe oublié', 'Recevez un lien pour choisir un nouveau mot de passe.', 'Mot de passe oublié') +
          '<div class="auth-wrap"><div class="card"><div class="card-body">' +
          '<form class="form" id="f-reset">' +
            DP.ui.field({ name: 'email', label: 'Adresse e-mail du compte', type: 'email', required: true }) +
            '<div class="form-actions"><button class="btn btn-primary btn-block" type="submit">Envoyer le lien</button></div>' +
          '</form></div></div></div>';
        DP.ui.bindForm(el.querySelector('#f-reset'), async function (data) {
          await DP.api.resetPassword(data.email);
          return 'Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d’être envoyé.';
        });
      }
    },
    {
      path: '/en-attente', public: true, title: 'Statut du compte',
      render: async function (el) {
        var head0 = DP.ui.header('Statut de votre compte', '');
        if (!DP.api.uid) {
          el.innerHTML = head0 + DP.ui.alert('info', 'Connectez-vous pour voir le statut de votre compte.') +
            '<a class="btn btn-primary" href="#/connexion">Connexion</a>';
          return;
        }
        var p;
        try { p = await DP.app.loadProfile(); } catch (e) { el.innerHTML = head0 + DP.ui.errorBox(e); return; }
        if (!p) {
          el.innerHTML = head0 + DP.ui.alert('warn', 'Profil introuvable pour ce compte. Contactez l’administration.') +
            '<button class="btn btn-outline" type="button" data-logout>Se déconnecter</button>';
          return;
        }
        if (p.role === 'admin' || p.status === 'active') { location.hash = DP.app.homeFor(p.role); return; }

        var body;
        if (p.status === 'rejected') {
          body = DP.ui.alert('bad', '<strong>Votre demande n’a pas été acceptée.</strong>' +
            (p.rejection_reason ? '<br>Motif : ' + esc(p.rejection_reason) : '') +
            '<br>Vous pouvez écrire à l’administration depuis la page Contact pour obtenir des précisions.');
        } else if (p.status === 'suspended') {
          body = DP.ui.alert('warn', '<strong>Votre compte est suspendu.</strong>' +
            (p.rejection_reason ? '<br>Motif : ' + esc(p.rejection_reason) : '') +
            '<br>Contactez l’administration depuis la page Contact.');
        } else {
          body = DP.ui.alert('info', '<strong>Votre compte est en attente de validation par l’Administrateur général.</strong>' +
            '<br>Vous recevrez une notification dès la décision. Aucun espace n’est accessible avant validation.' +
            (p.requested_role ? '<br>Profil demandé : ' + esc(DP.labels.role[p.requested_role] || p.requested_role) : ''));
        }
        el.innerHTML = head0 + body +
          '<div class="btn-row"><a class="btn btn-outline" href="#/contact">Contacter l’administration</a>' +
          '<button class="btn btn-ghost" type="button" data-logout>Se déconnecter</button></div>';
        if (p.status === 'pending') watchValidation(el, head0);
      }
    }
  ]);

  /* Page « en attente » : le statut est relu toutes les 15 secondes. Dès que le compte est validé,
     la personne voit la confirmation avec la date et l’heure, puis peut commencer sans recharger la page. */
  function watchValidation(el, head0) {
    var timer = setInterval(async function () {
      if (!document.body.contains(el)) { clearInterval(timer); return; }
      var fresh;
      try { fresh = await DP.app.loadProfile(); } catch (e) { return; }
      if (!fresh || (fresh.role !== 'admin' && fresh.status !== 'active')) return;
      clearInterval(timer);
      var when = fresh.validated_at ? '<br>Validé le ' + DP.ui.esc(DP.ui.dateTime(fresh.validated_at)) + '.' : '';
      el.innerHTML = head0 +
        DP.ui.alert('ok', '<strong>Votre compte est validé.</strong>' + when +
          '<br>Vous pouvez commencer dès maintenant.') +
        '<div class="btn-row"><a class="btn btn-primary" href="' + DP.ui.esc(fresh.role === 'beneficiary' ? '#/espace/categorie' : DP.app.homeFor(fresh.role)) + '">Commencer</a></div>';
    }, 15000);
  }
})();
