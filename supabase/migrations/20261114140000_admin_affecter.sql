-- =============================================================================
-- DarajaPlus — administrateur : affecter ou classer un compte actif
--
-- Pour tout compte actif, l'administrateur peut :
--   * affecter un bénéficiaire en attente à un Agent (et à un quartier), avec sa
--     catégorie (Ba, Bb ou Bg) et, pour Bb et Ba, son parrain ;
--   * faire d'un compte un Agent (rattaché à un Hôte) ou un Hôte (zone).
--
-- Règles conservées (cahier des charges et réglages « caps ») :
--   * quotas par Agent (Bg, Bb, Ba), filleuls par parrain, Agents par Hôte ;
--   * un Bb a pour parrain un Bg, un Ba a pour parrain un Bb, du même Agent ;
--   * un compte qui a des personnes rattachées (bénéficiaires, filleuls, Agents)
--     ne change pas de rôle ici : il faut d'abord réaffecter ces personnes ;
--   * un bénéficiaire qui a déjà un code ne devient pas Agent ou Hôte ici.
--
-- Numérotation : dans un Agent et une catégorie, le numéro d'un bénéficiaire est le
-- plus grand numéro déjà attribué + 1. Une réaffectation peut laisser un trou : le
-- comptage ne suffit plus. admin_affecter et beneficiary_respond_proposal l'utilisent.
--
-- Migration additive : une fonction nouvelle, et la fonction de réponse à une
-- proposition est remplacée sans changer son comportement quand il n'y a pas de trou.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Affecter ou classer un compte actif
-- -----------------------------------------------------------------------------

