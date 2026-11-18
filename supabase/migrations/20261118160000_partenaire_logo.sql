-- DarajaPlus — logo de l'organisation du partenaire (18 novembre 2026).
--
-- Ajout d'une colonne facultative : le partenaire peut envoyer le logo de son organisation depuis son profil.
-- Aucune règle d'accès n'est modifiée : le partenaire modifie déjà sa fiche (politique partners_update),
-- et le fichier est rangé dans son propre dossier du bucket « visuels ».

alter table public.partners add column if not exists logo_path text;
