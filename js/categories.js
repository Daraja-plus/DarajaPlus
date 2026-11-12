/* Textes des trois catégories de bénéficiaires : Alpha (Ba), Bêta (Bb), Gamma (Bg).

   STATUT : BROUILLON À VALIDER.
   - Les chiffres (financement indicatif, places par Agent, parrainage) sont des faits confirmés.
   - Les avantages, limites et exigences sont des propositions. Le promoteur doit les valider
     avant publication. Une fois validés, passer `statut` à 'valide' : la mention disparaît.
   Aucun de ces textes ne crée de frais, de commission ni de droit nouveau. */
(function () {
  var DP = window.DP;

  DP.categories = {
    statut: 'brouillon',
    ordre: ['ba', 'bb', 'bg'],

    ba: {
      nom: 'Alpha',
      code: 'Ba',
      financement: '100 à 500 USD (indicatif, sans promesse de financement)',
      resume: 'Pour les microentreprises, les très petites activités et les petites initiatives économiques qui démarrent.',
      parrain: 'Un Bêta (Bb) de votre Agent vous parraine.',
      places: 'Jusqu’à 60 Alpha par Agent.',
      avantages: [
        'Un Agent de proximité vous accompagne pour constituer votre dossier.',
        'Vous accédez aux opportunités publiées pour votre catégorie.',
        'Vous pouvez faire connaître votre activité sur votre espace.'
      ],
      limites: [
        'Le montant indiqué est une fourchette de référence, pas une promesse de financement.',
        'Les places sont limitées dans le quota de votre Agent.',
        'Un Bêta de votre Agent doit vous parrainer.'
      ],
      exigences: [
        'Une fiche d’identité complète : nom, post-nom, prénom et téléphone.',
        'Une présentation de votre activité ou de votre idée.',
        'Des pièces justificatives, si votre dossier les demande.'
      ]
    },

    bb: {
      nom: 'Bêta',
      code: 'Bb',
      financement: '500 à 2 000 USD (indicatif, sans promesse de financement)',
      resume: 'Pour les petites entreprises et les activités commerciales en développement, dirigées par une personne ayant déjà une certaine expérience.',
      parrain: 'Un Gamma (Bg) de votre Agent vous parraine.',
      places: 'Jusqu’à 30 Bêta par Agent.',
      avantages: [
        'Un Agent de proximité prépare votre dossier avec vous.',
        'Vous accédez aux opportunités et aux programmes publiés pour votre catégorie.',
        'Vous pouvez faire connaître votre entreprise et vos produits sur votre espace.'
      ],
      limites: [
        'Le montant indiqué est une fourchette de référence, pas une promesse de financement.',
        'Les places sont limitées dans le quota de votre Agent.',
        'Un Gamma de votre Agent doit vous parrainer.'
      ],
      exigences: [
        'Une fiche d’identité complète et une adresse de votre activité.',
        'Une présentation de votre entreprise : activité, clients, chiffre d’affaires si vous le connaissez.',
        'Des pièces justificatives de votre activité, si votre dossier les demande.'
      ]
    },

    bg: {
      nom: 'Gamma',
      code: 'Bg',
      financement: '2 000 à 5 000 USD (indicatif, sans promesse de financement)',
      resume: 'Pour les moyennes entreprises structurées, dont le projet demande un financement plus important.',
      parrain: 'Pas de parrain Bêta : un Gamma est rattaché directement à son Agent.',
      places: 'Jusqu’à 10 Gamma par Agent.',
      avantages: [
        'Un Agent et un Hôte suivent votre dossier jusqu’à la conclusion.',
        'Vous êtes mis en relation avec les partenaires financiers correspondant à votre besoin.'
      ],
      limites: [
        'Le montant indiqué est une fourchette de référence, pas une promesse de financement.',
        'Les places sont les plus limitées : 10 Gamma par Agent.',
        'Le partenaire garde seul la décision de financer ou non.'
      ],
      exigences: [
        'Une entreprise structurée, avec une fiche d’identité et une adresse.',
        'Un projet chiffré : montant recherché, usage des fonds, échéance souhaitée.',
        'Des pièces justificatives de l’entreprise, à fournir selon les partenaires.'
      ]
    }
  };
})();