create or replace function public.admin_affecter(
  p_profile uuid,
  p_cible text,
  p_zone smallint default null::smallint,
  p_host uuid default null::uuid,
  p_agent uuid default null::uuid,
  p_quartier integer default null::integer,
  p_sponsor uuid default null::uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v profiles%rowtype;
  v_b beneficiaries%rowtype;
  v_bid uuid;
  v_h profiles%rowtype;
  v_a profiles%rowtype;
  v_s beneficiaries%rowtype;
  v_n integer;
  v_max integer;
  v_seq integer;
  v_limit integer;
  v_sub integer;
  v_parent text;
  v_tag text;
  v_code text;
  v_label text;
  v_long text;
  v_nom text;
  v_ident text;
begin
  if not is_admin() then raise exception 'Réservé à l''administrateur général'; end if;
  if p_cible not in ('ba', 'bb', 'bg', 'agent', 'host') then raise exception 'Affectation inconnue.'; end if;

  select * into v from profiles where id = p_profile for update;
  if not found then raise exception 'Compte introuvable.'; end if;
  if v.role in ('admin', 'partner') then raise exception 'Ce compte ne peut pas être classé ici.'; end if;
  if v.status <> 'active' then
    raise exception 'Ce compte n''est pas encore validé : validez-le d''abord dans « Comptes à valider ».';
  end if;

  select * into v_b from beneficiaries where user_id = p_profile for update;
  v_bid := v_b.id;
  if v_bid is not null and v_b.status = 'suspended' then
    raise exception 'Ce bénéficiaire est suspendu : réactivez-le avant de l''affecter.';
  end if;
  if v_bid is not null and v_b.status = 'archived' and v_b.category is not null then
    raise exception 'Cette fiche est archivée : changez son statut dans « Bénéficiaires » avant de l''affecter.';
  end if;

  -- Dépendants : une personne qui a des personnes rattachées ne change pas de rôle ni
  -- de rattachement ici (il faut d'abord réaffecter ces personnes). Un Agent qui reste
  -- dans le même Hôte, ou un bénéficiaire qui garde exactement la même place, peut
  -- changer de quartier librement.
  if v.role = 'host' then
    select count(*) into v_n from profiles where role = 'agent' and host_id = p_profile;
    if v_n > 0 then
      raise exception 'Cet Hôte encadre % Agent(s) : réaffectez-les avant de modifier cette affectation.', v_n;
    end if;
  elsif v.role = 'agent' and not (p_cible = 'agent' and v.host_id = p_host) then
    select count(*) into v_n from beneficiaries where agent_id = p_profile;
    if v_n > 0 then
      raise exception 'Cet Agent a % bénéficiaire(s) : réaffectez-les avant de modifier cette affectation.', v_n;
    end if;
  elsif v.role = 'beneficiary' and v_bid is not null
        and not (p_cible in ('ba', 'bb', 'bg') and v_b.status = 'active' and v_b.category = p_cible
                 and v_b.agent_id is not distinct from p_agent
                 and v_b.sponsor_id is not distinct from p_sponsor) then
    select count(*) into v_n from beneficiaries where sponsor_id = v_bid;
    if v_n > 0 then
      raise exception 'Ce bénéficiaire a % filleul(s) : son rattachement ne peut pas être modifié ici.', v_n;
    end if;
  end if;
  if v.role = 'beneficiary' and v_bid is not null and v_b.category is not null
     and p_cible in ('host', 'agent') then
    raise exception 'Ce bénéficiaire a déjà un code : il ne peut pas devenir Agent ou Hôte ici.';
  end if;

  -- ---------------------------------------------------------------------------
  -- Hôte (zone)
  -- ---------------------------------------------------------------------------
  if p_cible = 'host' then
    if p_zone is null then raise exception 'Choisissez la zone de l''Hôte.'; end if;
    if not exists (select 1 from zones where id = p_zone) then raise exception 'Zone introuvable.'; end if;
    if v.role = 'host' and v.zone_id = p_zone then raise exception 'Ce compte est déjà Hôte de cette zone.'; end if;
    if exists (select 1 from profiles where role = 'host' and zone_id = p_zone
               and status in ('active', 'suspended') and id <> p_profile) then
      raise exception 'Cette zone a déjà un Hôte.';
    end if;
    if exists (select 1 from profiles where code = 'AH' || p_zone and id <> p_profile) then
      raise exception 'Le code d''Hôte de cette zone est déjà utilisé.';
    end if;

    if v_bid is not null and v_b.category is null and v_b.status <> 'archived' then
      update beneficiaries set status = 'archived', agent_id = null, host_id = null,
             quartier_id = null, sponsor_id = null
       where id = v_bid;
      update category_proposals set status = 'superseded', decided_at = now()
       where beneficiary_id = v_bid and status = 'proposed';
    end if;

    update profiles set role = 'host', zone_id = p_zone, code = 'AH' || p_zone, host_id = null,
           agent_id = null, quartier_id = null, category = null, wish_category = null, wish_at = null
     where id = p_profile;

    select name into v_nom from zones where id = p_zone;
    insert into notifications (recipient_id, kind, title, body, link) values
      (p_profile, 'affectation', 'Votre affectation a été mise à jour',
       'Vous êtes désormais Hôte de la zone ' || v_nom || ' (code AH' || p_zone || ').', '#/hote');
    return;
  end if;

  -- ---------------------------------------------------------------------------
  -- Agent (rattaché à un Hôte)
  -- ---------------------------------------------------------------------------
  if p_cible = 'agent' then
    if p_host is null then raise exception 'Choisissez l''Hôte encadrant.'; end if;
    if p_host = p_profile then raise exception 'Un Hôte ne peut pas encadrer son propre compte.'; end if;
    select * into v_h from profiles where id = p_host and role = 'host' and status = 'active';
    if not found then raise exception 'Hôte introuvable ou non actif.'; end if;
    if p_quartier is not null and not exists (
         select 1 from quartiers where id = p_quartier and zone_id = v_h.zone_id) then
      raise exception 'Ce quartier n''appartient pas à la zone de l''Hôte.';
    end if;

    if v.role = 'agent' and v.host_id = p_host then
      -- Même Hôte : seul le quartier peut changer, le code de l'Agent ne bouge pas.
      update profiles set quartier_id = p_quartier where id = p_profile;
      return;
    end if;

    select count(*) into v_n from profiles where role = 'agent' and host_id = p_host and id <> p_profile;
    if v_n >= cap('agents_per_host') then
      raise exception 'Cet Hôte encadre déjà % Agents (maximum).', cap('agents_per_host');
    end if;
    select coalesce(max(substring(code from '[0-9]+$')::integer), 0) into v_max
      from profiles
     where role = 'agent' and host_id = p_host and id <> p_profile and code like (v_h.code || 'A%');
    v_code := v_h.code || 'A' || (v_max + 1);
    if exists (select 1 from profiles where code = v_code and id <> p_profile) then
      raise exception 'Ce code d''Agent est déjà utilisé.';
    end if;

    if v_bid is not null and v_b.category is null and v_b.status <> 'archived' then
      update beneficiaries set status = 'archived', agent_id = null, host_id = null,
             quartier_id = null, sponsor_id = null
       where id = v_bid;
      update category_proposals set status = 'superseded', decided_at = now()
       where beneficiary_id = v_bid and status = 'proposed';
    end if;

    update profiles set role = 'agent', host_id = p_host, zone_id = v_h.zone_id, quartier_id = p_quartier,
           agent_id = null, category = null, wish_category = null, wish_at = null, code = v_code
     where id = p_profile;

    insert into notifications (recipient_id, kind, title, body, link) values
      (p_profile, 'affectation', 'Votre affectation a été mise à jour',
       'Vous êtes désormais Agent, rattaché à l’Hôte '
         || coalesce(nullif(trim(coalesce(v_h.prenom, '') || ' ' || coalesce(v_h.nom, '')), ''), v_h.code)
         || ' (code ' || v_code || ').', '#/agent');
    return;
  end if;

  -- ---------------------------------------------------------------------------
  -- Bénéficiaire (Ba, Bb ou Bg) rattaché à un Agent
  -- ---------------------------------------------------------------------------
  if p_agent is null then raise exception 'Choisissez l''Agent de rattachement.'; end if;
  if p_agent = p_profile then raise exception 'Un Agent ne peut pas être son propre bénéficiaire.'; end if;
  select * into v_a from profiles where id = p_agent and role = 'agent' and status = 'active';
  if not found then raise exception 'Agent introuvable ou non actif.'; end if;
  if p_quartier is not null and not exists (
       select 1 from quartiers where id = p_quartier and zone_id = v_a.zone_id) then
    raise exception 'Ce quartier ne fait pas partie de la zone de l''Agent.';
  end if;

  v_label := case p_cible when 'bg' then 'Gamma' when 'bb' then 'Bêta' else 'Alpha' end;
  v_long := case p_cible when 'bg' then 'bénéficiaire Gamma' when 'bb' then 'bénéficiaire Bêta'
                         else 'bénéficiaire Alpha' end;
  v_tag := case p_cible when 'bg' then 'Bg' when 'bb' then 'Bb' else 'Ba' end;

  -- Même Agent, même catégorie et même parrain : seul le quartier change, le code reste.
  if v_bid is not null and v_b.status = 'active' and v_b.category = p_cible
     and v_b.agent_id = p_agent and v_b.sponsor_id is not distinct from p_sponsor then
    update beneficiaries set quartier_id = p_quartier where id = v_bid;
    update profiles set quartier_id = p_quartier where id = p_profile;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('agent-capacity:' || p_agent::text));

  if p_cible = 'bg' then
    if p_sponsor is not null then raise exception 'Un Gamma n''a pas de parrain Bêta.'; end if;
    v_parent := v_a.code;
  else
    if p_sponsor is null then raise exception 'Choisissez le parrain pour un %.', v_label; end if;
    select * into v_s from beneficiaries where id = p_sponsor;
    if not found then raise exception 'Parrain introuvable.'; end if;
    if v_bid is not null and v_s.id = v_bid then
      raise exception 'Un bénéficiaire ne peut pas être son propre parrain.';
    end if;
    if v_s.agent_id is distinct from p_agent then raise exception 'Le parrain doit appartenir au même Agent.'; end if;
    if v_s.status = 'archived' then raise exception 'Parrain archivé.'; end if;
    if p_cible = 'bb' and v_s.category is distinct from 'bg' then
      raise exception 'Le parrain d''un Bêta doit être un Gamma.';
    end if;
    if p_cible = 'ba' and v_s.category is distinct from 'bb' then
      raise exception 'Le parrain d''un Alpha doit être un Bêta.';
    end if;
    select count(*) into v_n from beneficiaries where sponsor_id = v_s.id and id is distinct from v_bid;
    v_sub := case when p_cible = 'bb' then cap('bb_per_bg') else cap('ba_per_bb') end;
    if v_n >= v_sub then raise exception 'Ce parrain a déjà % filleul(s) (maximum).', v_sub; end if;
    v_parent := v_s.code;
  end if;

  select count(*) into v_n from beneficiaries
   where agent_id = p_agent and category = p_cible and id is distinct from v_bid;
  v_limit := cap(p_cible || '_per_agent');
  if v_n >= v_limit then
    raise exception 'Il n''y a plus de place en % pour cet Agent (maximum %).', v_label, v_limit;
  end if;

  select coalesce(max(agent_seq), 0) + 1 into v_seq from beneficiaries
   where agent_id = p_agent and category = p_cible and id is distinct from v_bid;
  v_code := v_parent || v_tag || v_seq;

  if v_bid is not null then
    update category_proposals set status = 'superseded', decided_at = now()
     where beneficiary_id = v_bid and status = 'proposed';
    update beneficiaries set status = 'active', agent_id = p_agent, host_id = v_a.host_id,
           quartier_id = p_quartier, category = p_cible, agent_seq = v_seq, code = v_code,
           sponsor_id = p_sponsor
     where id = v_bid;
  else
    insert into beneficiaries (nom, postnom, prenom, phone, email, user_id, status, agent_id, host_id,
                               quartier_id, category, agent_seq, code, sponsor_id, created_by)
    values (coalesce(v.nom, '—'), coalesce(v.postnom, '—'), coalesce(v.prenom, '—'), v.phone, v.email,
            p_profile, 'active', p_agent, v_a.host_id, p_quartier, p_cible, v_seq, v_code, p_sponsor,
            auth.uid());
  end if;

  update profiles set role = 'beneficiary', category = p_cible, code = v_code, agent_id = p_agent,
         host_id = v_a.host_id, zone_id = v_a.zone_id, quartier_id = p_quartier,
         wish_category = p_cible, wish_at = now(),
         identifiant = coalesce(identifiant, next_identifiant())
   where id = p_profile
  returning identifiant into v_ident;

  v_nom := coalesce(nullif(trim(coalesce(v_a.prenom, '') || ' ' || coalesce(v_a.nom, '')), ''), v_a.code);
  insert into notifications (recipient_id, kind, title, body, link) values
    (p_profile, 'affectation', 'Votre affectation a été mise à jour',
     'Vous êtes désormais ' || v_long || ' (code ' || v_code || '), rattaché(e) à votre Agent ' || v_nom || '.',
     '#/espace'),
    (p_agent, 'affectation', 'Nouveau bénéficiaire affecté',
     'Le bénéficiaire ' || coalesce(v_ident, '') || ' vous est affecté : ' || v_long
       || ' (code ' || v_code || ').', '#/agent/categories');
end $function$;

revoke all on function public.admin_affecter(uuid, text, smallint, uuid, uuid, integer, uuid) from public, anon;
grant execute on function public.admin_affecter(uuid, text, smallint, uuid, uuid, integer, uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 2. Réponse du bénéficiaire à une proposition : numéro = plus grand + 1
--    (même logique que ci-dessus ; le plafond continue de se compter comme avant)
-- -----------------------------------------------------------------------------

create or replace function public.beneficiary_respond_proposal(p_proposal uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_p category_proposals%rowtype;
  v_b beneficiaries%rowtype;
  v_bp profiles%rowtype;
  v_agent profiles%rowtype;
  v_s beneficiaries%rowtype;
  v_label text;
  v_tag text;
  v_seq int;
  v_next int;
  v_limit int;
  v_children int;
  v_sub int;
  v_parent text;
  v_code text;
begin
  select * into v_p from category_proposals where id = p_proposal for update;
  if not found then raise exception 'Proposition introuvable'; end if;

  select * into v_b from beneficiaries where id = v_p.beneficiary_id for update;
  if v_b.user_id is distinct from auth.uid() then raise exception 'Accès refusé'; end if;
  if v_p.status <> 'proposed' then raise exception 'Cette proposition n''est plus ouverte'; end if;

  select * into v_bp from profiles where id = auth.uid();
  v_label := case v_p.category when 'bg' then 'Gamma' when 'bb' then 'Bêta' else 'Alpha' end;

  if not p_accept then
    update category_proposals set status = 'declined', decided_at = now() where id = p_proposal;
    insert into notifications (recipient_id, kind, title, body, link) values
      (v_p.agent_id, 'categorie', 'Proposition de catégorie refusée',
       'Le bénéficiaire ' || coalesce(v_bp.identifiant, '') || ' a refusé la catégorie ' || v_label || '.',
       '#/agent/categories');
    return;
  end if;

  if v_b.status <> 'draft' then raise exception 'Votre fiche a déjà une catégorie validée'; end if;

  perform pg_advisory_xact_lock(hashtext('agent-capacity:' || v_p.agent_id::text));

  select count(*) into v_seq from beneficiaries where agent_id = v_p.agent_id and category = v_p.category;
  v_limit := cap(v_p.category || '_per_agent');
  if v_seq >= v_limit then
    raise exception 'Il n''y a plus de place en % : demandez à votre Agent une autre catégorie', v_label;
  end if;

  -- Numéro suivant : le plus grand déjà attribué + 1 (une réaffectation peut laisser un trou).
  select coalesce(max(agent_seq), 0) + 1 into v_next from beneficiaries
   where agent_id = v_p.agent_id and category = v_p.category;

  select * into v_agent from profiles where id = v_p.agent_id;
  v_tag := case v_p.category when 'bg' then 'Bg' when 'bb' then 'Bb' else 'Ba' end;

  if v_p.category = 'bg' then
    v_parent := v_agent.code;
  else
    select * into v_s from beneficiaries where id = v_p.sponsor_id for update;
    if not found or v_s.agent_id is distinct from v_p.agent_id or v_s.status = 'archived' then
      raise exception 'Le parrain proposé n''est plus disponible : demandez une nouvelle proposition';
    end if;
    select count(*) into v_children from beneficiaries where sponsor_id = v_s.id;
    v_sub := case when v_p.category = 'bb' then cap('bb_per_bg') else cap('ba_per_bb') end;
    if v_children >= v_sub then
      raise exception 'Le parrain n''a plus de place disponible : demandez une nouvelle proposition';
    end if;
    v_parent := v_s.code;
  end if;

  v_code := v_parent || v_tag || v_next;

  perform set_config('daraja.affectation', 'on', true);

  update beneficiaries
     set category = v_p.category, agent_seq = v_next, code = v_code,
         sponsor_id = v_p.sponsor_id, status = 'active'
   where id = v_b.id;

  update profiles set category = v_p.category, code = v_code, wish_category = v_p.category
   where id = auth.uid();

  update category_proposals set status = 'accepted', decided_at = now() where id = p_proposal;
  update category_proposals set status = 'superseded', decided_at = now()
   where beneficiary_id = v_b.id and status = 'proposed' and id <> p_proposal;

  perform set_config('daraja.affectation', 'off', true);

  insert into notifications (recipient_id, kind, title, body, link) values
    (v_p.agent_id, 'categorie', 'Catégorie acceptée',
     'Le bénéficiaire ' || coalesce(v_bp.identifiant, '') || ' a accepté la catégorie ' || v_label
       || ' (rang ' || v_next || ', code ' || v_code || ').',
     '#/agent/categories'),
    (auth.uid(), 'compte', 'Votre fiche est active',
     'Votre catégorie ' || v_label || ' est enregistrée. Votre code : ' || v_code || '.',
     '#/espace');
end $$;
