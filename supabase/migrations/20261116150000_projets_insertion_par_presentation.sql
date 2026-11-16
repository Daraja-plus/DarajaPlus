-- DarajaPlus — un projet ne se crée que par presentation_enregistrer (16 novembre 2026).
--
-- Décision du promoteur (16 novembre 2026) : « Présenter mon projet » est la seule façon de créer un projet.
-- Le formulaire « Nouveau projet ou besoin » est retiré de la fiche bénéficiaire de l'espace Agent et Hôte
-- (commit 3a58a01). La politique projects_insert autorisait encore l'insertion directe d'un projet, sans présentation,
-- par un Agent, un Hôte ou un bénéficiaire qui gère la fiche.
--
-- Cette migration supprime cette politique. Sans politique d'insertion, la table projects refuse toute insertion
-- directe ; seule la fonction presentation_enregistrer (SECURITY DEFINER) crée un projet, avec sa présentation.
-- Aucun code de l'application n'insère directement dans projects (vérifié le 16 novembre 2026).
-- Aucune donnée n'est supprimée.

drop policy if exists projects_insert on public.projects;
