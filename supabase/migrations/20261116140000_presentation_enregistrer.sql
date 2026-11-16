-- DarajaPlus — une seule fiche par projet (16 novembre 2026).
--
-- Décisions du promoteur (16 novembre 2026) :
--  * « Présenter mon projet » est la seule façon de créer un projet ; le formulaire « Nouveau projet ou besoin » est retiré ;
--  * tous les champs du projet (montant, devise, secteur, entreprise, échéance, utilisation des fonds, description)
--    se saisissent dans la présentation ;
--  * un projet déjà créé se modifie depuis sa présentation.
--
-- La fonction presentation_creer_projet (migration 20261116120000) est remplacée par presentation_enregistrer,
-- qui crée le projet ou le modifie, et enregistre sa présentation, en une seule opération.
-- Aucune donnée n'est supprimée.

drop function if exists public.presentation_creer_projet(numeric, text, jsonb, jsonb, text);

create or replace function public.presentation_enregistrer(
  p_projet uuid,
  p_amount numeric,
  p_currency text,
  p_content jsonb,
  p_photos jsonb,
  p_statut text,
  p_sector text,
  p_establishment_id uuid,
  p_description text,
  p_use_of_funds text,
  p_due_date date
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
  v_titre text;
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
  -- Même règle que l'insertion des projets : seule une entreprise créée par ce compte peut être liée.
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
  else
    -- Modification d'un projet du bénéficiaire ; un projet d'une autre personne est refusé.
    update public.projects
    set title = v_titre, amount = p_amount, currency = p_currency, sector = nullif(p_sector, ''),
        establishment_id = p_establishment_id, description = nullif(p_description, ''),
        use_of_funds = nullif(p_use_of_funds, ''), due_date = p_due_date
    where id = p_projet and beneficiary_id = v_ben
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
end $$;

revoke all on function public.presentation_enregistrer(uuid, numeric, text, jsonb, jsonb, text, text, uuid, text, text, date) from public, anon;
grant execute on function public.presentation_enregistrer(uuid, numeric, text, jsonb, jsonb, text, text, uuid, text, text, date) to authenticated;
