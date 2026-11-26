-- DarajaPlus — les 5 000 établissements (migration P1, 26 novembre 2026)
--
-- Décisions du promoteur (26 novembre 2026) :
--  1. Les 5 000 établissements existent dès maintenant, libres ou occupés
--     (50 quartiers × 100 : 10 en R1 Gamma, 30 en R2 Bêta, 60 en R3 Alpha).
--  2. Ils sont verrouillés. Seuls l'Administrateur, les Hôtes (leur zone) et les Agents
--     (leur quartier) les voient. Les partenaires n'en voient aucun à ce stade.
--  3. Chaque établissement a un code permanent, créé avec lui :
--       DP-C1-Z{zone}Q{rang}R{rue}P{place}-H{zone}A{rang}{catégorie}{ordre}
--     Exemple : DP-C1-Z1Q1R1P1-H1A1Bg1.
--  4. Pas d'attribution ici. Un établissement se libère ou s'occupe seulement
--     quand l'attribution (P2) le donne à une personne.
--
-- Choix techniques (à valider) :
--  - Table distincte de `establishments`. Les 3 entreprises existantes ne sont pas touchées.
--    Le déclencheur protect_establishment réécrit la classe à l'insertion : il ne convient pas
--    à 5 000 emplacements créés par l'Administrateur.
--  - La catégorie suit la rue (R1 = Bg, R2 = Bb, R3 = Ba), comme dans 20261120110000.
--  - Exemple corrigé : le message du promoteur associait R1 à « Ba1 ». La règle validée
--    (R1 = Gamma) l'emporte : le code porte Bg1, pas Ba1.
--  - « DP-C1 » est le même pour tous les codes : une seule Cité contient toutes les zones.
--    Ce sont les autres segments (zone, quartier, rue, place, hôte, agent, catégorie, ordre)
--    qui varient d'un emplacement à l'autre. Le code d'un emplacement ne change jamais.
--  - Le suffixe « ordre » est numéroté dans toute la Cité, par catégorie (Bg1 à Bg500, etc.).
--    Point ouvert : ordre dans toute la Cité, ou dans chaque quartier ?
--
-- Migration NON appliquée. Test en transaction annulée seulement.

-- -----------------------------------------------------------------------------
-- 1. Table
-- -----------------------------------------------------------------------------

create table public.etablissements (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  cite             smallint not null default 1 check (cite = 1),
  zone_id          smallint not null references public.zones(id),
  quartier_id      integer not null references public.quartiers(id),
  quartier_rang    smallint not null check (quartier_rang between 1 and 10),
  rue              smallint not null check (rue in (1, 2, 3)),
  categorie        text not null check (categorie in ('ba', 'bb', 'bg')),
  place            smallint not null check (place >= 1),
  ordre            integer not null check (ordre >= 1),
  owner_profile_id uuid references public.profiles(id),
  nom              text,
  statut           text generated always as (
                     case when owner_profile_id is null then 'libre' else 'occupe' end
                   ) stored,
  created_at       timestamptz not null default now(),
  constraint etablissements_rue_categorie check (
    (rue = 1 and categorie = 'bg') or (rue = 2 and categorie = 'bb') or (rue = 3 and categorie = 'ba')
  ),
  constraint etablissements_place_unique unique (quartier_id, rue, place),
  constraint etablissements_ordre_unique unique (categorie, ordre)
);

create index etablissements_owner_idx on public.etablissements (owner_profile_id);
create index etablissements_zone_quartier_idx on public.etablissements (zone_id, quartier_id);

-- -----------------------------------------------------------------------------
-- 2. Verrouillage : lecture seulement, selon le rôle ; aucune écriture directe
-- -----------------------------------------------------------------------------

alter table public.etablissements enable row level security;

revoke all on public.etablissements from anon, authenticated;
grant select on public.etablissements to authenticated;

create policy etablissements_read on public.etablissements
  for select to authenticated
  using (
    is_admin()
    or owner_profile_id = auth.uid()
    or (my_role() = 'host' and zone_id = my_zone())
    or (my_role() = 'agent' and quartier_id = my_quartier_id())
  );

-- Pas de politique d'insertion, de modification ni de suppression pour les comptes connectés :
-- les changements passeront par des fonctions contrôlées (P2 et suivantes).

-- -----------------------------------------------------------------------------
-- 3. Création des 5 000 emplacements
-- -----------------------------------------------------------------------------

insert into public.etablissements
  (code, cite, zone_id, quartier_id, quartier_rang, rue, categorie, place, ordre)
with quartiers_rang as (
  select q.id as quartier_id,
         q.zone_id,
         row_number() over (partition by q.zone_id order by q.id)::smallint as quartier_rang
    from public.quartiers q
),
rues(rue, categorie) as (
  values (1, 'bg'), (2, 'bb'), (3, 'ba')
),
places as (
  select qr.quartier_id, qr.zone_id, qr.quartier_rang, r.rue, r.categorie,
         p.place::smallint as place
    from quartiers_rang qr
   cross join rues r
   cross join lateral generate_series(1, public.places_de_rue(r.categorie)) as p(place)
),
numerotes as (
  select pl.*,
         row_number() over (partition by pl.categorie order by pl.quartier_id, pl.place)::integer as ordre
    from places pl
)
select
  'DP-C1-Z' || n.zone_id || 'Q' || n.quartier_rang || 'R' || n.rue || 'P' || n.place
    || '-H' || n.zone_id || 'A' || n.quartier_rang || initcap(n.categorie) || n.ordre,
  1, n.zone_id, n.quartier_id, n.quartier_rang, n.rue, n.categorie, n.place, n.ordre
from numerotes n;

-- -----------------------------------------------------------------------------
-- 4. Contrôle : la migration échoue (et rien n'est gardé) si le compte n'est pas exact
-- -----------------------------------------------------------------------------

do $verification$
declare
  v_total integer;
  v_libres integer;
  v_mauvais_quartier integer;
begin
  select count(*) into v_total from public.etablissements;
  if v_total <> 5000 then
    raise exception 'Attendu 5000 établissements, trouvé %', v_total;
  end if;

  select count(*) into v_libres from public.etablissements where statut <> 'libre';
  if v_libres <> 0 then
    raise exception 'Aucun établissement ne doit être occupé à la création (trouvé %)', v_libres;
  end if;

  select count(*) into v_mauvais_quartier
    from (select quartier_id from public.etablissements group by quartier_id having count(*) <> 100) x;
  if v_mauvais_quartier <> 0 then
    raise exception 'Chaque quartier doit compter exactement 100 établissements';
  end if;
end $verification$;
