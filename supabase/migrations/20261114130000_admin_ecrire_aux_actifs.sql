-- DarajaPlus — administrateur : écrire à tous les comptes actifs.
--
-- Le message est enregistré dans les notifications de chaque compte actif (sauf celui de l'administrateur).
-- Chaque notification déclenche aussi l'alerte sur téléphone, si la personne l'a activée.
-- Réservé à l'administrateur général. Titre : 120 caractères au maximum ; message : 1000 au maximum.
-- Migration additive : une nouvelle fonction, aucune table modifiée.

create or replace function public.admin_ecrire_aux_actifs(p_title text, p_body text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not is_admin() then raise exception 'Réservé à l''administrateur général'; end if;
  if p_title is null or btrim(p_title) = '' then raise exception 'Le titre est obligatoire.'; end if;
  if p_body is null or btrim(p_body) = '' then raise exception 'Le message est obligatoire.'; end if;
  if char_length(btrim(p_title)) > 120 then raise exception 'Le titre ne doit pas dépasser 120 caractères.'; end if;
  if char_length(btrim(p_body)) > 1000 then raise exception 'Le message ne doit pas dépasser 1000 caractères.'; end if;

  insert into public.notifications (recipient_id, kind, title, body, link)
  select p.id, 'annonce', btrim(p_title), btrim(p_body), null
  from public.profiles p
  where p.status = 'active' and p.role <> 'admin';

  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.admin_ecrire_aux_actifs(text, text) from public, anon;
grant execute on function public.admin_ecrire_aux_actifs(text, text) to authenticated;
