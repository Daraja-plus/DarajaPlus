-- DarajaPlus — une photo de message ou d’annonce doit être dans le dossier de son auteur.
--
-- Sans cette contrainte, une personne pourrait référencer dans son message la photo rangée dans le dossier
-- d’une autre personne ; la règle de lecture donnerait alors accès à cette photo à la personne qui reçoit le message.
-- La contrainte impose : le chemin commence par l’identifiant de l’auteur (« <identifiant>/… »).
-- Les lignes existantes n’ont pas de photo (colonne ajoutée à l’instant) : la contrainte est donc vérifiée immédiatement.

alter table public.messages
  add constraint messages_photo_auteur_chk
  check (photo_path is null or photo_path like from_user_id::text || '/%');

alter table public.announcements
  add constraint announcements_photo_auteur_chk
  check (photo_path is null or photo_path like author_id::text || '/%');
