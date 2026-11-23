-- DarajaPlus — localisation de chaque utilisateur : province, ville ou village (migration du 22 novembre 2026)
--
-- Décisions du promoteur (22 novembre 2026) :
--  1. Province : choisie dans la liste des 26 provinces de la RDC.
--  2. Ville ou village : d'abord le type (ville ou village), puis le nom.
--  3. Obligatoire pour tous les rôles. Les comptes existants la renseignent à leur prochaine
--     connexion (garde dans le site). La base l'exige pour toute inscription faite sur le site.
--  4. Visible par l'administrateur seulement : aucune fonction partenaire ne renvoie ces colonnes.
--
-- Colonnes vides autorisées pour les comptes existants : tout est renseigné ensemble ou pas du tout.
-- Migration NON appliquée. Elle est testée dans supabase/scripts (transaction annulée) avant application.

alter table public.profiles
  add column if not exists province text,
  add column if not exists localite_type text,
  add column if not exists localite_nom text;

-- Attention : une CHECK qui vaut NULL est acceptée par PostgreSQL. Chaque condition porte donc
-- sur « is not null » : une valeur absente fait échouer la contrainte.
alter table public.profiles drop constraint if exists profiles_localisation_check;
alter table public.profiles add constraint profiles_localisation_check check (
  (province is null and localite_type is null and localite_nom is null)
  or (
    province is not null
    and province in (
      'Kinshasa', 'Kongo Central', 'Kwango', 'Kwilu', 'Mai-Ndombe', 'Kasaï', 'Kasaï Central',
      'Kasaï Oriental', 'Lomami', 'Sankuru', 'Maniema', 'Sud-Kivu', 'Nord-Kivu', 'Ituri',
      'Haut-Uélé', 'Tshopo', 'Bas-Uélé', 'Nord-Ubangi', 'Sud-Ubangi', 'Mongala', 'Équateur',
      'Tshuapa', 'Tanganyika', 'Haut-Lomami', 'Lualaba', 'Haut-Katanga'
    )
    and localite_type is not null and localite_type in ('ville', 'village')
    and localite_nom is not null and length(trim(localite_nom)) between 1 and 120
  )
);

-- Inscription : la fonction reprend son comportement d'origine et ajoute la localisation.
-- Pour une inscription faite sur le site (requested_role présent), la localisation est obligatoire.
-- Une création de compte sans requested_role (tableau de bord Supabase) n'est pas bloquée.
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
  if v_req not in ('beneficiary','agent','host','partner') then v_req := 'beneficiary'; end if;

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
