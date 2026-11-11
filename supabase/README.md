# Base de données Supabase — DarajaPlus

Projet Supabase : `nfcfwvrllacpvlcsoycp`.

## Ce qui est dans ce dossier

- `migrations/20261110000000_admin_notifications_contact_storage.sql` :
  notifications de l'administrateur (déclencheurs sur les événements de la
  plateforme), table `contact_requests` (formulaire de contact), correctif de la
  politique `ledger_read` du grand livre des carrefours, bucket privé
  `documents` et ses politiques d'accès.

## Ce qui manque encore dans le dépôt

Le **schéma de base** (tables `profiles`, `beneficiaries`, `projects`,
`connection_requests`, `offers`, `carrefours`, `documents`, `settings`, etc.,
leurs contraintes, leurs politiques RLS, les fonctions `is_admin()`,
`can_access_beneficiary()`, `partner_can_read_document()`, `my_beneficiary_id()`,
`admin_review_account()`, `create_beneficiary()`, etc.) est appliqué sur la base
mais n'est pas encore exporté ici.

Pour le compléter, deux options :

1. Depuis le tableau de bord Supabase, ou avec la CLI : `supabase db pull`
   (après `supabase link --project-ref nfcfwvrllacpvlcsoycp`).
2. Ou demander un nouvel export à Claude, qui peut le générer à partir de la base.

Tant que ce schéma n'est pas dans le dépôt, la migration ci-dessus ne peut pas
être rejouée seule sur une base vide.

## Règles à respecter

- Ne jamais mettre de mot de passe, de clé de service ou de jeton dans le dépôt.
  La clé publique (anon) présente dans `js/config.js` est publique par nature :
  la sécurité repose sur les politiques RLS.
- Toute modification de schéma passe par un nouveau fichier de migration
  horodaté dans `migrations/`, jamais par une modification silencieuse de la base.
