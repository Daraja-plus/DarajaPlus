-- DarajaPlus — photos d'activité des entreprises et rubrique « Projets disponibles » (partenaires)
--
-- Règles appliquées :
--  * un partenaire ne voit jamais le profil d'un bénéficiaire, ni sa photo de profil ;
--  * il voit : l'identifiant du bénéficiaire, les projets validés (avec leur statut), les informations du projet,
--    les informations publiques de l'activité (nom, secteur, description, produits et services)
--    et les photos d'activité avec leur légende ;
--  * il ne voit ni les coordonnées, ni l'adresse, ni les logos ;
--  * « validé » = projet au statut « ready » (Prêt à présenter), « in_progress » (En cours) ou « closed » (Clôturé).
--
-- Migration additive et idempotente : aucune donnée existante n'est modifiée.

-- 1. Photos d'activité rattachées à une entreprise (établissement)
create table if not exists public.establishment_photos (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  storage_path text not null unique,
  caption text check (caption is null or char_length(caption) <= 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists establishment_photos_establishment_idx
  on public.establishment_photos (establishment_id, created_at);

-- Limite de 10 photos par entreprise (proposition, modifiable)
create or replace function public.establishment_photos_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.establishment_photos where establishment_id = new.establishment_id) >= 10 then
    raise exception 'Une entreprise peut avoir 10 photos au maximum';
  end if;
  return new;
end $$;

drop trigger if exists establishment_photos_limit on public.establishment_photos;
create trigger establishment_photos_limit
  before insert on public.establishment_photos
  for each row execute function public.establishment_photos_limit();

alter table public.establishment_photos enable row level security;
revoke all on public.establishment_photos from anon;
grant select, insert, delete on public.establishment_photos to authenticated;
-- Seule la légende peut être modifiée : le chemin du fichier ne change pas après l'envoi.
revoke update on public.establishment_photos from authenticated;
grant update (caption) on public.establishment_photos to authenticated;

-- 2. Fonctions d'accès partenaire (SECURITY DEFINER, droits limités à leur objet)
create or replace function public.partner_can_see_establishment(p_establishment uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select my_partner_id() is not null and exists (
    select 1
    from public.projects p
    join public.beneficiaries b on b.id = p.beneficiary_id
    where p.establishment_id = p_establishment
      and p.status in ('ready', 'in_progress', 'closed')
      and b.status = 'active'
  )
$$;

create or replace function public.partner_can_read_visual(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.establishment_photos ep
    where ep.storage_path = p_name
      and public.partner_can_see_establishment(ep.establishment_id)
  )
$$;

revoke all on function public.partner_can_see_establishment(uuid) from public, anon;
revoke all on function public.partner_can_read_visual(text) from public, anon;
grant execute on function public.partner_can_see_establishment(uuid) to authenticated;
grant execute on function public.partner_can_read_visual(text) to authenticated;

-- 3. Règles d'accès aux photos d'activité
-- Lecture : qui voit la fiche de l'entreprise (administrateur, créateur, bénéficiaire rattaché, Hôte, Agent)
-- ou un partenaire pour un projet validé de cette entreprise.
drop policy if exists establishment_photos_read on public.establishment_photos;
create policy establishment_photos_read on public.establishment_photos
  for select to authenticated
  using (
    exists (select 1 from public.establishments e where e.id = establishment_photos.establishment_id)
    or public.partner_can_see_establishment(establishment_photos.establishment_id)
  );

-- Ajout : seulement dans le dossier de l'utilisateur, pour une entreprise qu'il voit.
drop policy if exists establishment_photos_insert on public.establishment_photos;
create policy establishment_photos_insert on public.establishment_photos
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and split_part(storage_path, '/', 1) = auth.uid()::text
    and exists (select 1 from public.establishments e where e.id = establishment_photos.establishment_id)
  );

-- Modification de la légende et suppression : mêmes personnes que pour l'ajout.
drop policy if exists establishment_photos_update on public.establishment_photos;
create policy establishment_photos_update on public.establishment_photos
  for update to authenticated
  using (exists (select 1 from public.establishments e where e.id = establishment_photos.establishment_id))
  with check (exists (select 1 from public.establishments e where e.id = establishment_photos.establishment_id));

drop policy if exists establishment_photos_delete on public.establishment_photos;
create policy establishment_photos_delete on public.establishment_photos
  for delete to authenticated
  using (exists (select 1 from public.establishments e where e.id = establishment_photos.establishment_id));

-- 4. Lecture des fichiers « visuels » par les partenaires : uniquement les photos d'activité
-- de projets validés. Les photos de profil ne sont jamais concernées.
drop policy if exists visuels_partner_read on storage.objects;
create policy visuels_partner_read on storage.objects
  for select to authenticated
  using (bucket_id = 'visuels' and public.partner_can_read_visual(name));

-- 5. Rubrique « Projets disponibles » : projets validés, statut, informations et photos d'activité.
-- Ne renvoie aucun nom, téléphone, e-mail, adresse ou logo de bénéficiaire.
create or replace function public.partner_available_projects(p_sector text default null, p_currency text default null)
returns table (
  project_id uuid,
  reference text,
  title text,
  sector text,
  description text,
  use_of_funds text,
  amount numeric,
  currency text,
  due_date date,
  status text,
  created_at timestamptz,
  beneficiary_identifiant text,
  category text,
  establishment_name text,
  establishment_sector text,
  establishment_description text,
  establishment_services text,
  photos jsonb,
  connection_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    left(p.id::text, 8),
    p.title,
    p.sector,
    p.description,
    p.use_of_funds,
    p.amount,
    p.currency,
    p.due_date,
    p.status,
    p.created_at,
    pr.identifiant,
    b.category,
    e.name,
    e.sector,
    e.description,
    e.services,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', ph.id, 'path', ph.storage_path, 'caption', ph.caption) order by ph.created_at)
      from public.establishment_photos ph
      where ph.establishment_id = p.establishment_id
    ), '[]'::jsonb),
    (
      select c.status
      from public.connection_requests c
      where c.project_id = p.id and c.partner_id = my_partner_id()
      order by c.created_at desc
      limit 1
    )
  from public.projects p
  join public.beneficiaries b on b.id = p.beneficiary_id
  left join public.profiles pr on pr.id = b.user_id
  left join public.establishments e on e.id = p.establishment_id
  where my_partner_id() is not null
    and p.status in ('ready', 'in_progress', 'closed')
    and b.status = 'active'
    and (p_sector is null or p.sector ilike '%' || p_sector || '%')
    and (p_currency is null or p.currency = p_currency)
  order by p.created_at desc
  limit 200
$$;

revoke all on function public.partner_available_projects(text, text) from public, anon;
grant execute on function public.partner_available_projects(text, text) to authenticated;
