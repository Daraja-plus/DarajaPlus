-- DarajaPlus — rattrapage des places dans la rue et des classes d'établissement
--
-- NE PAS LANCER avant :
--   1. la validation de la liste de correction (quartiers des Agents et des bénéficiaires) ;
--   2. l'application de la migration 20261120110000_rue_et_place.sql ;
--   3. le rattrapage des quartiers (affectation des 13 Agents sans quartier).
-- Lancer dans l'éditeur SQL, en une seule fois. Vérifier les contrôles avant le COMMIT ;
-- en cas de doute, remplacer COMMIT par ROLLBACK.

begin;

-- 1. Places : numérotées par quartier et par rue, dans l'ordre de création.
--    Le déclencheur est désactivé le temps de la mise à jour en bloc.
alter table public.beneficiaries disable trigger beneficiary_quartier_de_l_agent;

with ordre as (
  select b.id,
         row_number() over (partition by b.quartier_id, b.category order by b.created_at, b.id) as n
    from public.beneficiaries b
   where b.quartier_id is not null
     and b.category is not null
)
update public.beneficiaries b
   set place_rue = o.n::smallint
  from ordre o
 where o.id = b.id;

alter table public.beneficiaries enable trigger beneficiary_quartier_de_l_agent;

-- 2. Contrôle : aucune rue ne dépasse sa capacité (résultat attendu : aucune ligne).
select b.quartier_id, b.category, count(*) as nb, public.places_de_rue(b.category) as places
  from public.beneficiaries b
 where b.place_rue is not null
 group by b.quartier_id, b.category
having count(*) > public.places_de_rue(b.category);

-- 3. Classes des établissements : elles suivent la catégorie de leur bénéficiaire.
select set_config('daraja.affectation', 'on', true);

update public.establishments e
   set class = public.rue_de_categorie(b.category)
  from public.beneficiaries b
 where b.user_id = e.created_by
   and b.category is not null
   and e.class is distinct from public.rue_de_categorie(b.category);

select set_config('daraja.affectation', 'off', true);

-- 4. Contrôle : bénéficiaires avec catégorie et quartier mais sans place (résultat attendu : aucune ligne).
select b.id, b.code
  from public.beneficiaries b
 where b.quartier_id is not null
   and b.category is not null
   and b.place_rue is null;

commit;
