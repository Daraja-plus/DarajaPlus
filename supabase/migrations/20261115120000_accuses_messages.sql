-- DarajaPlus — accusés de réception et de lecture des messages privés.
--
-- Pour chaque message entre l’Administrateur général et une personne :
--   « Envoyé » : le message est enregistré sur la plateforme ;
--   « Reçu »   : l’application du destinataire l’a récupéré (elle était ouverte) ;
--   « Lu »     : le destinataire a ouvert le fil de messages (date de lecture conservée).
--
-- Migration additive : deux colonnes, un index partiel, deux fonctions.
-- Protection : une fois envoyé, le texte, l’auteur et la date d’un message ne peuvent plus être modifiés.
-- La politique de mise à jour existante permettait de réécrire ces champs depuis le fil de la personne.

alter table public.messages add column if not exists delivered_at timestamptz;
alter table public.messages add column if not exists read_at timestamptz;

create index if not exists messages_non_livres_idx on public.messages (thread_user_id) where delivered_at is null;

-- Contenu figé après l’envoi : seuls les accusés (reçu, lu) peuvent changer.
create or replace function public.messages_figer_contenu()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.body is distinct from old.body
     or new.from_admin is distinct from old.from_admin
     or new.from_user_id is distinct from old.from_user_id
     or new.thread_user_id is distinct from old.thread_user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Le contenu d’un message envoyé ne peut pas être modifié.';
  end if;
  return new;
end $$;

create or replace trigger messages_figer_contenu
  before update on public.messages
  for each row execute function public.messages_figer_contenu();

-- Marque comme reçus les messages destinés à la personne connectée (ou à l’Administrateur).
create or replace function public.marquer_messages_recus()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  if public.is_admin() then
    update public.messages set delivered_at = now()
     where from_admin = false and delivered_at is null;
  else
    update public.messages set delivered_at = now()
     where thread_user_id = auth.uid() and from_admin = true and delivered_at is null;
  end if;
end $$;

-- Marque comme lus les messages reçus dans un fil.
-- L’Administrateur lit les messages des personnes ; une personne ne lit que son propre fil.
create or replace function public.marquer_messages_lus(p_thread_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  if public.is_admin() then
    update public.messages
       set read_by_admin = true, read_at = now(), delivered_at = coalesce(delivered_at, now())
     where thread_user_id = p_thread_user_id and from_admin = false and read_by_admin = false;
  elsif auth.uid() = p_thread_user_id then
    update public.messages
       set read_by_user = true, read_at = now(), delivered_at = coalesce(delivered_at, now())
     where thread_user_id = p_thread_user_id and from_admin = true and read_by_user = false;
  end if;
end $$;

revoke all on function public.marquer_messages_recus() from public, anon;
revoke all on function public.marquer_messages_lus(uuid) from public, anon;
grant execute on function public.marquer_messages_recus() to authenticated;
grant execute on function public.marquer_messages_lus(uuid) to authenticated;
