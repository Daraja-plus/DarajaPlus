-- Le rôle anonyme (celui de la clé publique présente dans le site) ne doit plus pouvoir
-- modifier, supprimer ni vider les tables. TRUNCATE n'est pas filtré par les règles de sécurité
-- ligne par ligne : il faut donc retirer le droit lui-même.
-- La lecture (SELECT) est volontairement conservée : les règles de sécurité filtrent déjà
-- toutes les lignes pour les anonymes, donc le comportement du site ne change pas.

revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;

-- Le formulaire de contact reste ouvert aux visiteurs (politique contact_insert).
grant insert on public.contact_requests to anon;

-- Les futures tables ne donneront plus ces droits au rôle anonyme.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon;
