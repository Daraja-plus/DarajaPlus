-- DarajaPlus — remplacement du titulaire d'un poste (migration du 20 novembre 2026)
--
-- Décisions validées par le promoteur (20 novembre 2026) :
--  1. « Remplacer » = un nouveau titulaire reprend le même poste. Zone, quartier, bénéficiaires
--     et codes restent sur le poste. L'ancien compte est suspendu.
--  2. Les codes restent (AH1, AH1A1, AH1A1Bg1…).
--  3. Le nouveau titulaire est un compte existant et actif, du même rôle.
--  4. Bénéficiaire : la fiche propre du nouveau compte est archivée ; la fiche de l'ancien titulaire
--     passe au nouveau compte ; les projets, présentations et entreprises de l'ancien suivent le poste.
--
-- Propositions NON validées (à confirmer par le promoteur) :
--  a. Hôte ou Agent : le nouveau titulaire ne doit pas déjà avoir de poste (c'est contrôlé).
--  b. L'identifiant (DP-…) reste attaché à la personne, pas au poste. Conséquence : les partenaires
--     verront le nouvel identifiant sur les projets du poste.
--
-- Migration NON appliquée. Réservée à l'Administrateur (is_admin()).

create or replace function public.admin_remplacer_titulaire(p_poste uuid, p_nouveau uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_old profiles%rowtype;
  v_new profiles%rowtype;
  v_f beneficiaries%rowtype;
  v_n beneficiaries%rowtype;
begin
  if not is_admin() then
    raise exception 'Réservé à l''Administrateur';
  end if;
  if p_poste is null or p_nouveau is null or p_poste = p_nouveau then
    raise exception 'Choisissez deux comptes différents.';
  end if;

  select * into v_old from profiles where id = p_poste for update;
  select * into v_new from profiles where id = p_nouveau for update;
  if v_old.id is null or v_new.id is null then
    raise exception 'Compte introuvable.';
  end if;

  if v_old.role not in ('host', 'agent', 'beneficiary') then
    raise exception 'Seuls les Hôtes, les Agents et les bénéficiaires peuvent être remplacés.';
  end if;
  if v_new.role is distinct from v_old.role then
    raise exception 'Le nouveau titulaire doit avoir le même rôle que l''ancien.';
  end if;
  if v_old.status not in ('active', 'suspended') then
    raise exception 'Ce poste n''est pas occupé par un compte actif ou suspendu.';
  end if;
  if v_new.status <> 'active' then
    raise exception 'Le nouveau titulaire doit être un compte actif.';
  end if;

  -- ---------------------------------------------------------------------------
  -- Hôte : zone, code et Agents passent au nouveau compte
  -- ---------------------------------------------------------------------------
  if v_old.role = 'host' then
    if v_old.zone_id is null then
      raise exception 'Ce poste n''a pas de zone.';
    end if;
    if v_new.zone_id is not null or v_new.code is not null then
      raise exception 'Ce compte a déjà un poste d''Hôte : il ne peut pas en reprendre un autre.';
    end if;

    -- Le code est libéré en premier (il est unique), puis repris.
    update profiles set zone_id = null, code = null, status = 'suspended' where id = v_old.id;
    update profiles set zone_id = v_old.zone_id, code = v_old.code where id = v_new.id;

    update profiles set host_id = v_new.id where role = 'agent' and host_id = v_old.id;
    update beneficiaries set host_id = v_new.id where host_id = v_old.id;
    update profiles set host_id = v_new.id where role = 'beneficiary' and host_id = v_old.id;

  -- ---------------------------------------------------------------------------
  -- Agent : quartier, code, bénéficiaires et propositions passent au nouveau compte
  -- ---------------------------------------------------------------------------
  elsif v_old.role = 'agent' then
    if v_old.quartier_id is null then
      raise exception 'Ce poste n''a pas de quartier.';
    end if;
    if v_new.quartier_id is not null or v_new.code is not null or v_new.host_id is not null then
      raise exception 'Ce compte a déjà un poste d''Agent : il ne peut pas en reprendre un autre.';
    end if;

    -- 1. Le code est libéré (pas de déclencheur de quartier ici).
    update profiles set code = null where id = v_old.id;
    -- 2. Le nouveau compte prend le poste. Son quartier est celui de l'ancien : aucun bénéficiaire n'est encore rattaché.
    update profiles
       set host_id = v_old.host_id, zone_id = v_old.zone_id, quartier_id = v_old.quartier_id, code = v_old.code
     where id = v_new.id;
    -- 3. Les bénéficiaires suivent : leur quartier reste le même, donc leurs places aussi.
    update beneficiaries set agent_id = v_new.id where agent_id = v_old.id;
    update profiles set agent_id = v_new.id where role = 'beneficiary' and agent_id = v_old.id;
    update category_proposals set agent_id = v_new.id where agent_id = v_old.id and status = 'proposed';
    -- 4. L'ancien compte est libéré et suspendu. Son quartier est vidé sans rien propager (plus de bénéficiaire).
    update profiles
       set host_id = null, zone_id = null, quartier_id = null, status = 'suspended'
     where id = v_old.id;

  -- ---------------------------------------------------------------------------
  -- Bénéficiaire : la fiche active suit le poste ; la fiche du nouveau compte est archivée
  -- ---------------------------------------------------------------------------
  else
    select * into v_f from beneficiaries
     where user_id = v_old.id and status = 'active'
     order by created_at desc limit 1;
    if v_f.id is null then
      raise exception 'Ce bénéficiaire n''a pas de fiche active.';
    end if;

    -- 1. La fiche propre du nouveau compte (si elle existe) est archivée et libère sa place et son Agent.
    select * into v_n from beneficiaries
     where user_id = v_new.id and status <> 'archived'
     order by created_at desc limit 1;
    if v_n.id is not null then
      update beneficiaries
         set status = 'archived', user_id = null, agent_id = null, host_id = null,
             category = null, code = null, agent_seq = null
       where id = v_n.id;
    end if;

    -- 2. L'ancien compte est libéré et suspendu (le code est unique : il est libéré avant d'être repris).
    update profiles
       set category = null, code = null, agent_id = null, host_id = null, quartier_id = null, zone_id = null,
           status = 'suspended'
     where id = v_old.id;

    -- 3. La fiche active passe au nouveau compte, avec ses projets, documents et catégories proposées.
    update beneficiaries set user_id = v_new.id where id = v_f.id;

    -- 4. Le nouveau compte reprend le poste (catégorie, code, Agent, Hôte, quartier, zone).
    update profiles
       set category = v_f.category, code = v_f.code, agent_id = v_f.agent_id, host_id = v_f.host_id,
           quartier_id = v_f.quartier_id, zone_id = v_old.zone_id
     where id = v_new.id;

    -- 5. Entreprises de l'ancien titulaire : elles suivent le poste.
    update establishments set created_by = v_new.id where created_by = v_old.id;
  end if;

  return jsonb_build_object('role', v_old.role, 'poste', p_poste, 'nouveau', p_nouveau);
end $$;

revoke all on function public.admin_remplacer_titulaire(uuid, uuid) from public, anon;
grant execute on function public.admin_remplacer_titulaire(uuid, uuid) to authenticated;
