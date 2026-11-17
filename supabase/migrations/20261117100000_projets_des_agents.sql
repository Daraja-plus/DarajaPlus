-- DarajaPlus — les agents peuvent créer leurs propres projets (17 novembre 2026).
--
-- Décision du promoteur (17 novembre 2026) : les agents créent aussi des projets, pour eux-mêmes.
-- Un projet d'agent n'a pas de fiche bénéficiaire : projects.beneficiary_id est vide et
-- projects.created_by désigne l'agent. Il suit le même parcours qu'un projet de bénéficiaire :
-- l'agent rédige et publie sa présentation, l'administrateur la vérifie, puis elle devient visible
-- des partenaires une fois le projet validé.
-- Les annonces des agents ne changent pas (elles existent déjà dans l'espace agent).
-- Les projets et présentations existants ne sont pas modifiés. Aucune donnée n'est supprimée.

-- 1. Un projet peut ne pas avoir de fiche bénéficiaire, à condition d'avoir un créateur.
alter table public.projects alter column beneficiary_id drop not null;
alter table public.projects drop constraint if exists projects_porteur_present;
alter table public.projects add constraint projects_porteur_present
  check (beneficiary_id is not null or created_by is not null);

-- 2. Lecture et modification. Un agent voit et modifie les projets qu'il a créés (sans fiche bénéficiaire).
drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select using (
  is_admin()
  or can_access_beneficiary(beneficiary_id)
  or (beneficiary_id is null and created_by = auth.uid())
  or exists (
    select 1 from public.connection_requests c
    where c.project_id = projects.id and c.partner_id = my_partner_id()
  )
);

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update
  using (is_admin() or can_access_beneficiary(beneficiary_id) or (beneficiary_id is null and created_by = auth.uid()))
  with check (is_admin() or can_access_beneficiary(beneficiary_id) or (beneficiary_id is null and created_by = auth.uid()));

-- 3. Le changement de statut reste réservé à l'équipe. Pour un projet d'agent (sans fiche bénéficiaire),
--    seul l'administrateur peut valider : un agent ne valide pas son propre projet.
create or replace function public.protect_project()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.status is distinct from old.status
     and new.status in ('ready','in_progress','closed')
     and not (is_admin() or (my_role() in ('host','agent') and new.beneficiary_id is not null)) then
    raise exception 'Ce statut est attribué par l''équipe après contrôle';
  end if;
  new.updated_at := now();
  return new;
end $function$;

-- 4. Création directe d'une présentation par son porteur (bénéficiaire, ou agent pour son propre projet).
drop policy if exists presentations_proprietaire_creation on public.presentations;
create policy presentations_proprietaire_creation on public.presentations for insert with check (
  user_id = auth.uid()
  and project_id is not null
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('beneficiary', 'agent'))
  and exists (
    select 1
    from public.projects pr
    left join public.beneficiaries b on b.id = pr.beneficiary_id
    where pr.id = presentations.project_id
      and (b.user_id = auth.uid() or (pr.beneficiary_id is null and pr.created_by = auth.uid()))
  )
);

-- 5. « Présenter mon projet » : un bénéficiaire, ou un agent pour son propre projet.
--    Un agent n'a pas de fiche bénéficiaire : son projet est rattaché à son compte (created_by).
create or replace function public.presentation_enregistrer(
  p_projet uuid, p_amount numeric, p_currency text, p_content jsonb, p_photos jsonb, p_statut text,
  p_sector text, p_establishment_id uuid, p_description text, p_use_of_funds text, p_due_date date)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_ben uuid;
  v_projet uuid;
  v_pending uuid;
  v_cle text;
  v_titre text;
