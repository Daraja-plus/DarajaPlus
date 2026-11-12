-- =============================================================================
-- DarajaPlus — accueil du bénéficiaire : identifiant, choix de catégorie,
-- propositions de l'Agent, entreprises et photos
--
-- Principe retenu : un bénéficiaire validé peut ouvrir son espace avant d'avoir
-- un Agent. Sa fiche existe dès la validation (statut « draft », sans Agent ni
-- catégorie). Son code et sa catégorie n'apparaissent qu'à l'acceptation d'une
-- proposition de l'Agent ; la fiche devient alors active tout de suite.
--
-- 1. Identifiant permanent (DP-000001) attribué à la validation.
-- 2. Fiche bénéficiaire créée à la validation, sans Agent ni catégorie.
-- 3. Affectation à un Agent et à un quartier (admin_assign_agent).
-- 4. Choix de catégorie par le bénéficiaire (beneficiary_set_wish).
-- 5. Proposition par l'Agent, avec parrain pour Bêta et Alpha
--    (agent_propose_category), puis acceptation ou refus par le bénéficiaire
--    (beneficiary_respond_proposal).
-- 6. Entreprises rattachées au bénéficiaire (establishments + liaison) et
--    photos / logos dans le bucket privé « visuels ».
--
-- Règle de sécurité : les changements de rattachement (agent, catégorie, code,
-- statut) ne sont permis qu'aux administrateurs, ou à l'intérieur des RPC
-- ci-dessous, qui font leurs propres contrôles. Le drapeau
-- « daraja.affectation » n'est posé que par ces fonctions, pour la seule
-- durée de leur transaction ; un client ne peut pas le poser.
--
-- Idempotente autant que possible : peut être rejouée sans erreur.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Colonnes et identifiant
-- -----------------------------------------------------------------------------

create sequence if not exists public.profile_identifiant_seq start 1;

create or replace function public.next_identifiant()
returns text
language sql
as $$
  select 'DP-' || lpad(nextval('public.profile_identifiant_seq')::text, 6, '0')
$$;

alter table public.profiles
  add column if not exists identifiant text unique,
  add column if not exists wish_category text check (wish_category in ('ba', 'bb', 'bg')),
  add column if not exists wish_at timestamptz,
  add column if not exists photo_path text;

-- Les bénéficiaires déjà actifs reçoivent leur identifiant (une seule fois).
-- Le drapeau autorise cette seule écriture : la migration n'a pas de session administrateur.
select set_config('daraja.affectation', 'on', true);
update public.profiles
   set identifiant = public.next_identifiant()
 where role = 'beneficiary' and status = 'active' and identifiant is null;
select set_config('daraja.affectation', 'off', true);

create or replace function public.affectation_en_cours()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('daraja.affectation', true), '') = 'on'
$$;


-- -----------------------------------------------------------------------------
-- 2. Fiche bénéficiaire sans Agent ni catégorie (fiche en attente)
-- -----------------------------------------------------------------------------

alter table public.beneficiaries
  alter column agent_id drop not null,
  alter column host_id drop not null,
  alter column category drop not null,
  alter column code drop not null,
  alter column agent_seq drop not null;

alter table public.beneficiaries drop constraint if exists beneficiaries_category_code_check;
alter table public.beneficiaries add constraint beneficiaries_category_code_check
  check ((category is null) = (code is null) and (category is null) = (agent_seq is null));

alter table public.beneficiaries drop constraint if exists beneficiaries_affectation_check;
alter table public.beneficiaries add constraint beneficiaries_affectation_check
  check (status <> 'active' or (agent_id is not null and host_id is not null
                                and category is not null and code is not null and agent_seq is not null));


-- -----------------------------------------------------------------------------
-- 3. Déclencheurs de protection : exception réservée aux RPC de rattachement
-- -----------------------------------------------------------------------------

