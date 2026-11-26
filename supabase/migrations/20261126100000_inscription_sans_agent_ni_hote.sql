-- DarajaPlus — inscription : seuls le bénéficiaire et le partenaire (migration P0, 26 novembre 2026)
--
-- Décision du promoteur (26 novembre 2026) : Agent et Hôte ne se choisissent pas à l'inscription.
-- Ce sont des nominations de l'Administrateur.
--
-- Cette migration reprend handle_new_user de 20261122150000 à l'identique, sauf une ligne :
-- un requested_role « agent » ou « host » (ancienne version du site, cache du navigateur)
-- devient « beneficiary » au lieu d'être accepté.
-- Choix proposé (à confirmer) : devenir bénéficiaire plutôt que refuser l'inscription.
--
-- Migration NON appliquée. Test en transaction annulée seulement.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_req text := coalesce(new.raw_user_meta_data->>'requested_role', 'beneficiary');
  v_cat text := coalesce(new.raw_user_meta_data->>'partner_category', 'autre');
  v_prov text := nullif(trim(new.raw_user_meta_data->>'province'), '');
  v_ltype text := nullif(trim(new.raw_user_meta_data->>'localite_type'), '');
  v_lnom text := nullif(trim(new.raw_user_meta_data->>'localite_nom'), '');
begin
  -- Changement P0 : agent et host ne sont plus des choix d'inscription.
  if v_req not in ('beneficiary','partner') then v_req := 'beneficiary'; end if;

  if new.raw_user_meta_data ? 'requested_role' then
    if v_prov is null or v_prov not in (
      'Kinshasa', 'Kongo Central', 'Kwango', 'Kwilu', 'Mai-Ndombe', 'Kasaï', 'Kasaï Central',
      'Kasaï Oriental', 'Lomami', 'Sankuru', 'Maniema', 'Sud-Kivu', 'Nord-Kivu', 'Ituri',
      'Haut-Uélé', 'Tshopo', 'Bas-Uélé', 'Nord-Ubangi', 'Sud-Ubangi', 'Mongala', 'Équateur',
      'Tshuapa', 'Tanganyika', 'Haut-Lomami', 'Lualaba', 'Haut-Katanga') then
      raise exception 'Choisissez votre province dans la liste.';
    end if;
    if v_ltype is null or v_ltype not in ('ville', 'village') then
      raise exception 'Indiquez si vous êtes en ville ou en village.';
    end if;
    if v_lnom is null or length(v_lnom) > 120 then
      raise exception 'Indiquez le nom de votre ville ou de votre village.';
    end if;
  end if;

  insert into profiles (id, role, status, requested_role, nom, postnom, prenom, phone, email,
                        province, localite_type, localite_nom)
  values (new.id, v_req, 'pending', v_req,
          nullif(trim(new.raw_user_meta_data->>'nom'), ''),
          nullif(trim(new.raw_user_meta_data->>'postnom'), ''),
          nullif(trim(new.raw_user_meta_data->>'prenom'), ''),
          nullif(trim(new.raw_user_meta_data->>'phone'), ''),
          new.email,
          v_prov, v_ltype, v_lnom);

  if v_req = 'partner' then
    if (select count(*) from partners) >= cap('partners') then
      raise exception 'Le nombre maximal de partenaires est atteint';
    end if;
    if v_cat not in ('institution_financiere','investisseur','incubateur','autre') then v_cat := 'autre'; end if;
    insert into partners (profile_id, category, legal_name, representative, contact_email, phone,
                          description, sectors, geography, ticket_min, ticket_max)
    values (new.id, v_cat,
            coalesce(nullif(trim(new.raw_user_meta_data->>'legal_name'), ''), 'Non renseigné'),
            nullif(trim(new.raw_user_meta_data->>'representative'), ''),
            new.email,
            nullif(trim(new.raw_user_meta_data->>'phone'), ''),
            nullif(trim(new.raw_user_meta_data->>'description'), ''),
            nullif(trim(new.raw_user_meta_data->>'sectors'), ''),
            nullif(trim(new.raw_user_meta_data->>'geography'), ''),
            nullif(new.raw_user_meta_data->>'ticket_min', '')::numeric,
            nullif(new.raw_user_meta_data->>'ticket_max', '')::numeric);
  end if;
  return new;
end $function$;
