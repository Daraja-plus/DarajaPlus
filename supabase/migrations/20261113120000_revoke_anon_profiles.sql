-- DarajaPlus — retrait de tous les droits du rôle anonyme (visiteur non connecté) sur la table profiles.
-- Le site n'a besoin d'aucun accès direct à profiles pour un visiteur : les fonctions qui lisent cette table
-- sont SECURITY DEFINER et les règles RLS qui la citent ne visent que les comptes connectés.
-- Les comptes connectés conservent leurs droits (la RLS limite ce qu'ils voient et modifient).
revoke all on table public.profiles from anon;
