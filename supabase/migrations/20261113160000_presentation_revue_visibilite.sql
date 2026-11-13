-- DarajaPlus — « Présenter mon projet » : brouillon, publication et visibilité des partenaires.
--
-- Trois statuts :
--  * brouillon : seul le bénéficiaire voit sa présentation ;
--  * publiee   : le bénéficiaire l'a publiée ; l'administrateur la lit et la vérifie (il ne voit jamais un brouillon) ;
--  * visible   : l'administrateur l'a rendue visible aux partenaires. Seul l'administrateur peut la mettre à « visible »,
--                et seulement si le bénéficiaire a un projet validé (« Prêt à présenter », « En cours » ou « Clôturé »).
-- Toute modification du contenu ou des photos d'une présentation « visible » par le bénéficiaire la renvoie à « publiee ».
-- Migration additive : la table, ses règles d'origine et les données existantes sont conservées.

-- 1. Colonnes de statut et dates
alter table public.presentations
  add column if not exists statut text not null default 'brouillon',
  add column if not exists publiee_at timestamptz,
  add column if not exists visible_at timestamptz;

alter table public.presentations drop constraint if exists presentations_statut_valide;
alter table public.presentations
  add constraint presentations_statut_valide check (statut in ('brouillon', 'publiee', 'visible'));

create index if not exists presentations_statut_idx on public.presentations (statut);

-- 2. Droits de colonnes : le bénéficiaire modifie seulement le contenu, les photos, le statut et la date de modification.
--    Les dates de publication et de visibilité sont calculées par le déclencheur, jamais envoyées par le site.
revoke update on table public.presentations from authenticated;
grant update (content, photos, statut, updated_at) on table public.presentations to authenticated;

-- 3. Garde-fous : seul l'administrateur rend une présentation « visible » ; les dates suivent le statut
create or replace function public.presentations_garde_statut()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.statut = 'visible' and not public.is_admin() then
      raise exception 'Seul l''administrateur peut rendre une présentation visible aux partenaires';
    end if;
    new.visible_at := null;
    new.publiee_at := case when new.statut = 'brouillon' then null else now() end;
    return new;
  end if;

  if not public.is_admin() then
    -- Une présentation visible, modifiée par le bénéficiaire, repart en vérification.
    if old.statut = 'visible' and new.statut = 'visible'
       and (new.content is distinct from old.content or new.photos is distinct from old.photos) then
      new.statut := 'publiee';
    end if;
    if new.statut = 'visible' and old.statut is distinct from 'visible' then
      raise exception 'Seul l''administrateur peut rendre une présentation visible aux partenaires';
    end if;
  end if;

  if new.statut = 'brouillon' then
    new.publiee_at := null;
    new.visible_at := null;
  elsif new.statut = 'publiee' then
    new.publiee_at := case when old.statut = 'publiee' then old.publiee_at else now() end;
    new.visible_at := null;
  else
    new.publiee_at := coalesce(old.publiee_at, now());
    new.visible_at := case when old.statut = 'visible' then old.visible_at else now() end;
  end if;
  return new;
end $$;

drop trigger if exists presentations_garde_statut on public.presentations;
create trigger presentations_garde_statut
  before insert or update on public.presentations
  for each row execute function public.presentations_garde_statut();

-- 4. Notification de l'administrateur à chaque publication ou modification d'une présentation publiée
create or replace function public.presentation_notifie_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identifiant text;
  v_titre text;
  v_action text;
begin
  if public.is_admin() then return null; end if;
  if new.statut <> 'publiee' then return null; end if;

  if tg_op = 'UPDATE' then
    if old.statut = 'publiee' then
      if old.content is not distinct from new.content and old.photos is not distinct from new.photos then
        return null;
      end if;
      v_action := 'Présentation modifiée à vérifier';
    else
      v_action := 'Présentation publiée à vérifier';
    end if;
  else
    v_action := 'Présentation publiée à vérifier';
  end if;

  select identifiant into v_identifiant from public.profiles where id = new.user_id;
  v_titre := left(coalesce(nullif(new.content->>'titre', ''), 'Sans titre'), 120);

  insert into public.notifications (recipient_id, kind, title, body, link)
  select id, 'presentation', v_action, coalesce(v_identifiant, '—') || ' — ' || v_titre, '#/admin/presentations'
  from public.profiles where role = 'admin';
  return null;
end $$;

