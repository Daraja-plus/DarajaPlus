-- DarajaPlus — l'administrateur est notifié des changements faits dans « Mon compte » :
-- adresse e-mail, mot de passe, nom, post-nom, prénom, téléphone et photo de profil.
-- L'adresse e-mail de la table profiles suit l'adresse de connexion (synchronisation automatique).

-- 1. Adresse e-mail et mot de passe (table d'authentification)
create or replace function public.account_auth_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_admin boolean;
begin
  select role = 'admin', trim(coalesce(prenom, '') || ' ' || coalesce(nom, ''))
    into v_admin, v_name
    from public.profiles
    where id = new.id;
  if not found then return null; end if;

  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
    if not v_admin then
      insert into public.notifications (recipient_id, kind, title, body, link)
      select id, 'compte', 'Adresse e-mail modifiée',
             v_name || ' : ' || coalesce(old.email, '—') || ' → ' || coalesce(new.email, '—') || '.',
             '#/admin/comptes'
      from public.profiles where role = 'admin';
    end if;
  end if;

  if new.encrypted_password is distinct from old.encrypted_password and not v_admin then
    insert into public.notifications (recipient_id, kind, title, body, link)
    select id, 'compte', 'Mot de passe modifié', v_name || ' a changé son mot de passe.', '#/admin/comptes'
    from public.profiles where role = 'admin';
  end if;
  return null;
end $$;

drop trigger if exists account_auth_changed on auth.users;
create trigger account_auth_changed
  after update on auth.users
  for each row
  when (old.email is distinct from new.email or old.encrypted_password is distinct from new.encrypted_password)
  execute function public.account_auth_changed();

-- 2. Nom, post-nom, prénom, téléphone et photo de profil (table profiles)
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
  if new.nom is distinct from old.nom then v_changes := v_changes || 'nom'; end if;
  if new.postnom is distinct from old.postnom then v_changes := v_changes || 'post-nom'; end if;
  if new.prenom is distinct from old.prenom then v_changes := v_changes || 'prénom'; end if;
  if new.phone is distinct from old.phone then v_changes := v_changes || 'téléphone'; end if;
  if new.photo_path is distinct from old.photo_path then v_changes := v_changes || 'photo de profil'; end if;
  if coalesce(array_length(v_changes, 1), 0) = 0 then return null; end if;

  insert into public.notifications (recipient_id, kind, title, body, link)
  select id, 'compte', 'Informations modifiées',
         trim(coalesce(new.prenom, '') || ' ' || coalesce(new.nom, '')) || ' a modifié : ' || array_to_string(v_changes, ', ') || '.',
         '#/admin/comptes'
  from public.profiles where role = 'admin';
  return null;
end $$;

drop trigger if exists account_profile_changed on public.profiles;
create trigger account_profile_changed
  after update on public.profiles
  for each row
  when (old.nom is distinct from new.nom or old.postnom is distinct from new.postnom or old.prenom is distinct from new.prenom
        or old.phone is distinct from new.phone or old.photo_path is distinct from new.photo_path)
  execute function public.account_profile_changed();
