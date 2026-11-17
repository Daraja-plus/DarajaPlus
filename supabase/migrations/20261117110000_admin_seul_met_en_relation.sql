-- Seul l'administrateur général met en relation.
-- Avant : un partenaire sollicitait une mise en relation (statut « demandée ») et l'administrateur la validait.
-- Après : le partenaire ne peut plus créer de demande. L'administrateur choisit le projet et le partenaire
-- et crée la mise en relation, déjà au statut « validée par l'administrateur ».
-- Les demandes de partenaires déjà en attente restent à valider par l'administrateur (admin_review_connection).

-- 1. Le partenaire ne peut plus créer de mise en relation.
create or replace function public.partner_request_connection(p_project uuid, p_motive text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  raise exception 'La mise en relation est faite par l’Administrateur. Écrivez-lui depuis la messagerie.';
end $function$;

-- 2. L'administrateur crée la mise en relation.
create or replace function public.admin_mettre_en_relation(p_project uuid, p_partner uuid, p_motive text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ben uuid;
  v_id uuid;
begin
  if not is_admin() then raise exception 'Réservé à l''administrateur général'; end if;
  if char_length(coalesce(trim(p_motive), '')) < 20 then raise exception 'Motif : au moins 20 caractères'; end if;

  select beneficiary_id into v_ben from projects where id = p_project and status = 'ready';
  if not found then raise exception 'Ce dossier n''est pas encore prêt à être présenté'; end if;
  if v_ben is null then
    raise exception 'Ce projet n''a pas de bénéficiaire rattaché : la mise en relation n''est pas encore possible';
  end if;

  if not exists (select 1 from partners pa join profiles pr on pr.id = pa.profile_id
                 where pa.id = p_partner and pr.role = 'partner' and pr.status = 'active') then
    raise exception 'Partenaire introuvable ou non actif';
  end if;

  if exists (select 1 from connection_requests
             where project_id = p_project and partner_id = p_partner
               and status not in ('refused_admin', 'refused', 'closed', 'cancelled')) then
    raise exception 'Une mise en relation est déjà en cours pour ce dossier';
  end if;

  insert into connection_requests (project_id, partner_id, requested_by, motive)
  values (p_project, p_partner, auth.uid(), trim(p_motive))
  returning id into v_id;

  -- L'administrateur a déjà décidé : le statut « demandée » est franchi tout de suite.
  update connection_requests set status = 'approved_admin' where id = v_id;

  return v_id;
end $function$;

revoke all on function public.admin_mettre_en_relation(uuid, uuid, text) from public, anon;
grant execute on function public.admin_mettre_en_relation(uuid, uuid, text) to authenticated, service_role;
