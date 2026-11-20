-- =============================================================================
-- DarajaPlus — quartiers attribués automatiquement
--
-- Règles retenues par l'Administrateur général :
--   * un Agent reçoit le premier quartier libre de la zone de son Hôte, dans
--     l'ordre des identifiants (Z{zone}-01 … Z{zone}-10) ;
--   * un quartier a au plus un Agent ;
--   * zone pleine (10 quartiers occupés) : l'affectation est refusée, sans
--     exception ;
--   * un bénéficiaire prend le quartier de son Agent, sans choix possible ;
--   * le quartier d'un Agent ne change que s'il change d'Hôte.
--
-- Points non encore validés, appliqués par défaut et à confirmer :
--   * un Agent suspendu garde son quartier (il reste occupé) ;
--   * un Agent sans quartier peut recevoir des bénéficiaires : ceux-ci restent
--     sans quartier jusqu'à ce que l'Agent en reçoive un (le quartier suit alors
--     automatiquement par la règle de propagation ci-dessous).
--
-- Cette migration ne modifie AUCUNE donnée existante. La correction des données
-- déjà en place se fait par un script séparé, après validation de la liste.
--
-- Les paramètres p_quartier des fonctions sont conservés (compatibilité avec
-- l'application déjà publiée) mais ne sont plus utilisés.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Premier quartier libre d'une zone
-- -----------------------------------------------------------------------------

create or replace function public.quartier_libre_pour_zone(p_zone smallint, p_exclure uuid default null::uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id integer;
begin
  -- Sérialise les attributions d'une même zone : deux Agents ne peuvent pas
  -- recevoir le même quartier en même temps.
  perform pg_advisory_xact_lock(hashtext('quartier-zone:' || p_zone::text));

  select q.id into v_id
    from quartiers q
   where q.zone_id = p_zone
     and not exists (
       select 1 from profiles a
        where a.role = 'agent'
          and a.quartier_id = q.id
          and a.id is distinct from p_exclure)
   order by q.id
   limit 1;

  if v_id is null then
    raise exception 'Zone pleine : tous les quartiers de cette zone sont déjà attribués.';
  end if;
  return v_id;
end $$;

revoke all on function public.quartier_libre_pour_zone(smallint, uuid) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 2. Le quartier d'une fiche bénéficiaire est celui de son Agent
--    (règle appliquée par la base, quel que soit le chemin d'écriture)
-- -----------------------------------------------------------------------------

create or replace function public.beneficiary_quartier_de_l_agent()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.agent_id is null then
    new.quartier_id := null;
  else
    select p.quartier_id into new.quartier_id from profiles p where p.id = new.agent_id;
  end if;
  return new;
end $$;

drop trigger if exists beneficiary_quartier_de_l_agent on public.beneficiaries;
create trigger beneficiary_quartier_de_l_agent
  before insert or update on public.beneficiaries
  for each row execute function public.beneficiary_quartier_de_l_agent();


-- -----------------------------------------------------------------------------
-- 3. Changement du quartier d'un Agent : ses bénéficiaires et leurs comptes suivent
-- -----------------------------------------------------------------------------

create or replace function public.agent_quartier_propage()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.role = 'agent' and new.quartier_id is distinct from old.quartier_id then
    perform set_config('daraja.affectation', 'on', true);
    update beneficiaries set quartier_id = new.quartier_id where agent_id = new.id;
    update profiles set quartier_id = new.quartier_id
     where role = 'beneficiary' and agent_id = new.id;
    perform set_config('daraja.affectation', 'off', true);
  end if;
  return new;
end $$;

drop trigger if exists agent_quartier_propage on public.profiles;
create trigger agent_quartier_propage
  after update of quartier_id on public.profiles
  for each row execute function public.agent_quartier_propage();


-- -----------------------------------------------------------------------------
-- 4. Validation d'un compte (administrateur) : l'Agent reçoit un quartier libre
-- -----------------------------------------------------------------------------

create or replace function public.admin_review_account(
  p_profile uuid, p_decision text, p_reason text default null::text,
  p_zone smallint default null::smallint, p_host uuid default null::uuid,
  p_agent uuid default null::uuid, p_category text default null::text,
  p_sponsor uuid default null::uuid, p_quartier integer default null::integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v profiles%rowtype;
  v_host profiles%rowtype;
  v_n int;
begin
  if not is_admin() then raise exception 'Réservé à l''administrateur général'; end if;
  select * into v from profiles where id = p_profile for update;
  if not found then raise exception 'Compte introuvable'; end if;
  if v.role = 'admin' then raise exception 'Compte administrateur : non modifiable ici'; end if;

  if p_decision = 'reject' then
    if coalesce(trim(p_reason), '') = '' then raise exception 'Un motif de refus est obligatoire'; end if;
    update profiles set status = 'rejected', rejection_reason = p_reason,
           validated_at = now(), validated_by = auth.uid() where id = p_profile;
    return;
  elsif p_decision = 'suspend' then
    update profiles set status = 'suspended', rejection_reason = p_reason where id = p_profile;
    return;
  elsif p_decision = 'reactivate' then
    if v.status <> 'suspended' then raise exception 'Seul un compte suspendu peut être réactivé'; end if;
    update profiles set status = 'active' where id = p_profile;
    return;
  elsif p_decision <> 'approve' then
    raise exception 'Décision inconnue';
  end if;

  if v.status = 'active' then raise exception 'Ce compte est déjà actif'; end if;

  if v.role = 'host' then
    if p_zone is null then raise exception 'Zone obligatoire pour un Hôte'; end if;
    if exists (select 1 from profiles where role = 'host' and zone_id = p_zone and status in ('active', 'suspended')) then
      raise exception 'Cette zone a déjà un Hôte';
    end if;
    update profiles set zone_id = p_zone, code = 'AH' || p_zone where id = p_profile;

  elsif v.role = 'agent' then
    select * into v_host from profiles where id = p_host and role = 'host' and status = 'active';
    if not found then raise exception 'Hôte introuvable ou non actif'; end if;
    select count(*) into v_n from profiles where role = 'agent' and host_id = p_host;
    if v_n >= cap('agents_per_host') then
      raise exception 'Cet Hôte encadre déjà % Agents (maximum)', cap('agents_per_host');
    end if;
    -- Le quartier est attribué automatiquement : premier quartier libre de la zone.
    update profiles set host_id = p_host, zone_id = v_host.zone_id,
           quartier_id = quartier_libre_pour_zone(v_host.zone_id, p_profile),
           code = v_host.code || 'A' || (v_n + 1) where id = p_profile;

  elsif v.role = 'beneficiary' then
    -- Le compte est validé tout de suite. La fiche est créée sans Agent ni
    -- catégorie : le bénéficiaire choisit sa catégorie, l'Agent la confirme.
    insert into beneficiaries (nom, postnom, prenom, phone, email, user_id, status, created_by)
    values (coalesce(v.nom, '—'), coalesce(v.postnom, '—'), coalesce(v.prenom, '—'),
            v.phone, v.email, p_profile, 'draft', auth.uid())
    on conflict (user_id) do nothing;
    if v.identifiant is null then
      update profiles set identifiant = next_identifiant() where id = p_profile;
    end if;
    if p_agent is not null then
      perform admin_assign_agent(p_profile, p_agent, null);
    end if;

  elsif v.role = 'partner' then
    null;
  end if;

  update profiles set status = 'active', validated_at = now(), validated_by = auth.uid(),
         rejection_reason = null where id = p_profile;
end $function$;


-- -----------------------------------------------------------------------------
-- 5. Affectation d'un bénéficiaire à un Agent : il prend le quartier de l'Agent
-- -----------------------------------------------------------------------------

create or replace function public.admin_assign_agent(p_profile uuid, p_agent uuid, p_quartier integer default null::integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_p profiles%rowtype;
  v_b beneficiaries%rowtype;
  v_agent profiles%rowtype;
begin
  if not is_admin() then raise exception 'Réservé à l''administrateur général'; end if;

  select * into v_p from profiles where id = p_profile;
  if not found or v_p.role <> 'beneficiary' then raise exception 'Ce compte n''est pas un bénéficiaire'; end if;

  select * into v_b from beneficiaries where user_id = p_profile for update;
  if not found then raise exception 'Fiche bénéficiaire introuvable'; end if;
  if v_b.status <> 'draft' then raise exception 'Ce bénéficiaire a déjà une catégorie validée'; end if;

  select * into v_agent from profiles where id = p_agent and role = 'agent' and status = 'active';
  if not found then raise exception 'Agent introuvable ou non actif'; end if;

  -- Le quartier suit l'Agent : p_quartier n'est plus utilisé.
  update beneficiaries set agent_id = p_agent, host_id = v_agent.host_id, quartier_id = v_agent.quartier_id
   where id = v_b.id;
  update profiles set agent_id = p_agent, host_id = v_agent.host_id, zone_id = v_agent.zone_id,
         quartier_id = v_agent.quartier_id
   where id = p_profile;

  insert into notifications (recipient_id, kind, title, body, link) values
    (p_profile, 'affectation', 'Vous êtes affecté à un Agent',
     'Votre Agent ' || trim(coalesce(v_agent.prenom, '') || ' ' || coalesce(v_agent.nom, ''))
       || ' va examiner votre choix de catégorie. Vous serez informé dès sa proposition.',
     '#/espace/categorie'),
    (p_agent, 'affectation', 'Nouveau bénéficiaire affecté',
     'Un bénéficiaire vous est affecté. Proposez-lui une catégorie disponible dans votre quota.',
     '#/agent/categories');
end $$;


-- -----------------------------------------------------------------------------
-- 6. Affecter ou classer un compte actif (administrateur)
--    Agent : premier quartier libre de la zone de l'Hôte ; zone pleine = refus.
--    Bénéficiaire : quartier de l'Agent.
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
  v_q integer;
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
  -- de rattachement ici (il faut d'abord réaffecter ces personnes).
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

    if v.role = 'agent' and v.host_id = p_host then
      -- Déjà rattaché à cet Hôte : son quartier ne se modifie plus à la main.
      raise exception 'Cet Agent est déjà rattaché à cet Hôte : son quartier ne se modifie pas.';
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

    -- Quartier attribué automatiquement dans la zone du nouvel Hôte ; zone pleine = refus.
    v_q := quartier_libre_pour_zone(v_h.zone_id, p_profile);

    if v_bid is not null and v_b.category is null and v_b.status <> 'archived' then
      update beneficiaries set status = 'archived', agent_id = null, host_id = null,
             quartier_id = null, sponsor_id = null
       where id = v_bid;
      update category_proposals set status = 'superseded', decided_at = now()
       where beneficiary_id = v_bid and status = 'proposed';
    end if;

    update profiles set role = 'agent', host_id = p_host, zone_id = v_h.zone_id, quartier_id = v_q,
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
  -- Bénéficiaire (Ba, Bb ou Bg) rattaché à un Agent : il prend le quartier de l'Agent
  -- ---------------------------------------------------------------------------
  if p_agent is null then raise exception 'Choisissez l''Agent de rattachement.'; end if;
  if p_agent = p_profile then raise exception 'Un Agent ne peut pas être son propre bénéficiaire.'; end if;
  select * into v_a from profiles where id = p_agent and role = 'agent' and status = 'active';
  if not found then raise exception 'Agent introuvable ou non actif.'; end if;

  v_label := case p_cible when 'bg' then 'Gamma' when 'bb' then 'Bêta' else 'Alpha' end;
  v_long := case p_cible when 'bg' then 'bénéficiaire Gamma' when 'bb' then 'bénéficiaire Bêta'
                         else 'bénéficiaire Alpha' end;
  v_tag := case p_cible when 'bg' then 'Bg' when 'bb' then 'Bb' else 'Ba' end;

  -- Même Agent, même catégorie et même parrain : le code reste, le quartier suit l'Agent.
  if v_bid is not null and v_b.status = 'active' and v_b.category = p_cible
     and v_b.agent_id = p_agent and v_b.sponsor_id is not distinct from p_sponsor then
    update beneficiaries set quartier_id = v_a.quartier_id where id = v_bid;
    update profiles set quartier_id = v_a.quartier_id where id = p_profile;
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
           quartier_id = v_a.quartier_id, category = p_cible, agent_seq = v_seq, code = v_code,
           sponsor_id = p_sponsor
     where id = v_bid;
  else
    insert into beneficiaries (nom, postnom, prenom, phone, email, user_id, status, agent_id, host_id,
                               quartier_id, category, agent_seq, code, sponsor_id, created_by)
    values (coalesce(v.nom, '—'), coalesce(v.postnom, '—'), coalesce(v.prenom, '—'), v.phone, v.email,
            p_profile, 'active', p_agent, v_a.host_id, v_a.quartier_id, p_cible, v_seq, v_code, p_sponsor,
            auth.uid());
  end if;

  update profiles set role = 'beneficiary', category = p_cible, code = v_code, agent_id = p_agent,
         host_id = v_a.host_id, zone_id = v_a.zone_id, quartier_id = v_a.quartier_id,
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
-- 7. Création d'une fiche bénéficiaire par un Agent : quartier = celui de l'Agent
--    (définition reprise de la base de production, qui n'était pas dans le dépôt)
-- -----------------------------------------------------------------------------

create or replace function public.create_beneficiary(
  p_category text, p_nom text, p_postnom text, p_prenom text,
  p_phone text default null::text, p_email text default null::text,
  p_agent uuid default null::uuid, p_sponsor uuid default null::uuid,
  p_quartier integer default null::integer, p_user uuid default null::uuid,
  p_status text default 'to_verify'::text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_agent profiles%rowtype;
  v_sponsor beneficiaries%rowtype;
  v_seq int;
  v_children int;
  v_limit int;
  v_parent text;
  v_label text;
  v_code text;
  v_id uuid;
begin
  if p_category not in ('ba','bb','bg') then raise exception 'Catégorie invalide'; end if;
  if p_status not in ('draft','incomplete','to_verify','active') then raise exception 'Statut initial invalide'; end if;
  if p_status = 'active' and not (is_admin() or my_role() = 'host') then
    raise exception 'Activation réservée à l''Hôte ou à l''Administrateur';
  end if;
  if p_user is not null and not is_admin() then raise exception 'Réservé à l''administrateur'; end if;

  select * into v_agent from profiles where id = p_agent and role = 'agent' and status = 'active';
  if not found then raise exception 'Agent introuvable ou non actif'; end if;
  if not (is_admin()
          or (my_role() = 'agent' and auth.uid() = p_agent)
          or (my_role() = 'host' and v_agent.host_id = auth.uid())) then
    raise exception 'Accès refusé pour cet Agent';
  end if;

  perform pg_advisory_xact_lock(hashtext('agent-capacity:' || p_agent::text));

  select count(*) into v_seq from beneficiaries where agent_id = p_agent and category = p_category;
  v_limit := cap(p_category || '_per_agent');
  if v_seq >= v_limit then
    raise exception 'Quota atteint : cet Agent a déjà % % (maximum %)', v_seq, upper(p_category), v_limit;
  end if;

  if p_category = 'bg' then
    if p_sponsor is not null then raise exception 'Un Bg n''a pas de parrain Bénéficiaire'; end if;
    v_parent := v_agent.code;
  else
    select * into v_sponsor from beneficiaries where id = p_sponsor;
    if not found then raise exception 'Parrain obligatoire pour un %', upper(p_category); end if;
    if v_sponsor.agent_id <> p_agent then raise exception 'Le parrain doit appartenir au même Agent'; end if;
    if v_sponsor.status = 'archived' then raise exception 'Parrain archivé'; end if;
    if p_category = 'bb' and v_sponsor.category <> 'bg' then raise exception 'Le parrain d''un Bb doit être un Bg'; end if;
    if p_category = 'ba' and v_sponsor.category <> 'bb' then raise exception 'Le parrain d''un Ba doit être un Bb'; end if;
    select count(*) into v_children from beneficiaries where sponsor_id = p_sponsor;
    v_limit := case when p_category = 'bb' then cap('bb_per_bg') else cap('ba_per_bb') end;
    if v_children >= v_limit then raise exception 'Ce parrain a déjà % filleuls (maximum)', v_limit; end if;
    v_parent := v_sponsor.code;
  end if;

  v_label := case p_category when 'bg' then 'Bg' when 'bb' then 'Bb' else 'Ba' end;
  v_code := v_parent || v_label || (v_seq + 1);

  -- Quartier : celui de l'Agent, jamais un choix libre.
  insert into beneficiaries (code, category, nom, postnom, prenom, phone, email, agent_id, host_id,
                             quartier_id, sponsor_id, user_id, agent_seq, status, created_by)
  values (v_code, p_category, trim(p_nom), trim(p_postnom), trim(p_prenom),
          nullif(trim(p_phone), ''), nullif(trim(p_email), ''), p_agent, v_agent.host_id,
          v_agent.quartier_id, p_sponsor, p_user, v_seq + 1, p_status, auth.uid())
  returning id into v_id;

  if p_user is not null then
    update profiles set agent_id = p_agent, category = p_category, code = v_code where id = p_user;
  end if;
  return v_id;
end $function$;
