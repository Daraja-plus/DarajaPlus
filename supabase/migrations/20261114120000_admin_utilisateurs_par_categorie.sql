-- DarajaPlus — administrateur : nombre d'utilisateurs par catégorie, tous les comptes sans exception.
--
-- Règles :
--  * chaque compte est compté une seule fois, dans une seule ligne ;
--  * Administrateur, Hôtes, Agents et Partenaires : tous les comptes de ce rôle, quel que soit leur statut ;
--  * Bg, Bb, Ba : bénéficiaires affectés (un agent ; un parrain pour Bb et Ba) avec leur catégorie ;
--  * En attente d'affectation : bénéficiaires sans agent, sans parrain (Bb et Ba), sans catégorie
--    ou sans fiche (compte pas encore validé) ;
--  * autres : comptes d'un rôle inconnu (doit rester à zéro).
-- Migration additive : une nouvelle fonction de lecture, réservée à l'administrateur général.

create or replace function public.admin_utilisateurs_par_categorie()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Réservé à l''administrateur général'; end if;
  return (
    with classes as (
      select
        case
          when p.role = 'admin' then 'administrateur'
          when p.role = 'host' then 'hotes'
          when p.role = 'agent' then 'agents'
          when p.role = 'partner' then 'partenaires'
          when p.role = 'beneficiary'
            and b.id is not null
            and b.category in ('bg', 'bb', 'ba')
            and b.agent_id is not null
            and (b.category = 'bg' or b.sponsor_id is not null)
            then b.category
          when p.role = 'beneficiary' then 'attente'
          else 'autres'
        end as classe
      from profiles p
      left join beneficiaries b on b.user_id = p.id
    )
    select jsonb_build_object(
      'administrateur', count(*) filter (where classe = 'administrateur'),
      'hotes', count(*) filter (where classe = 'hotes'),
      'agents', count(*) filter (where classe = 'agents'),
      'bg', count(*) filter (where classe = 'bg'),
      'bb', count(*) filter (where classe = 'bb'),
      'ba', count(*) filter (where classe = 'ba'),
      'attente', count(*) filter (where classe = 'attente'),
      'partenaires', count(*) filter (where classe = 'partenaires'),
      'autres', count(*) filter (where classe = 'autres'),
      'total', count(*)
    )
    from classes
  );
end $$;

revoke all on function public.admin_utilisateurs_par_categorie() from public, anon;
grant execute on function public.admin_utilisateurs_par_categorie() to authenticated;
