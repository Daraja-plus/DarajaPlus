-- DarajaPlus — « Présenter mon projet » crée le projet (16 novembre 2026).
--
-- Décisions du promoteur (16 novembre 2026) :
--  * une présentation enregistrée crée automatiquement son projet, qui apparaît dans « Mes projets et besoins » ;
--  * le montant et la devise sont saisis dans la présentation (la base exige un montant supérieur à 0) ;
--  * les présentations déjà enregistrées (sans projet) attendent que le bénéficiaire indique le montant ;
--    elles ne sont rattachées à un projet qu'à ce moment-là.
-- Aucune donnée n'est supprimée.

-- 1. Le rattachement automatique au premier projet créé est retiré. Il entrerait en conflit avec la création
--    du projet par la présentation, et il rattacherait une présentation sans montant à un projet sans montant.
drop trigger if exists projet_rattache_presentation_en_attente on public.projects;
drop function if exists public.projet_rattache_presentation_en_attente();

-- 2. Création du projet et de sa présentation, en une seule opération.
--    La fonction vérifie elle-même l'identité du bénéficiaire connecté et les règles de saisie.
create or replace function public.presentation_creer_projet(
  p_amount numeric,
  p_currency text,
  p_content jsonb,
  p_photos jsonb,
  p_statut text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ben uuid;
  v_projet uuid;
  v_pending uuid;
  v_cle text;
begin
  if v_user is null then
    raise exception 'Connexion requise';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_user and p.role = 'beneficiary') then
    raise exception 'Réservé aux bénéficiaires';
  end if;
  select b.id into v_ben from public.beneficiaries b where b.user_id = v_user;
  if v_ben is null then
    raise exception 'Aucune fiche bénéficiaire pour ce compte';
  end if;
  if not (p_amount > 0) then
    raise exception 'Le montant doit être supérieur à 0.';
  end if;
  if p_currency not in ('USD', 'FC') then
    raise exception 'Devise non reconnue';
  end if;
  if p_statut not in ('brouillon', 'publiee') then
    raise exception 'Statut de présentation non autorisé';
  end if;
  if char_length(coalesce(p_content->>'titre', '')) = 0 or char_length(p_content->>'titre') > 120 then
    raise exception 'Le titre est obligatoire (120 caractères au maximum)';
  end if;
  if p_statut = 'publiee' then
    foreach v_cle in array array['probleme', 'solution', 'produit', 'marche', 'modele', 'concurrence', 'go_to_market', 'equipe', 'demande', 'vision'] loop
      if char_length(trim(coalesce(p_content->>v_cle, ''))) = 0 then
        raise exception 'Pour publier, toutes les rubriques doivent être remplies';
      end if;
    end loop;
  end if;

  insert into public.projects (beneficiary_id, created_by, title, amount, currency, status)
  values (v_ben, v_user, p_content->>'titre', p_amount, p_currency, 'draft')
  returning id into v_projet;

  -- Une présentation déjà enregistrée sans projet est reprise ; sinon, une nouvelle présentation est créée.
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

  return v_projet;
end $$;

revoke all on function public.presentation_creer_projet(numeric, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.presentation_creer_projet(numeric, text, jsonb, jsonb, text) to authenticated;