begin
  if v_user is null then
    raise exception 'Connexion requise';
  end if;
  select p.role into v_role from public.profiles p where p.id = v_user;
  if v_role is null or v_role not in ('beneficiary', 'agent') then
    raise exception 'Réservé aux bénéficiaires et aux agents';
  end if;
  if v_role = 'beneficiary' then
    select b.id into v_ben from public.beneficiaries b where b.user_id = v_user;
    if v_ben is null then
      raise exception 'Aucune fiche bénéficiaire pour ce compte';
    end if;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Le montant doit être supérieur à 0.';
  end if;
  if p_currency is null or p_currency not in ('USD', 'FC') then
    raise exception 'Devise non reconnue';
  end if;
  if p_statut is null or p_statut not in ('brouillon', 'publiee') then
    raise exception 'Statut de présentation non autorisé';
  end if;
  v_titre := btrim(coalesce(p_content->>'titre', ''));
  if char_length(v_titre) = 0 or char_length(v_titre) > 120 then
    raise exception 'Le titre est obligatoire (120 caractères au maximum)';
  end if;
  if p_statut = 'publiee' then
    foreach v_cle in array array['probleme', 'solution', 'produit', 'marche', 'modele', 'concurrence', 'go_to_market', 'equipe', 'demande', 'vision'] loop
      if char_length(btrim(coalesce(p_content->>v_cle, ''))) = 0 then
        raise exception 'Pour publier, toutes les rubriques doivent être remplies';
      end if;
    end loop;
  end if;
  if p_establishment_id is not null and not exists (
    select 1 from public.establishments e where e.id = p_establishment_id and e.created_by = v_user
  ) then
    raise exception 'Entreprise non reconnue : choisissez une entreprise que vous avez créée';
  end if;

  if p_projet is null then
    insert into public.projects (beneficiary_id, created_by, title, amount, currency, sector, establishment_id,
                                 description, use_of_funds, due_date, status)
    values (v_ben, v_user, v_titre, p_amount, p_currency, nullif(p_sector, ''), p_establishment_id,
            nullif(p_description, ''), nullif(p_use_of_funds, ''), p_due_date, 'draft')
    returning id into v_projet;

    select pr.id into v_pending
    from public.presentations pr
    where pr.user_id = v_user and pr.project_id is null
    order by pr.updated_at desc
    limit 1;

    if v_pending is not null then
      update public.presentations
      set project_id = v_projet, content = p_content, photos = p_photos, statut = p_statut, updated_at = now()
      where id = v_pending;
    else
      insert into public.presentations (user_id, project_id, content, photos, statut, updated_at)
      values (v_user, v_projet, p_content, p_photos, p_statut, now());
    end if;
  else
    update public.projects
    set title = v_titre, amount = p_amount, currency = p_currency, sector = nullif(p_sector, ''),
        establishment_id = p_establishment_id, description = nullif(p_description, ''),
        use_of_funds = nullif(p_use_of_funds, ''), due_date = p_due_date
    where id = p_projet
      and ((v_ben is not null and beneficiary_id = v_ben)
        or (v_ben is null and beneficiary_id is null and created_by = v_user))
    returning id into v_projet;
    if v_projet is null then
      raise exception 'Projet introuvable ou non rattaché à votre compte';
    end if;

    update public.presentations
    set content = p_content, photos = p_photos, statut = p_statut, updated_at = now()
    where project_id = v_projet;
    if not found then
      insert into public.presentations (user_id, project_id, content, photos, statut, updated_at)
      values (v_user, v_projet, p_content, p_photos, p_statut, now());
    end if;
  end if;

  return v_projet;
end $function$;

