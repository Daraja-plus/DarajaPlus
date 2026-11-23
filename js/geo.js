/* DarajaPlus — localisation de chaque utilisateur : province, puis ville ou village (type et nom).
   La liste des provinces doit rester identique à la contrainte profiles_localisation_check
   et à la fonction handle_new_user (supabase/migrations/20261122150000_localisation_profil.sql).
   Obligatoire pour tous les rôles : la garde de navigation (app.js) renvoie vers « Mon compte »
   tant que la localisation n'est pas complète. */
(function () {
  var DP = window.DP;

  var PROVINCES = [
    'Kinshasa', 'Kongo Central', 'Kwango', 'Kwilu', 'Mai-Ndombe', 'Kasaï', 'Kasaï Central',
    'Kasaï Oriental', 'Lomami', 'Sankuru', 'Maniema', 'Sud-Kivu', 'Nord-Kivu', 'Ituri',
    'Haut-Uélé', 'Tshopo', 'Bas-Uélé', 'Nord-Ubangi', 'Sud-Ubangi', 'Mongala', 'Équateur',
    'Tshuapa', 'Tanganyika', 'Haut-Lomami', 'Lualaba', 'Haut-Katanga'
  ];

  DP.geo = {
    provinces: PROVINCES,
    provinceOptions: PROVINCES.map(function (p) { return [p, p]; }),
    typeOptions: [['ville', 'Ville'], ['village', 'Village']],

    /* Renvoie le message d'erreur à afficher, ou null si la localisation est complète. */
    erreur: function (d) {
      d = d || {};
      if (!d.province || PROVINCES.indexOf(d.province) === -1) return 'Choisissez votre province dans la liste.';
      if (d.localite_type !== 'ville' && d.localite_type !== 'village') return 'Indiquez si vous êtes en ville ou en village.';
      var nom = String(d.localite_nom || '').trim();
      if (!nom) return 'Indiquez le nom de votre ville ou de votre village.';
      if (nom.length > 120) return 'Le nom de la ville ou du village ne doit pas dépasser 120 caractères.';
      return null;
    },

    /* Vrai si le profil a sa localisation complète. */
    complete: function (p) {
      return !!p && DP.geo.erreur({ province: p.province, localite_type: p.localite_type, localite_nom: p.localite_nom }) === null;
    }
  };
})();
