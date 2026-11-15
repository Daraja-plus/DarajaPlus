-- DarajaPlus — une présentation par projet (fusion de « Mes projets & besoins » et « Présenter mon projet »).
--
-- Décision du promoteur (16 novembre 2026) : chaque projet a sa propre présentation (11 rubriques, jusqu'à 4 photos,
-- statut brouillon, publiée ou visible). Elle est rédigée depuis la page « Mes projets & besoins ».
-- Les présentations enregistrées avant cette migration n'ont pas de projet : elles sont gardées en attente et sont
-- rattachées au premier projet que leur bénéficiaire créera. Aucune donnée n'est supprimée.
--
-- Changements :
--  1. la clé devient un identifiant propre ; chaque présentation pointe vers un projet (project_id, unique) ;
--  2. le bénéficiaire ne peut créer une présentation que pour un de ses projets ;
--  3. un premier projet rattache la présentation en attente de son bénéficiaire ;
--  4. la visibilité, la notification de l'administrateur, celle des partenaires et les fonctions partenaire
--     raisonnent par projet ; la visibilité exige toujours un projet validé.

-- 1. Clé et rattachement au projet
alter table public.presentations drop constraint if exists presentations_pkey;
alter table public.presentations add column if not exists id uuid not null default gen_random_uuid();
alter table public.presentations add constraint presentations_pkey primary key (id);

alter table public.presentations
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create unique index if not exists presentations_projet_unique
  on public.presentations (project_id) where project_id is not null;
create index if not exists presentations_user_idx on public.presentations (user_id);

-- 2. Création : seulement pour un projet du bénéficiaire connecté
drop policy if exists presentations_proprietaire_creation on public.presentations;
create policy presentations_proprietaire_creation on public.presentations
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'beneficiary')
    and project_id is not null
    and exists (
      select 1
      from public.projects pr
      join public.beneficiaries b on b.id = pr.beneficiary_id
      where pr.id = presentations.project_id and b.user_id = auth.uid()
    )
  );

-- 3. Rattachement : le premier projet d'un bénéficiaire reçoit sa présentation en attente
create or replace function public.projet_rattache_presentation_en_attente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  select b.user_id into v_user from public.beneficiaries b where b.id = new.beneficiary_id;
  if v_user is null then return null; end if;

  update public.presentations pr
  set project_id = new.id
  where pr.id = (
    select x.id
    from public.presentations x
    where x.user_id = v_user and x.project_id is null
    order by x.updated_at desc
    limit 1
  );
  return null;
end $$;

revoke all on function public.projet_rattache_presentation_en_attente() from public, anon, authenticated;

drop trigger if exists projet_rattache_presentation_en_attente on public.projects;
create trigger projet_rattache_presentation_en_attente
  after insert on public.projects
  for each row execute function public.projet_rattache_presentation_en_attente();

