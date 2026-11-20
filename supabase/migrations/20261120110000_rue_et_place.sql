-- DarajaPlus — rue et place dans la rue (migration du 20 novembre 2026)
--
-- Décisions du promoteur (20 novembre 2026) :
--  1. La rue suit la catégorie : Gamma → R1, Bêta → R2, Alpha → R3 (fonction rue_de_categorie).
--  2. Places par quartier : 10 en R1, 30 en R2, 60 en R3 (100 au total). Les plafonds viennent de cap().
--  3. La place est attribuée automatiquement : premier numéro libre dans la rue du quartier (1, 2, 3…).
--     Rue pleine : l'opération est refusée.
--  4. La classe de l'établissement (R1, R2, R3) suit la catégorie du bénéficiaire.
--     Elle n'est plus réglée à la main.
--
-- Dépendances : rue_de_categorie (20261114100000), affectation_en_cours (20261112100000),
--               cap() et les déclencheurs de 20261120100000 (quartier automatique).
-- Migration NON appliquée. Les données existantes ne sont pas modifiées ici :
-- le rattrapage est dans supabase/scripts/rue_rattrapage.sql, à lancer après validation.

-- -----------------------------------------------------------------------------
-- 1. Places : colonne, capacité par rue, unicité
-- -----------------------------------------------------------------------------

alter table public.beneficiaries add column if not exists place_rue smallint;

create or replace function public.places_de_rue(p_category text)
returns integer
language sql
stable
set search_path to 'public'
as $$
  select (case p_category
            when 'bg' then cap('bg_per_agent')
            when 'bb' then cap('bb_per_agent')
            when 'ba' then cap('ba_per_agent')
          end)::integer
$$;

revoke all on function public.places_de_rue(text) from public, anon, authenticated;

-- Deux bénéficiaires ne peuvent pas avoir la même place dans la même rue d'un même quartier.
create unique index if not exists beneficiaries_place_rue_unique
  on public.beneficiaries (quartier_id, category, place_rue)
  where place_rue is not null;


-- -----------------------------------------------------------------------------
-- 2. Quartier puis place : une seule fonction, dans cet ordre
--    Remplace beneficiary_quartier_de_l_agent de la migration 20261120100000.
--    Le drapeau daraja.place = 'off' ne calcule pas la place : la propagation la numérote en bloc.
-- -----------------------------------------------------------------------------

create or replace function public.beneficiary_quartier_de_l_agent()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_place integer;
begin
  -- 1. Quartier : celui de l'Agent.
  if new.agent_id is null then
    new.quartier_id := null;
  else
    select p.quartier_id into new.quartier_id from profiles p where p.id = new.agent_id;
  end if;

  -- 2. Place dans la rue : sans quartier ou sans catégorie, pas de place.
  if new.quartier_id is null or new.category is null then
    new.place_rue := null;
    return new;
  end if;

  -- Rien n'a changé pour la rue : la place est gardée.
  if tg_op = 'UPDATE' then
    if old.place_rue is not null
       and old.quartier_id is not distinct from new.quartier_id
       and old.category is not distinct from new.category then
      new.place_rue := old.place_rue;
      return new;
    end if;
  end if;

  -- Propagation en bloc : la place est numérotée par renumeroter_places_agent.
  if coalesce(current_setting('daraja.place', true), '') = 'off' then
    return new;
  end if;

  -- Premier numéro libre dans la rue (quartier + catégorie).
  perform pg_advisory_xact_lock(hashtext('place-rue:' || new.quartier_id::text || ':' || new.category));

  select min(g) into v_place
    from generate_series(1, public.places_de_rue(new.category)) as g
   where not exists (
     select 1 from public.beneficiaries b
      where b.quartier_id = new.quartier_id
        and b.category = new.category
        and b.place_rue = g
        and b.id is distinct from new.id);

  if v_place is null then
    raise exception 'Rue pleine : toutes les places de cette rue sont déjà attribuées dans ce quartier.';
  end if;

  new.place_rue := v_place;
  return new;
end $$;