create or replace function public.protect_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_admin() and not affectation_en_cours() then
    if (new.id, new.role, new.status, new.requested_role, new.category, new.zone_id, new.quartier_id,
        new.host_id, new.agent_id, new.code, new.rejection_reason, new.validated_at, new.validated_by,
        new.identifiant, new.wish_category, new.wish_at)
       is distinct from
       (old.id, old.role, old.status, old.requested_role, old.category, old.zone_id, old.quartier_id,
        old.host_id, old.agent_id, old.code, old.rejection_reason, old.validated_at, old.validated_by,
        old.identifiant, old.wish_category, old.wish_at)
    then
      raise exception 'Ce champ ne peut être modifié que par l''administrateur général';
    end if;
  end if;
  return new;
end $$;

create or replace function public.protect_beneficiary()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_admin() and not affectation_en_cours() then
    if (new.code, new.category, new.agent_id, new.host_id, new.sponsor_id, new.user_id, new.agent_seq)
       is distinct from
       (old.code, old.category, old.agent_id, old.host_id, old.sponsor_id, old.user_id, old.agent_seq)
    then
      raise exception 'Rattachement et catégorie réservés à l''équipe';
    end if;
    if new.status is distinct from old.status then
      if my_role() = 'beneficiary' then
        raise exception 'Le statut est géré par l''équipe';
      elsif my_role() = 'agent' and new.status not in ('draft', 'incomplete', 'to_verify') then
        raise exception 'Activation réservée à l''Hôte ou à l''Administrateur';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Entreprises : le bénéficiaire crée la sienne en « à vérifier », sans classe.
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
      new.class := null;
    end if;
    return new;
  end if;
  if new.verification_status is distinct from old.verification_status
     and not (is_admin() or my_role() = 'host') then
    raise exception 'La vérification est réservée à l''Hôte ou à l''Administrateur';
  end if;
  if new.class is distinct from old.class
     and not (is_admin() or my_role() in ('host', 'agent')) then
    raise exception 'La classe (R1, R2, R3) est attribuée par l''équipe';
  end if;
  return new;
end $$;

drop trigger if exists establishments_guard_insert on public.establishments;
create trigger establishments_guard_insert
  before insert on public.establishments
  for each row execute function public.protect_establishment();


-- -----------------------------------------------------------------------------
-- 4. Propositions de catégorie
-- -----------------------------------------------------------------------------

create table if not exists public.category_proposals (
  id             uuid primary key default gen_random_uuid(),
  beneficiary_id uuid not null references public.beneficiaries(id) on delete cascade,
  agent_id       uuid not null references public.profiles(id),
  category       text not null check (category in ('ba', 'bb', 'bg')),
  sponsor_id     uuid references public.beneficiaries(id),
  rank_expected  integer not null check (rank_expected >= 1),
  status         text not null default 'proposed'
                 check (status in ('proposed', 'accepted', 'declined', 'superseded')),
  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  check ((category = 'bg') = (sponsor_id is null))
);

-- Une seule proposition ouverte à la fois pour un bénéficiaire.
create unique index if not exists category_proposals_one_open
  on public.category_proposals (beneficiary_id) where status = 'proposed';
create index if not exists category_proposals_agent_idx on public.category_proposals (agent_id);

alter table public.category_proposals enable row level security;

drop policy if exists category_proposals_read on public.category_proposals;
create policy category_proposals_read on public.category_proposals
  for select to authenticated
  using (
    is_admin()
    or agent_id = auth.uid()
    or beneficiary_id in (select id from public.beneficiaries where user_id = auth.uid())
    or agent_id in (select id from public.profiles where host_id = auth.uid())
  );

-- Aucune écriture directe : tout passe par les fonctions ci-dessous.
revoke insert, update, delete on public.category_proposals from anon, authenticated;
grant select on public.category_proposals to authenticated;


-- -----------------------------------------------------------------------------
-- 5. Entreprises : colonnes et accès du propriétaire
-- -----------------------------------------------------------------------------

alter table public.establishments
  add column if not exists description text,
  add column if not exists services text,
  add column if not exists phone text,
  add column if not exists logo_path text;

create or replace function public.my_establishment(e uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.establishments where id = e and created_by = auth.uid())
$$;