-- 4a. Notification de l'administrateur : inchangée dans son principe ; elle lit le titre de la présentation.
--     (Aucune modification : elle s'appuie sur user_id et content, qui existent toujours.)

-- 4b. Fonctions partenaire et visibilité, par projet
drop function if exists public.partner_can_see_presentation(uuid);

create function public.partner_can_see_presentation(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select my_partner_id() is not null and exists (
    select 1
    from public.presentations pr
    join public.projects p on p.id = pr.project_id
    join public.beneficiaries b on b.id = p.beneficiary_id
    where pr.project_id = p_project
      and pr.statut = 'visible'
      and b.status = 'active'
      and p.status in ('ready', 'in_progress', 'closed')
  )
$$;

revoke all on function public.partner_can_see_presentation(uuid) from public, anon;
grant execute on function public.partner_can_see_presentation(uuid) to authenticated;

-- Les photos de présentation suivent le projet visible (même règle que les photos d'activité)
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
  ) or exists (
    select 1
    from public.presentations pr
    where pr.photos @> jsonb_build_array(p_name)
      and public.partner_can_see_presentation(pr.project_id)
  )
$$;

-- Présentation d'un projet validé, si elle est visible. Jamais la rubrique « vision » (coordonnées), jamais d'identifiant de compte.
create or replace function public.partner_presentation(p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pres record;
begin
  if not public.partner_can_see_presentation(p_project) then
    return null;
  end if;

  select pr.content, pr.photos, pr.visible_at into v_pres
  from public.presentations pr
  where pr.project_id = p_project;

  return jsonb_build_object(
    'content', coalesce(v_pres.content, '{}'::jsonb) - 'vision',
    'photos', v_pres.photos,
    'visible_at', v_pres.visible_at
  );
end $$;

-- Rubrique « Projets disponibles » : indique si la présentation de ce projet est visible
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
  zone text,
  quartier text,
  rue text,
  establishment_name text,
  establishment_sector text,
  establishment_description text,
  establishment_services text,
  photos jsonb,
  connection_status text,
  presentation_visible boolean
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
    z.name,
    q.name,
    public.rue_de_categorie(b.category),
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
    ),
    coalesce((
      select pv.statut = 'visible'
      from public.presentations pv
      where pv.project_id = p.id
    ), false)
  from public.projects p
  join public.beneficiaries b on b.id = p.beneficiary_id
  left join public.profiles pr on pr.id = b.user_id
  left join public.quartiers q on q.id = b.quartier_id
  left join public.zones z on z.id = coalesce(q.zone_id, pr.zone_id)
  left join public.establishments e on e.id = p.establishment_id
  where my_partner_id() is not null
    and p.status in ('ready', 'in_progress', 'closed')
    and b.status = 'active'
    and (p_sector is null or p.sector ilike '%' || p_sector || '%')
    and (p_currency is null or p.currency = p_currency)
  order by p.created_at desc
  limit 200
$$;

-- 4c. Action de l'administrateur : rendre visible (ou retirer) la présentation d'un projet
drop function if exists public.admin_set_presentation_visibility(uuid, boolean);

create function public.admin_set_presentation_visibility(p_project uuid, p_visible boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_statut text;
begin
  if not public.is_admin() then
    raise exception 'Réservé à l''administrateur';
  end if;

  select pr.statut into v_statut from public.presentations pr where pr.project_id = p_project;
  if v_statut is null then
    raise exception 'Ce projet n''a pas encore de présentation';
  end if;
  if v_statut = 'brouillon' then
    raise exception 'Cette présentation n''est pas encore publiée';
  end if;

  if p_visible and not exists (
    select 1
    from public.projects p
    join public.beneficiaries b on b.id = p.beneficiary_id
    where p.id = p_project
      and b.status = 'active'
      and p.status in ('ready', 'in_progress', 'closed')
  ) then
    raise exception 'Le projet doit être validé pour que sa présentation soit visible des partenaires';
  end if;

  update public.presentations
  set statut = case when p_visible then 'visible' else 'publiee' end
  where project_id = p_project;

  return case when p_visible then 'visible' else 'publiee' end;
end $$;

revoke all on function public.admin_set_presentation_visibility(uuid, boolean) from public, anon;
grant execute on function public.admin_set_presentation_visibility(uuid, boolean) to authenticated;

-- 4d. Notification des partenaires : par projet (zone, quartier, rue, établissement et identifiant du projet concerné)
create or replace function public.presentation_notifie_partenaires()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ben record;
  v_pret boolean;
  v_zone text;
  v_quartier text;
  v_etablissement text;
  v_rue text;
  v_code text;
  v_manque text[] := array[]::text[];
  v_corps text;
begin
  if new.project_id is null then return null; end if;
  -- Une seule notification, au passage à « visible ».
  if new.statut is distinct from 'visible' then return null; end if;
  if tg_op = 'UPDATE' and old.statut is not distinct from 'visible' then return null; end if;

  select b.id, b.code, b.category, b.agent_id, b.quartier_id, pr.identifiant, pr.zone_id
    into v_ben
  from public.projects p
  join public.beneficiaries b on b.id = p.beneficiary_id
  left join public.profiles pr on pr.id = b.user_id
  where p.id = new.project_id;

  if v_ben.id is null then return null; end if;

  -- Affecté à un agent ET catégorie attribuée : la catégorie, la rue et le code sont précisés.
  v_pret := v_ben.agent_id is not null and v_ben.category is not null;
  v_rue := case when v_pret then public.rue_de_categorie(v_ben.category) end;
  v_code := case when v_pret then v_ben.code end;

  select coalesce(q.name, 'non précisé'), coalesce(z.name, 'non précisée')
    into v_quartier, v_zone
  from (select 1) as ancre
  left join public.quartiers q on q.id = v_ben.quartier_id
  left join public.zones z on z.id = coalesce(q.zone_id, v_ben.zone_id);

  select e.name into v_etablissement
  from public.projects p
  left join public.establishments e on e.id = p.establishment_id
  where p.id = new.project_id;

  if v_ben.agent_id is null then
    v_manque := array_append(v_manque, 'il n’est pas encore affecté à un agent');
  end if;
  if v_ben.category is null then
    v_manque := array_append(v_manque, 'sa catégorie n’est pas encore attribuée');
  end if;

  v_corps := 'Un projet est disponible : zone ' || v_zone
    || ', quartier ' || v_quartier
    || ', rue ' || coalesce(v_rue, 'non encore déterminée')
    || ', établissement ' || coalesce(v_etablissement, 'non précisé')
    || ' (identifiant ' || coalesce(v_ben.identifiant, 'non précisé')
    || ', code ' || coalesce(v_code, 'non encore attribué') || ').';

  if v_pret then
    v_corps := v_corps || ' Catégorie : '
      || case v_ben.category when 'bg' then 'Gamma' when 'bb' then 'Bêta' when 'ba' then 'Alpha' end || '.';
  end if;

  if cardinality(v_manque) > 0 then
    v_corps := v_corps || ' À noter : ' || array_to_string(v_manque, ' et ') || '. Cela n’empêche pas la conclusion d’un contrat.';
  end if;

  insert into public.notifications (recipient_id, kind, title, body, link)
  select pa.profile_id, 'projet', 'Nouveau projet disponible', v_corps, '#/partenaire/recherche'
  from public.partners pa
  join public.profiles pr on pr.id = pa.profile_id
  where pr.role = 'partner' and pr.status = 'active';

  return null;
end $$;

revoke all on function public.presentation_notifie_partenaires() from public, anon, authenticated;
