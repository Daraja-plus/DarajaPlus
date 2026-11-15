-- DarajaPlus — photos dans les messages privés et dans les annonces.
--
-- Une photo est rangée dans un bucket privé, au nom de la personne qui l'envoie (premier niveau du chemin = son identifiant).
-- Qui peut la voir ? Quiconque peut lire la ligne qui la référence :
--   - message : l'administrateur et les deux personnes du fil (règle « messages_read ») ;
--   - annonce : les personnes à qui l'annonce est visible (règle « announcements_read »).
-- Les politiques de stockage s'appuient donc sur les règles déjà en place, sans en créer de nouvelles.
-- Le contenu d'un message envoyé reste figé : la photo est figée comme le texte.
-- Migration additive : deux colonnes nullables, deux index partiels, deux buckets, des politiques, une fonction remplacée.

alter table public.messages add column if not exists photo_path text;
alter table public.announcements add column if not exists photo_path text;

create index if not exists messages_photo_idx on public.messages (photo_path) where photo_path is not null;
create index if not exists announcements_photo_idx on public.announcements (photo_path) where photo_path is not null;

-- Déclencheur : la photo d'un message envoyé ne peut plus être modifiée (comme le texte).
create or replace function public.messages_figer_contenu()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.body is distinct from old.body
     or new.from_admin is distinct from old.from_admin
     or new.from_user_id is distinct from old.from_user_id
     or new.thread_user_id is distinct from old.thread_user_id
     or new.created_at is distinct from old.created_at
     or new.photo_path is distinct from old.photo_path then
    raise exception 'Le contenu d’un message envoyé ne peut pas être modifié.';
  end if;
  return new;
end $function$;

-- Buckets privés : images seulement (JPG, PNG, WebP), 3 Mo maximum.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('messagerie', 'messagerie', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('annonces', 'annonces', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Bucket « messagerie » : envoi et suppression seulement dans son propre dossier.
drop policy if exists messagerie_insert on storage.objects;
create policy messagerie_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'messagerie'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists messagerie_delete on storage.objects;
create policy messagerie_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'messagerie'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

-- Lecture : l'auteur de la photo, ou toute personne qui peut lire le message qui la contient.
drop policy if exists messagerie_read on storage.objects;
create policy messagerie_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'messagerie'
    and (
      (storage.foldername(name))[1] = (auth.uid())::text
      or exists (select 1 from public.messages m where m.photo_path = objects.name)
    )
  );

-- Bucket « annonces » : même principe.
drop policy if exists annonces_insert on storage.objects;
create policy annonces_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'annonces'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists annonces_delete on storage.objects;
create policy annonces_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'annonces'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

-- Lecture : l'auteur de la photo, ou toute personne à qui l'annonce qui la contient est visible.
drop policy if exists annonces_read on storage.objects;
create policy annonces_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'annonces'
    and (
      (storage.foldername(name))[1] = (auth.uid())::text
      or exists (select 1 from public.announcements a where a.photo_path = objects.name)
    )
  );