-- -----------------------------------------------------------------------------
-- 3. Changement du quartier d'un Agent : ses bénéficiaires suivent, places numérotées en bloc
--    Remplace agent_quartier_propage de la migration 20261120100000.
--    Le quartier cible est toujours vide d'autres bénéficiaires (premier quartier libre).
-- -----------------------------------------------------------------------------

create or replace function public.renumeroter_places_agent(p_agent uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_prev text := coalesce(current_setting('daraja.place', true), '');
begin
  perform set_config('daraja.place', 'off', true);

  with ordre as (
    select b.id,
           row_number() over (partition by b.category order by b.created_at, b.id) as n
      from public.beneficiaries b
     where b.agent_id = p_agent
       and b.quartier_id is not null
       and b.category is not null
  )
  update public.beneficiaries b
     set place_rue = o.n::smallint
    from ordre o
   where o.id = b.id;

  perform set_config('daraja.place', v_prev, true);

  if exists (
    select 1 from public.beneficiaries b
     where b.agent_id = p_agent
       and b.place_rue > public.places_de_rue(b.category)
  ) then
    raise exception 'Rue pleine : l''Agent a plus de bénéficiaires que de places dans la rue.';
  end if;
end $$;

revoke all on function public.renumeroter_places_agent(uuid) from public, anon, authenticated;

create or replace function public.agent_quartier_propage()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_affectation text := coalesce(current_setting('daraja.affectation', true), '');
  v_place text := coalesce(current_setting('daraja.place', true), '');
begin
  if new.role = 'agent' and new.quartier_id is distinct from old.quartier_id then
    perform set_config('daraja.affectation', 'on', true);
    perform set_config('daraja.place', 'off', true);
    -- Les places sont vidées, puis numérotées en bloc (évite les doublons dans une même instruction).
    update public.beneficiaries
       set quartier_id = new.quartier_id, place_rue = null
     where agent_id = new.id;
    perform public.renumeroter_places_agent(new.id);
    update public.profiles
       set quartier_id = new.quartier_id
     where role = 'beneficiary' and agent_id = new.id;
    perform set_config('daraja.place', v_place, true);
    perform set_config('daraja.affectation', v_affectation, true);
  end if;
  return new;
end $$;


-- -----------------------------------------------------------------------------
-- 4. Classe de l'établissement : elle suit la catégorie du bénéficiaire
-- -----------------------------------------------------------------------------

-- Garde des établissements : la classe n'est plus réglée à la main, sauf par le rattachement.
create or replace function public.protect_establishment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    if not (is_admin() or my_role() in ('host', 'agent')) then
      new.verification_status := 'to_verify';
    end if;
    -- La classe suit la catégorie du bénéficiaire qui a créé l'entreprise (vide sans catégorie).
    select public.rue_de_categorie(b.category) into new.class
      from public.beneficiaries b
     where b.user_id = new.created_by
     limit 1;
    return new;
  end if;

  if new.verification_status is distinct from old.verification_status
     and not (is_admin() or my_role() = 'host') then
    raise exception 'La vérification est réservée à l''Hôte ou à l''Administrateur';
  end if;

  if new.class is distinct from old.class and not affectation_en_cours() then
    raise exception 'La classe (R1, R2, R3) suit la catégorie du bénéficiaire : elle ne se règle pas à la main';
  end if;
  return new;
end $$;

-- Changement de catégorie : la classe de l'entreprise du bénéficiaire suit.
create or replace function public.beneficiary_classe_de_categorie()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_affectation text := coalesce(current_setting('daraja.affectation', true), '');
begin
  if new.user_id is not null and new.category is distinct from old.category then
    perform set_config('daraja.affectation', 'on', true);
    update public.establishments e
       set class = public.rue_de_categorie(new.category)
     where e.created_by = new.user_id
       and e.class is distinct from public.rue_de_categorie(new.category);
    perform set_config('daraja.affectation', v_affectation, true);
  end if;
  return new;
end $$;

revoke all on function public.beneficiary_classe_de_categorie() from public, anon, authenticated;

drop trigger if exists beneficiary_classe_de_categorie on public.beneficiaries;
create trigger beneficiary_classe_de_categorie
  after update of category on public.beneficiaries
  for each row execute function public.beneficiary_classe_de_categorie();
