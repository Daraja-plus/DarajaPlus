-- DarajaPlus — correction : la liste des champs modifiés utilisait « tableau || texte », que PostgreSQL lit
-- comme un tableau littéral (erreur « malformed array literal »). On utilise array_append.
-- Cette correction remplace la version de la migration 20261113140000 (déjà appliquée en production).
create or replace function public.account_profile_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changes text[] := array[]::text[];
begin
  -- pas de notification pour les modifications faites par l'administrateur, ni pour son propre compte
  if public.is_admin() or new.role = 'admin' then return null; end if;
  if new.nom is distinct from old.nom then v_changes := array_append(v_changes, 'nom'); end if;
  if new.postnom is distinct from old.postnom then v_changes := array_append(v_changes, 'post-nom'); end if;
  if new.prenom is distinct from old.prenom then v_changes := array_append(v_changes, 'prénom'); end if;
  if new.phone is distinct from old.phone then v_changes := array_append(v_changes, 'téléphone'); end if;
  if new.photo_path is distinct from old.photo_path then v_changes := array_append(v_changes, 'photo de profil'); end if;
  if coalesce(array_length(v_changes, 1), 0) = 0 then return null; end if;

  insert into public.notifications (recipient_id, kind, title, body, link)
  select id, 'compte', 'Informations modifiées',
         trim(coalesce(new.prenom, '') || ' ' || coalesce(new.nom, '')) || ' a modifié : ' || array_to_string(v_changes, ', ') || '.',
         '#/admin/comptes'
  from public.profiles where role = 'admin';
  return null;
end $$;
