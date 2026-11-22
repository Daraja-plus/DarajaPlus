-- DarajaPlus — vues des publications, portée « quartier » et « rue » (migration du 22 novembre 2026)
--
-- Décisions du promoteur (22 novembre 2026) :
--  1. Une « rue » est une classe (R1, R2 ou R3) à l'intérieur d'un quartier. Pas de nouvelle table.
--     R1 = Gamma, R2 = Bêta, R3 = Alpha (fonction rue_de_categorie).
--  2. Ciblage par niveau :
--       Administrateur : toute la plateforme, une zone, un quartier, une rue ;
--       Hôte : une zone (la sienne), un quartier ou une rue de sa zone ;
--       Agent : son quartier, ou une rue de son quartier.
--     Le ciblage vaut pour les annonces et pour les offres publiées par les Agents.
--     Les offres des partenaires restent ciblées par catégorie (Ba, Bb, Bg) et visibles de tous.
--  3. Vues : une personne compte pour une vue par publication. L'auteur et l'Administrateur ne sont pas comptés.
--  4. Option par publication « l'auteur peut voir les vues ». Elle est désactivée par défaut et seul
--     l'Administrateur peut la régler.
--
-- Points à confirmer (choix par défaut, non validés) :
--  a. Un partenaire ne voit que les offres de portée « toute la plateforme ». Il ne voit pas les offres
--     d'un Agent ciblées sur un quartier ou une rue. Les données existantes ne sont pas concernées
--     (aucune offre n'est publiée à ce jour).
--  b. Les vues de l'Administrateur ne sont pas comptées.
--
-- Dépendances : rue_de_categorie (20261114100000), quartiers (20261120100000),
--               rue_et_place (20261120110000), agent_publish_offer (version précédente).
-- Migration NON appliquée : à valider par le promoteur avant mise en production.
-- Les données existantes ne sont pas modifiées par ce fichier.

-- -----------------------------------------------------------------------------
-- 1. Colonnes : portée, rue, option « l'auteur voit les vues »
-- -----------------------------------------------------------------------------

alter table public.announcements
  add column if not exists quartier_id integer references public.quartiers(id),
  add column if not exists rue text check (rue in ('R1', 'R2', 'R3')),
  add column if not exists views_for_author boolean not null default false;

alter table public.announcements drop constraint if exists announcements_audience_check;
alter table public.announcements add constraint announcements_audience_check
  check (audience in ('all', 'zone', 'quartier', 'rue', 'agent_beneficiaries'));

alter table public.announcements drop constraint if exists announcements_portee_check;
alter table public.announcements add constraint announcements_portee_check check (
  (audience <> 'quartier' or (quartier_id is not null and rue is null))
  and (audience <> 'rue' or (quartier_id is not null and rue is not null))
);

alter table public.offers
  add column if not exists audience text not null default 'all' check (audience in ('all', 'zone', 'quartier', 'rue')),
  add column if not exists quartier_id integer references public.quartiers(id),
  add column if not exists rue text check (rue in ('R1', 'R2', 'R3')),
  add column if not exists views_for_author boolean not null default false;

alter table public.offers drop constraint if exists offers_portee_check;
alter table public.offers add constraint offers_portee_check check (
  (audience <> 'zone' or zone_id is not null)
  and (audience <> 'quartier' or (quartier_id is not null and rue is null))
  and (audience <> 'rue' or (quartier_id is not null and rue is not null))
);

create index if not exists announcements_quartier_idx on public.announcements (quartier_id);
create index if not exists offers_quartier_idx on public.offers (quartier_id);

-- -----------------------------------------------------------------------------
-- 2. Fonctions d'accès
-- -----------------------------------------------------------------------------

-- Quartier de l'Agent connecté (null pour les autres comptes).
create or replace function public.my_quartier_id()
returns integer
language sql stable security definer
set search_path = public
as $$
  select quartier_id from profiles where id = auth.uid() and role = 'agent' and status = 'active'
$$;

-- Vrai si le compte connecté peut voir une publication ciblée sur un quartier (et, si précisé, sur une rue) :
--  - l'Agent rattaché à ce quartier ;
--  - l'Hôte de la zone de ce quartier ;
--  - le bénéficiaire du quartier, et seulement si la rue est précisée, celui dont la catégorie correspond à cette rue.
create or replace function public.peut_voir_quartier(p_quartier integer, p_rue text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
      select 1 from profiles p join quartiers q on q.id = p_quartier
      where p.id = auth.uid() and p.status = 'active'
        and ((p.role = 'agent' and p.quartier_id = p_quartier)
          or (p.role = 'host' and p.zone_id = q.zone_id))
  )
  or exists (
      select 1 from beneficiaries b
      where b.user_id = auth.uid() and b.quartier_id = p_quartier
        and (p_rue is null or rue_de_categorie(b.category) = p_rue)
  )
$$;

-- -----------------------------------------------------------------------------
-- 3. Droits de lecture et de publication des annonces
-- -----------------------------------------------------------------------------

drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements for select using (
  is_admin() or author_id = auth.uid() or (status = 'visible' and (
       (audience = 'all' and is_active())
    or (audience = 'zone' and zone_id = my_zone())
    or (audience = 'agent_beneficiaries' and (agent_id = auth.uid() or agent_id = my_agent_id()))
    or (audience in ('quartier', 'rue') and is_active() and peut_voir_quartier(quartier_id, rue))
  ))
);

drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements for insert with check (
  author_id = auth.uid() and (
    is_admin()
    or (my_role() = 'host' and (
          (audience = 'zone' and zone_id = my_zone())
       or (audience in ('quartier', 'rue') and exists (
            select 1 from quartiers q
             where q.id = announcements.quartier_id and q.zone_id = my_zone()))
       ))
    or (my_role() = 'agent' and (
          (audience = 'agent_beneficiaries' and agent_id = auth.uid())
       or (audience in ('quartier', 'rue') and quartier_id = my_quartier_id())
       ))
  )
);

-- -----------------------------------------------------------------------------
-- 4. Droits de lecture et de publication des offres
-- -----------------------------------------------------------------------------

drop policy if exists offers_read on public.offers;
create policy offers_read on public.offers for select using (
  is_admin() or author_id = auth.uid() or (status = 'published' and is_active() and (
       audience = 'all'
    or (audience = 'zone' and zone_id = my_zone())
    or (audience in ('quartier', 'rue') and peut_voir_quartier(quartier_id, rue))
  ))
);

-- Un partenaire publie pour toute la plateforme ; le ciblage par catégorie se fait par target_category.
drop policy if exists offers_insert on public.offers;
create policy offers_insert on public.offers for insert with check (
  author_kind = 'partner' and author_id = auth.uid() and partner_id = my_partner_id() and audience = 'all'
);

-- Seul l'Administrateur peut activer « l'auteur voit les vues ». Un auteur ne peut ni l'activer, ni la modifier.
create or replace function public.proteger_option_vues()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if is_admin() then return new; end if;
  if tg_op = 'INSERT' then new.views_for_author := false;
  else new.views_for_author := old.views_for_author;
  end if;
  return new;
end $$;

drop trigger if exists announcements_option_vues on public.announcements;
create trigger announcements_option_vues before insert or update on public.announcements
  for each row execute function public.proteger_option_vues();

drop trigger if exists offers_option_vues on public.offers;
create trigger offers_option_vues before insert or update on public.offers
  for each row execute function public.proteger_option_vues();

-- -----------------------------------------------------------------------------
-- 5. Vues : table, enregistrement, comptage
-- -----------------------------------------------------------------------------

create table if not exists public.publication_views (
  kind text not null check (kind in ('annonce', 'offre')),
  pub_id uuid not null,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  primary key (kind, pub_id, viewer_id)
);

alter table public.publication_views enable row level security;
revoke all on public.publication_views from anon, authenticated;
grant insert on public.publication_views to authenticated;

-- Une vue ne s'enregistre que pour une publication visible du compte, et jamais pour son auteur.
drop policy if exists publication_views_insert on public.publication_views;
create policy publication_views_insert on public.publication_views for insert to authenticated with check (
  viewer_id = auth.uid() and (
    (publication_views.kind = 'annonce' and exists (
        select 1 from announcements a
         where a.id = publication_views.pub_id and a.author_id <> auth.uid()))
    or (publication_views.kind = 'offre' and exists (
        select 1 from offers o
         where o.id = publication_views.pub_id and o.author_id <> auth.uid()))
  )
);

-- Appelée par l'application. Les lignes invisibles pour le compte sont ignorées par les politiques de lecture.
create or replace function public.enregistrer_vues(p_kind text, p_ids uuid[])
returns integer
language plpgsql security invoker
set search_path = public
as $$
declare n integer := 0;
begin
  if is_admin() or not is_active() or p_ids is null then return 0; end if;
  if p_kind = 'annonce' then
    insert into publication_views (kind, pub_id, viewer_id)
    select 'annonce', a.id, auth.uid() from announcements a
     where a.id = any(p_ids) and a.author_id <> auth.uid()
    on conflict do nothing;
  elsif p_kind = 'offre' then
    insert into publication_views (kind, pub_id, viewer_id)
    select 'offre', o.id, auth.uid() from offers o
     where o.id = any(p_ids) and o.author_id <> auth.uid()
    on conflict do nothing;
  else
    raise exception 'Type de publication inconnu';
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- Nombre de vues par publication. L'Administrateur voit toutes les publications ;
-- un auteur ne voit que les siennes, et seulement si l'option « l'auteur voit les vues » est activée.
create or replace function public.compter_vues(p_kind text)
returns table (publication_id uuid, vues bigint)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if p_kind = 'annonce' then
    return query
      select a.id, count(v.pub_id)::bigint
        from announcements a
        left join publication_views v on v.kind = 'annonce' and v.pub_id = a.id
       where is_admin() or (a.author_id = auth.uid() and a.views_for_author)
       group by a.id;
  elsif p_kind = 'offre' then
    return query
      select o.id, count(v.pub_id)::bigint
        from offers o
        left join publication_views v on v.kind = 'offre' and v.pub_id = o.id
       where is_admin() or (o.author_id = auth.uid() and o.views_for_author)
       group by o.id;
  else
    raise exception 'Type de publication inconnu';
  end if;
end $$;

revoke execute on function public.enregistrer_vues(text, uuid[]) from public, anon;
grant execute on function public.enregistrer_vues(text, uuid[]) to authenticated;
revoke execute on function public.compter_vues(text) from public, anon;
grant execute on function public.compter_vues(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Publication des Agents : portée quartier ou rue (remplace la version précédente)
-- -----------------------------------------------------------------------------

drop function if exists public.agent_publish_offer(text, text, text, text, text, numeric, numeric, text, date);

create or replace function public.agent_publish_offer(
  p_title text, p_offer_type text, p_description text, p_target_category text, p_sector text,
  p_amount_min numeric, p_amount_max numeric, p_currency text, p_deadline date,
  p_audience text default 'quartier', p_rue text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_free int;
  v_used int;
  v_paid boolean;
  v_id uuid;
  v_quartier integer := my_quartier_id();
begin
  if my_role() <> 'agent' then raise exception 'Réservé aux Agents actifs'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Titre obligatoire'; end if;
  if v_quartier is null then raise exception 'Aucun quartier n''est rattaché à votre compte'; end if;
  if p_audience not in ('quartier', 'rue') then
    raise exception 'Un Agent publie pour son quartier, ou pour une rue de son quartier';
  end if;
  if p_audience = 'rue' and p_rue not in ('R1', 'R2', 'R3') then raise exception 'Rue incorrecte'; end if;
  if p_audience = 'quartier' then p_rue := null; end if;

  v_free := (select (value::text)::int from settings where key = 'agent_free_offers_per_month');
  select count(*) into v_used from offers
   where author_id = auth.uid() and author_kind = 'agent' and is_paid = false
     and publication_month = to_char(now(), 'YYYY-MM');
  v_paid := v_used >= v_free;
  insert into offers (author_id, author_kind, title, offer_type, description, target_category, sector,
                      zone_id, amount_min, amount_max, currency, deadline, is_paid, status,
                      audience, quartier_id, rue)
  values (auth.uid(), 'agent', trim(p_title), p_offer_type, p_description, p_target_category, p_sector,
          my_zone(), p_amount_min, p_amount_max, coalesce(p_currency, 'USD'), p_deadline, v_paid,
          case when v_paid then 'pending_payment' else 'published' end,
          p_audience, v_quartier, p_rue)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'paid', v_paid, 'free_used', v_used + case when v_paid then 0 else 1 end,
                            'free_quota', v_free);
end $$;

revoke execute on function public.agent_publish_offer(text, text, text, text, text, numeric, numeric, text, date, text, text) from public, anon;
grant execute on function public.agent_publish_offer(text, text, text, text, text, numeric, numeric, text, date, text, text) to authenticated;