drop policy if exists be_insert on public.beneficiary_establishments;
create policy be_insert on public.beneficiary_establishments
  for insert to authenticated
  with check (
    can_access_beneficiary(beneficiary_id)
    and (is_admin() or my_role() in ('agent', 'host') or my_establishment(establishment_id))
  );

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated
  with check (
    can_access_beneficiary(beneficiary_id)
    and created_by = auth.uid()
    and (establishment_id is null or is_admin() or my_role() in ('agent', 'host')
         or my_establishment(establishment_id))
  );


-- -----------------------------------------------------------------------------
-- 6. Bucket privé « visuels » (photo de profil, logos d'entreprise)
--    Chemin : <identifiant auth>/<fichier>. Lecture par le propriétaire,
--    l'administrateur ; affichage par URL signée côté application.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visuels', 'visuels', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists visuels_read on storage.objects;
create policy visuels_read on storage.objects for select to authenticated
  using (bucket_id = 'visuels' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));

drop policy if exists visuels_insert on storage.objects;
create policy visuels_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'visuels' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists visuels_update on storage.objects;
create policy visuels_update on storage.objects for update to authenticated
  using (bucket_id = 'visuels' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'visuels' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists visuels_delete on storage.objects;
create policy visuels_delete on storage.objects for delete to authenticated
  using (bucket_id = 'visuels' and (storage.foldername(name))[1] = auth.uid()::text);


-- -----------------------------------------------------------------------------
-- 7. Notification de validation : identifiant et première étape (catégorie)
-- -----------------------------------------------------------------------------

create or replace function public.notify_profile_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_home text;
  v_link text;
  v_when text;
  v_invite text;
begin
  if new.status is not distinct from old.status or new.role = 'admin' then
    return new;
  end if;

  -- espace d'accueil de chaque rôle (correspond à homeFor() dans js/app.js)
  v_home := case new.role
    when 'beneficiary' then '#/espace'
    when 'host' then '#/hote'
    when 'agent' then '#/agent'
    when 'partner' then '#/partenaire'
    else '#/'
  end;

  if new.status = 'active' and old.status in ('pending', 'rejected') then
    v_when := to_char(coalesce(new.validated_at, now()) at time zone 'Africa/Kinshasa', 'DD/MM/YYYY "à" HH24:MI');
    if new.role = 'beneficiary' then
      v_invite := 'Votre identifiant : ' || coalesce(new.identifiant, '—') || '. '
               || 'Première étape : choisissez votre catégorie (Alpha, Bêta ou Gamma) après avoir lu '
               || 'les avantages, les limites et les exigences de chacune.';
      v_link := '#/espace/categorie';
    else
      v_invite := case new.role
        when 'host' then 'Suivez les Agents et les bénéficiaires de votre zone.'
        when 'agent' then 'Enregistrez et accompagnez vos bénéficiaires.'
        when 'partner' then 'Présentez vos offres et consultez les dossiers autorisés.'
        else ''
      end;
      v_link := v_home;
    end if;
    insert into notifications (recipient_id, kind, title, body, link)
    values (new.id, 'compte_valide', 'Votre compte est validé',
            'Validé le ' || v_when || ' (heure de Kinshasa). ' || v_invite || ' Commencez dès maintenant.',
            v_link);
    return new;
  end if;

  insert into notifications (recipient_id, kind, title, body, link)
  values (new.id, 'compte',
    case new.status
      when 'active' then 'Votre compte est de nouveau actif'
      when 'rejected' then 'Votre demande de compte n''a pas été retenue'
      when 'suspended' then 'Votre compte est suspendu'
      else 'Votre compte est en attente de validation'
    end,
    coalesce(new.rejection_reason, 'Ouvrez votre espace pour voir les étapes suivantes.'),
    case when new.status = 'active' then v_home else '#/en-attente' end);
  return new;
end $function$;


-- -----------------------------------------------------------------------------
-- 8. Validation : le bénéficiaire reçoit une fiche en attente, sans Agent
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
    if p_quartier is not null and not exists (select 1 from quartiers where id = p_quartier and zone_id = v_host.zone_id) then
      raise exception 'Ce quartier n''appartient pas à la zone de l''Hôte';
    end if;
    update profiles set host_id = p_host, zone_id = v_host.zone_id, quartier_id = p_quartier,
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
      perform admin_assign_agent(p_profile, p_agent, p_quartier);
    end if;

  elsif v.role = 'partner' then
    null;
  end if;

  update profiles set status = 'active', validated_at = now(), validated_by = auth.uid(),
         rejection_reason = null where id = p_profile;
end $function$;


-- -----------------------------------------------------------------------------
-- 9. Affectation à un Agent (administrateur)
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
  if p_quartier is not null and not exists (
       select 1 from quartiers where id = p_quartier and zone_id = v_agent.zone_id) then
    raise exception 'Ce quartier ne fait pas partie de la zone de l''Agent';
  end if;

  update beneficiaries set agent_id = p_agent, host_id = v_agent.host_id, quartier_id = p_quartier
   where id = v_b.id;
  update profiles set agent_id = p_agent, host_id = v_agent.host_id, zone_id = v_agent.zone_id,
         quartier_id = p_quartier
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
-- 10. Choix de catégorie par le bénéficiaire
-- -----------------------------------------------------------------------------

create or replace function public.beneficiary_set_wish(p_category text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_b beneficiaries%rowtype;
begin
  if p_category not in ('ba', 'bb', 'bg') then raise exception 'Catégorie invalide'; end if;
  if my_role() is distinct from 'beneficiary' then raise exception 'Réservé aux bénéficiaires'; end if;

  select * into v_b from beneficiaries where user_id = auth.uid() for update;
  if not found then raise exception 'Fiche bénéficiaire introuvable'; end if;
  if v_b.status = 'active' then raise exception 'Votre catégorie est déjà choisie et validée'; end if;
  if v_b.status <> 'draft' then raise exception 'Votre fiche n''est pas ouverte au choix de catégorie'; end if;

  perform set_config('daraja.affectation', 'on', true);
  update profiles set wish_category = p_category, wish_at = now() where id = auth.uid();
  update category_proposals set status = 'superseded', decided_at = now()
   where beneficiary_id = v_b.id and status = 'proposed';
  perform set_config('daraja.affectation', 'off', true);
end $$;


-- -----------------------------------------------------------------------------
-- 11. Proposition de catégorie par l'Agent (avec parrain pour Bêta et Alpha)
-- -----------------------------------------------------------------------------

create or replace function public.agent_propose_category(p_beneficiary uuid, p_category text, p_sponsor uuid default null::uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_b beneficiaries%rowtype;
  v_s beneficiaries%rowtype;
  v_label text;
  v_n int;
  v_limit int;
  v_children int;
  v_sub int;
begin
  if p_category not in ('ba', 'bb', 'bg') then raise exception 'Catégorie invalide'; end if;

  select * into v_b from beneficiaries where id = p_beneficiary for update;
  if not found then raise exception 'Bénéficiaire introuvable'; end if;
  if not coalesce(is_admin() or (my_role() = 'agent' and v_b.agent_id = auth.uid()), false) then
    raise exception 'Accès refusé pour ce bénéficiaire';
  end if;
  if v_b.agent_id is null then raise exception 'Ce bénéficiaire n''est pas encore affecté à un Agent'; end if;
  if v_b.status <> 'draft' then raise exception 'Ce bénéficiaire a déjà une catégorie validée'; end if;

  v_label := case p_category when 'bg' then 'Gamma' when 'bb' then 'Bêta' else 'Alpha' end;

  perform pg_advisory_xact_lock(hashtext('agent-capacity:' || v_b.agent_id::text));

  select count(*) into v_n from beneficiaries where agent_id = v_b.agent_id and category = p_category;
  v_limit := cap(p_category || '_per_agent');
  if v_n >= v_limit then
    raise exception 'Il n''y a plus de place en % pour cet Agent (maximum %)', v_label, v_limit;
  end if;

  if p_category = 'bg' then
    if p_sponsor is not null then raise exception 'Un Gamma n''a pas de parrain Bêta'; end if;
  else
    if p_sponsor is null then raise exception 'Choisissez le parrain pour un %', v_label; end if;
    select * into v_s from beneficiaries where id = p_sponsor;
    if not found then raise exception 'Parrain introuvable'; end if;
    if v_s.agent_id is distinct from v_b.agent_id then raise exception 'Le parrain doit appartenir au même Agent'; end if;
    if v_s.status = 'archived' then raise exception 'Parrain archivé'; end if;
    if p_category = 'bb' and v_s.category is distinct from 'bg' then raise exception 'Le parrain d''un Bêta doit être un Gamma'; end if;
    if p_category = 'ba' and v_s.category is distinct from 'bb' then raise exception 'Le parrain d''un Alpha doit être un Bêta'; end if;
    select count(*) into v_children from beneficiaries where sponsor_id = p_sponsor;
    v_sub := case when p_category = 'bb' then cap('bb_per_bg') else cap('ba_per_bb') end;
    if v_children >= v_sub then raise exception 'Ce parrain a déjà % filleuls (maximum)', v_sub; end if;
  end if;

  update category_proposals set status = 'superseded', decided_at = now()
   where beneficiary_id = p_beneficiary and status = 'proposed';

  insert into category_proposals (beneficiary_id, agent_id, category, sponsor_id, rank_expected)
  values (p_beneficiary, v_b.agent_id, p_category, p_sponsor, v_n + 1);

  if v_b.user_id is not null then
    insert into notifications (recipient_id, kind, title, body, link) values
      (v_b.user_id, 'categorie', 'Une catégorie vous est proposée',
       'Votre Agent vous propose la catégorie ' || v_label || '. Vous seriez inscrit au rang '
         || (v_n + 1) || ' sur ' || v_limit || ' places ; il reste ' || (v_limit - v_n)
         || ' place(s). Ouvrez votre espace pour accepter ou refuser.',
       '#/espace/categorie');
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 12. Réponse du bénéficiaire : acceptation (fiche active) ou refus
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

  v_code := v_parent || v_tag || (v_seq + 1);

  perform set_config('daraja.affectation', 'on', true);

  update beneficiaries
     set category = v_p.category, agent_seq = v_seq + 1, code = v_code,
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
       || ' (rang ' || (v_seq + 1) || ', code ' || v_code || ').',
     '#/agent/categories'),
    (auth.uid(), 'compte', 'Votre fiche est active',
     'Votre catégorie ' || v_label || ' est enregistrée. Votre code : ' || v_code || '.',
     '#/espace');
end $$;


-- -----------------------------------------------------------------------------
-- 13. Lectures pour les écrans (contournent les politiques, mais vérifient le rôle)
-- -----------------------------------------------------------------------------

-- Ce que voit le bénéficiaire : son identifiant, son choix, son Agent,
-- les places restantes et la proposition en cours (rang « quantième »).
create or replace function public.beneficiary_category_state()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_b beneficiaries%rowtype;
  v_p profiles%rowtype;
  v_a profiles%rowtype;
  v_cp category_proposals%rowtype;
  v_places jsonb := '{}'::jsonb;
  v_cat text;
  v_taken int;
  v_total int;
begin
  if my_role() is distinct from 'beneficiary' then raise exception 'Réservé aux bénéficiaires'; end if;

  select * into v_b from beneficiaries where user_id = auth.uid();
  if not found then raise exception 'Fiche bénéficiaire introuvable'; end if;
  select * into v_p from profiles where id = auth.uid();

  if v_b.agent_id is not null then
    select * into v_a from profiles where id = v_b.agent_id;
    foreach v_cat in array array['ba', 'bb', 'bg'] loop
      v_taken := (select count(*)::int from beneficiaries where agent_id = v_b.agent_id and category = v_cat);
      v_total := cap(v_cat || '_per_agent');
      v_places := v_places || jsonb_build_object(v_cat, jsonb_build_object(
        'total', v_total, 'taken', v_taken, 'left', greatest(v_total - v_taken, 0)));
    end loop;
    select * into v_cp from category_proposals where beneficiary_id = v_b.id and status = 'proposed';
  end if;

  return jsonb_build_object(
    'status', v_b.status,
    'identifiant', v_p.identifiant,
    'code', v_b.code,
    'category', v_b.category,
    'wish', v_p.wish_category,
    'wish_at', v_p.wish_at,
    'affected', v_b.agent_id is not null,
    'agent', case when v_b.agent_id is null then null
                  else jsonb_build_object('name', trim(coalesce(v_a.prenom, '') || ' ' || coalesce(v_a.nom, ''))) end,
    'places', v_places,
    'proposal', case when v_cp.id is null then null else jsonb_build_object(
        'id', v_cp.id,
        'category', v_cp.category,
        'rank', (v_places -> v_cp.category ->> 'taken')::int + 1,
        'total', (v_places -> v_cp.category ->> 'total')::int,
        'left', (v_places -> v_cp.category ->> 'left')::int,
        'sponsor_code', (select code from beneficiaries where id = v_cp.sponsor_id)
      ) end
  );
end $$;

-- Ce que voit l'Agent : quota par catégorie, fiches en attente de catégorie,
-- parrains possibles (Gamma pour les Bêta, Bêta pour les Alpha).
create or replace function public.agent_category_board()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_quota jsonb := '{}'::jsonb;
  v_cat text;
  v_taken int;
  v_total int;
begin
  if my_role() is distinct from 'agent' then raise exception 'Réservé aux Agents'; end if;

  foreach v_cat in array array['ba', 'bb', 'bg'] loop
    v_taken := (select count(*)::int from beneficiaries where agent_id = v_me and category = v_cat);
    v_total := cap(v_cat || '_per_agent');
    v_quota := v_quota || jsonb_build_object(v_cat, jsonb_build_object(
      'total', v_total, 'taken', v_taken, 'left', greatest(v_total - v_taken, 0)));
  end loop;

  return jsonb_build_object(
    'quota', v_quota,
    'waiting', coalesce((
      select jsonb_agg(jsonb_build_object(
          'beneficiary_id', b.id,
          'identifiant', p.identifiant,
          'prenom', b.prenom,
          'nom', b.nom,
          'phone', b.phone,
          'wish', p.wish_category,
          'wish_at', p.wish_at,
          'created_at', b.created_at,
          'proposal', (select jsonb_build_object('id', cp.id, 'category', cp.category, 'sponsor_id', cp.sponsor_id)
                         from category_proposals cp
                        where cp.beneficiary_id = b.id and cp.status = 'proposed')
        ) order by b.created_at)
        from beneficiaries b
        join profiles p on p.id = b.user_id
       where b.agent_id = v_me and b.status = 'draft'
    ), '[]'::jsonb),
    'sponsors', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', s.id,
          'code', s.code,
          'category', s.category,
          'prenom', s.prenom,
          'nom', s.nom,
          'children', (select count(*) from beneficiaries c where c.sponsor_id = s.id),
          'max', case when s.category = 'bg' then cap('bb_per_bg') else cap('ba_per_bb') end
        ) order by s.code)
        from beneficiaries s
       where s.agent_id = v_me and s.category in ('bg', 'bb') and s.status <> 'archived'
    ), '[]'::jsonb)
  );