drop trigger if exists presentation_notifie_admin on public.presentations;
create trigger presentation_notifie_admin
  after insert or update on public.presentations
  for each row execute function public.presentation_notifie_admin();

-- 5. Lecture par l'administrateur : toutes les présentations publiées ou visibles, jamais les brouillons
drop policy if exists presentations_admin_lecture on public.presentations;
create policy presentations_admin_lecture on public.presentations
  for select to authenticated
  using (public.is_admin() and statut <> 'brouillon');

-- 6. Photos « visuels » : l'administrateur ne lit pas les photos d'un brouillon (les autres photos restent accessibles).
--    La vérification passe par une fonction SECURITY DEFINER : une sous-requête directe serait soumise à la RLS
--    de l'administrateur, qui masque justement les brouillons.
create or replace function public.photo_de_brouillon(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.presentations pr
    where pr.statut = 'brouillon' and pr.photos @> jsonb_build_array(p_name)
  )
$$;

revoke all on function public.photo_de_brouillon(text) from public, anon;
grant execute on function public.photo_de_brouillon(text) to authenticated;

drop policy if exists visuels_read on storage.objects;
create policy visuels_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'visuels' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (public.is_admin() and not public.photo_de_brouillon(storage.objects.name))
    )
  );

-- 7. Fonctions d'accès partenaire
create or replace function public.partner_can_see_presentation(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select my_partner_id() is not null and exists (
    select 1
    from public.presentations pr
    join public.beneficiaries b on b.user_id = pr.user_id
    join public.projects p on p.beneficiary_id = b.id
    where pr.user_id = p_user
      and pr.statut = 'visible'
      and b.status = 'active'
      and p.status in ('ready', 'in_progress', 'closed')
  )
$$;

-- Les photos de présentation rejoignent la règle de lecture des photos d'activité
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
      and public.partner_can_see_presentation(pr.user_id)
  )
$$;

-- Présentation d'un projet validé, si le bénéficiaire l'a rendue visible. Aucun identifiant de compte n'est renvoyé.
create or replace function public.partner_presentation(p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_pres record;
begin
  select b.user_id into v_user
  from public.projects p
  join public.beneficiaries b on b.id = p.beneficiary_id
  where p.id = p_project
    and p.status in ('ready', 'in_progress', 'closed')
    and b.status = 'active';

  if v_user is null or not public.partner_can_see_presentation(v_user) then
    return null;
  end if;

  select pr.content, pr.photos, pr.visible_at into v_pres
  from public.presentations pr
  where pr.user_id = v_user;

  return jsonb_build_object('content', v_pres.content, 'photos', v_pres.photos, 'visible_at', v_pres.visible_at);
end $$;

-- 8. Rubrique « Projets disponibles » : indique si la présentation du bénéficiaire est visible
drop function if exists public.partner_available_projects(text, text);

create function public.partner_available_projects(p_sector text default null, p_currency text default null)
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
      where pv.user_id = b.user_id
    ), false)
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

-- 9. Actions de l'administrateur : publier la visibilité ou la retirer
create or replace function public.admin_set_presentation_visibility(p_user uuid, p_visible boolean)
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

  select pr.statut into v_statut from public.presentations pr where pr.user_id = p_user;
  if v_statut is null then
    raise exception 'Cette personne n''a pas encore de présentation';
  end if;
  if v_statut = 'brouillon' then
    raise exception 'Cette présentation n''est pas encore publiée';
  end if;

  if p_visible and not exists (
    select 1
    from public.beneficiaries b
    join public.projects p on p.beneficiary_id = b.id
    where b.user_id = p_user
      and b.status = 'active'
      and p.status in ('ready', 'in_progress', 'closed')
  ) then
    raise exception 'Le bénéficiaire doit avoir un projet validé pour que sa présentation soit visible des partenaires';
  end if;

  update public.presentations
  set statut = case when p_visible then 'visible' else 'publiee' end
  where user_id = p_user;

  return case when p_visible then 'visible' else 'publiee' end;
end $$;

revoke all on function public.admin_set_presentation_visibility(uuid, boolean) from public, anon;
grant execute on function public.admin_set_presentation_visibility(uuid, boolean) to authenticated;

revoke all on function public.partner_presentation(uuid) from public, anon;
grant execute on function public.partner_presentation(uuid) to authenticated;

revoke all on function public.partner_can_see_presentation(uuid) from public, anon;
grant execute on function public.partner_can_see_presentation(uuid) to authenticated;
