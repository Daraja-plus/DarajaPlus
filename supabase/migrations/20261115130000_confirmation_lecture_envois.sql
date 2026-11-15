-- DarajaPlus — confirmation de lecture des messages envoyés à tous les comptes actifs.
--
-- Chaque envoi « Écrire aux comptes actifs » reçoit un identifiant commun, porté par toutes ses notifications.
-- L’administrateur voit combien de destinataires ont lu (« 12 sur 40 »).
-- « Lu » = la notification a été marquée comme lue (bouton « Ouvrir » ou « Tout marquer comme lu »).
-- Migration additive : une colonne nullable, un index partiel, une fonction nouvelle et une fonction remplacée.

alter table public.notifications add column if not exists diffusion_id uuid;

create index if not exists notifications_diffusion_idx on public.notifications (diffusion_id) where diffusion_id is not null;

create or replace function public.admin_ecrire_aux_actifs(p_title text, p_body text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
  v_envoi uuid := gen_random_uuid();
begin
  if not is_admin() then raise exception 'Réservé à l''administrateur général'; end if;
  if p_title is null or btrim(p_title) = '' then raise exception 'Le titre est obligatoire.'; end if;
  if p_body is null or btrim(p_body) = '' then raise exception 'Le message est obligatoire.'; end if;
  if char_length(btrim(p_title)) > 120 then raise exception 'Le titre ne doit pas dépasser 120 caractères.'; end if;
  if char_length(btrim(p_body)) > 1000 then raise exception 'Le message ne doit pas dépasser 1000 caractères.'; end if;

  insert into public.notifications (recipient_id, kind, title, body, link, diffusion_id)
  select p.id, 'annonce', btrim(p_title), btrim(p_body), null, v_envoi
  from public.profiles p
  where p.status = 'active' and p.role <> 'admin';

  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Suivi des envois pour l’administrateur : destinataires et nombre de personnes qui ont lu.
create or replace function public.lecture_envois_admin()
returns table (id_envoi uuid, titre text, texte text, envoye_le timestamptz, destinataires integer, lus integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Réservé à l''administrateur général'; end if;
  return query
    select n.diffusion_id, min(n.title), min(n.body), min(n.created_at), count(*)::integer, count(n.read_at)::integer
    from public.notifications n
    where n.diffusion_id is not null
    group by n.diffusion_id
    order by min(n.created_at) desc
    limit 100;
end $$;

revoke all on function public.lecture_envois_admin() from public, anon;
grant execute on function public.lecture_envois_admin() to authenticated;
