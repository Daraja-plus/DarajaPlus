-- DarajaPlus — partenaires : présentation sans coordonnées, zone, quartier et rue, notification à la visibilité.
--
-- Règles validées par le promoteur (14 novembre 2026) :
--  * les coordonnées du bénéficiaire ne sont jamais montrées aux partenaires avant la conclusion du marché ;
--  * les partenaires voient le projet, l'identifiant, la rue, le quartier et la zone du bénéficiaire ;
--  * la rubrique « Vision et contact » n'est jamais transmise aux partenaires ;
--  * les partenaires actifs sont notifiés quand l'administrateur rend une présentation visible.
-- Migration additive : aucune table ni aucune donnée n'est modifiée.

-- 1. Rue du bénéficiaire : R1 (Gamma), R2 (Bêta), R3 (Alpha). Vide tant que la catégorie n'est pas attribuée.
create or replace function public.rue_de_categorie(p_category text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_category when 'bg' then 'R1' when 'bb' then 'R2' when 'ba' then 'R3' end
$$;

revoke all on function public.rue_de_categorie(text) from public, anon;
grant execute on function public.rue_de_categorie(text) to authenticated;

-- 2. Présentation transmise au partenaire : la rubrique « vision » (vision et contact) est retirée côté base.
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

  return jsonb_build_object(
    'content', coalesce(v_pres.content, '{}'::jsonb) - 'vision',
    'photos', v_pres.photos,
    'visible_at', v_pres.visible_at
  );
end $$;

-- 3. Rubrique « Projets disponibles » : zone, quartier et rue du bénéficiaire (pas de coordonnées, pas de code AH…).
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
      where pv.user_id = b.user_id
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

revoke all on function public.partner_available_projects(text, text) from public, anon;
grant execute on function public.partner_available_projects(text, text) to authenticated;

-- 4. Notification des partenaires actifs au moment où l'administrateur rend la présentation visible.
--    Le message donne la zone, le quartier, la rue, l'établissement, l'identifiant, le code AH… et la catégorie
--    seulement si le bénéficiaire est affecté et catégorisé. Il n'ajoute jamais de coordonnées.
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
  -- Une seule notification, au passage à « visible ».
  if new.statut is distinct from 'visible' then return null; end if;
  if tg_op = 'UPDATE' and old.statut is not distinct from 'visible' then return null; end if;

  select b.id, b.code, b.category, b.agent_id, b.quartier_id, pr.identifiant, pr.zone_id
    into v_ben
  from public.beneficiaries b
  left join public.profiles pr on pr.id = b.user_id
  where b.user_id = new.user_id;

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
  where p.beneficiary_id = v_ben.id
    and p.status in ('ready', 'in_progress', 'closed')
  order by p.created_at desc
  limit 1;

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

drop trigger if exists presentation_notifie_partenaires on public.presentations;
create trigger presentation_notifie_partenaires
  after insert or update on public.presentations
  for each row execute function public.presentation_notifie_partenaires();