end $$;


-- -----------------------------------------------------------------------------
-- 14. Droits d'exécution : seules les personnes connectées peuvent appeler
-- -----------------------------------------------------------------------------

revoke all on function public.next_identifiant() from public, anon;
revoke all on function public.affectation_en_cours() from public, anon;
revoke all on function public.my_establishment(uuid) from public, anon;
revoke all on function public.admin_assign_agent(uuid, uuid, integer) from public, anon;
revoke all on function public.beneficiary_set_wish(text) from public, anon;
revoke all on function public.agent_propose_category(uuid, text, uuid) from public, anon;
revoke all on function public.beneficiary_respond_proposal(uuid, boolean) from public, anon;
revoke all on function public.beneficiary_category_state() from public, anon;
revoke all on function public.agent_category_board() from public, anon;

grant execute on function public.my_establishment(uuid) to authenticated;
grant execute on function public.admin_assign_agent(uuid, uuid, integer) to authenticated;
grant execute on function public.beneficiary_set_wish(text) to authenticated;
grant execute on function public.agent_propose_category(uuid, text, uuid) to authenticated;
grant execute on function public.beneficiary_respond_proposal(uuid, boolean) to authenticated;
grant execute on function public.beneficiary_category_state() to authenticated;
grant execute on function public.agent_category_board() to authenticated;