-- 6. Visibilité : le projet doit être validé et son porteur actif
--    (bénéficiaire actif, ou agent actif pour un projet d'agent).
create or replace function public.partner_can_see_presentation(p_project uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select my_partner_id() is not null and exists (
    select 1
    from public.presentations pr
    join public.projects p on p.id = pr.project_id
    left join public.beneficiaries b on b.id = p.beneficiary_id
    left join public.profiles po on po.id = p.created_by
    where pr.project_id = p_project
      and pr.statut = 'visible'
      and p.status in ('ready', 'in_progress', 'closed')
      and ((p.beneficiary_id is not null and b.status = 'active')
        or (p.beneficiary_id is null and po.role = 'agent' and po.status = 'active'))
  )
$function$;

-- 7. Projets disponibles pour les partenaires. Un projet d'agent apparaît avec la zone et l'identifiant
--    de l'agent ; le quartier, la rue et la catégorie restent vides pour lui.
-- Le retour change (colonne porteur_role) : la fonction est supprimée puis recréée, puis les droits d'origine sont rétablis.
drop function if exists public.partner_available_projects(text, text);
create function public.partner_available_projects(p_sector text default null::text, p_currency text default null::text)
 returns table(project_id uuid, reference text, title text, sector text, description text, use_of_funds text, amount numeric, currency text, due_date date, status text, created_at timestamp with time zone, beneficiary_identifiant text, category text, zone text, quartier text, rue text, establishment_name text, establishment_sector text, establishment_description text, establishment_services text, photos jsonb, connection_status text, presentation_visible boolean, porteur_role text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
    ), false),
    case when p.beneficiary_id is null then 'agent' else 'beneficiary' end
  from public.projects p
  left join public.beneficiaries b on b.id = p.beneficiary_id
  left join public.profiles pr on pr.id = case when p.beneficiary_id is null then p.created_by else b.user_id end
  left join public.quartiers q on q.id = b.quartier_id
  left join public.zones z on z.id = coalesce(q.zone_id, pr.zone_id)
  left join public.establishments e on e.id = p.establishment_id
  where my_partner_id() is not null
    and p.status in ('ready', 'in_progress', 'closed')
    and ((p.beneficiary_id is not null and b.status = 'active')
      or (p.beneficiary_id is null and pr.role = 'agent' and pr.status = 'active'))
    and (p_sector is null or p.sector ilike '%' || p_sector || '%')
    and (p_currency is null or p.currency = p_currency)
  order by p.created_at desc
  limit 200
$function$;

-- Droits d'origine (production) : authentifiés et service uniquement, pas anonyme ni public.
revoke all on function public.partner_available_projects(text, text) from public, anon;
grant execute on function public.partner_available_projects(text, text) to authenticated, service_role;

-- 8. Notification des partenaires au passage à « visible ». Texte inchangé pour les bénéficiaires ;
--    pour un projet d'agent : zone et établissement, avec l'identifiant de l'agent.
create or replace function public.presentation_notifie_partenaires()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ben record;
  v_agent_projet boolean;
  v_ident text;
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

  select p.beneficiary_id is null into v_agent_projet
  from public.projects p where p.id = new.project_id;
  if v_agent_projet is null then return null; end if;

  select e.name into v_etablissement
  from public.projects p
  left join public.establishments e on e.id = p.establishment_id
  where p.id = new.project_id;

  if v_agent_projet then
    select pr.identifiant, coalesce(z.name, 'non précisée') into v_ident, v_zone
    from public.projects p
    join public.profiles pr on pr.id = p.created_by
    left join public.zones z on z.id = pr.zone_id
    where p.id = new.project_id;

    v_corps := 'Un projet est disponible : zone ' || v_zone
      || ', établissement ' || coalesce(v_etablissement, 'non précisé')
      || ' (identifiant ' || coalesce(v_ident, 'non précisé') || ').';
  else
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
  end if;

  insert into public.notifications (recipient_id, kind, title, body, link)
  select pa.profile_id, 'projet', 'Nouveau projet disponible', v_corps, '#/partenaire/recherche'
  from public.partners pa
  join public.profiles pr on pr.id = pa.profile_id
  where pr.role = 'partner' and pr.status = 'active';

  return null;
end $function$;

-- 9. Validation par l'administrateur : le projet doit être validé et son porteur actif
--    (bénéficiaire actif, ou agent actif pour un projet d'agent).
create or replace function public.admin_set_presentation_visibility(p_project uuid, p_visible boolean)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    left join public.beneficiaries b on b.id = p.beneficiary_id
    left join public.profiles po on po.id = p.created_by
    where p.id = p_project
      and p.status in ('ready', 'in_progress', 'closed')
      and ((p.beneficiary_id is not null and b.status = 'active')
        or (p.beneficiary_id is null and po.role = 'agent' and po.status = 'active'))
  ) then
    raise exception 'Le projet doit être validé pour que sa présentation soit visible des partenaires';
  end if;

  update public.presentations
  set statut = case when p_visible then 'visible' else 'publiee' end
  where project_id = p_project;

  return case when p_visible then 'visible' else 'publiee' end;
end $function$;
