-- =============================================================================
-- DarajaPlus — migration « notifications administrateur, contacts, stockage »
--
-- Reconstituée à partir de l'état réellement appliqué sur la base
-- (projet Supabase nfcfwvrllacpvlcsoycp). Elle est idempotente : elle peut être
-- rejouée sans erreur.
--
-- Prérequis : le schéma de base (tables profiles, notifications, messages,
-- offers, carrefours, carrefour_members, carrefour_ledger, documents, projects,
-- beneficiaries, visibility_orders, announcements, funding_outcomes,
-- connection_requests ; fonctions is_admin(), can_access_beneficiary(),
-- partner_can_read_document(), my_beneficiary_id()).
-- Ce schéma de base n'est pas encore dans le dépôt : voir supabase/README.md.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Notifications de l'administrateur
--    Chaque événement important crée une ligne « notifications » pour chaque
--    compte administrateur. Les actions de l'administrateur lui-même ne sont
--    pas notifiées.
-- -----------------------------------------------------------------------------
create or replace function public.admin_notify_event()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_kind text; v_title text; v_body text; v_link text;
begin
  -- l'administrateur n'est pas notifié de ses propres actions
  if public.is_admin() then return null; end if;
  if tg_table_name = 'messages' and new.from_admin then return null; end if;
  v_link := '#/admin';
  case tg_table_name
    when 'profiles' then
      v_kind := 'nouveau_compte'; v_title := 'Nouveau compte à valider';
      v_body := trim(coalesce(new.prenom,'') || ' ' || coalesce(new.nom,'')) || ' — demande : ' || coalesce(new.requested_role,'');
      v_link := '#/admin/comptes';
    when 'connection_requests' then
      v_kind := 'mise_en_relation';
      v_title := case when tg_op = 'INSERT' then 'Nouvelle demande de mise en relation' else 'Mise en relation : ' || new.status end;
      v_body := 'Dossier ' || left(new.id::text, 8);
      v_link := '#/admin/ponts';
    when 'funding_outcomes' then
      v_kind := 'resultat'; v_title := 'Résultat déclaré par un partenaire';
      v_body := coalesce(new.result_type,'') || ' — ' || coalesce(new.amount::text,'') || ' ' || coalesce(new.currency,'');
      v_link := '#/admin/resultats';
    when 'messages' then
      v_kind := 'message'; v_title := 'Nouveau message privé'; v_body := left(new.body, 140);
      v_link := '#/admin/messages';
    when 'offers' then
      v_kind := 'offre'; v_title := 'Nouvelle offre publiée'; v_body := coalesce(new.title,'');
      v_link := '#/admin/offres';
    when 'carrefours' then
      v_kind := 'carrefour'; v_title := 'Nouveau carrefour créé'; v_body := coalesce(new.name,'');
      v_link := '#/admin/carrefours';
    when 'carrefour_members' then
      v_kind := 'carrefour'; v_title := 'Demande d''adhésion à un carrefour'; v_body := 'Bénéficiaire ' || left(new.beneficiary_id::text,8);
      v_link := '#/admin/carrefours';
    when 'visibility_orders' then
      v_kind := 'visibilite'; v_title := 'Nouvelle commande de visibilité';
      v_body := new.amount_fc || ' FC — ' || new.days || ' jour(s)';
      v_link := '#/admin/finances';
    when 'announcements' then
      v_kind := 'annonce'; v_title := 'Nouvelle annonce : ' || coalesce(new.title,''); v_body := coalesce(new.audience,'');
      v_link := '#/admin/annonces';
    when 'documents' then
      v_kind := 'document'; v_title := 'Nouveau document déposé';
      v_body := coalesce(new.doc_type,'') || ' — ' || coalesce(new.file_name,'');
    when 'projects' then
      v_kind := 'projet'; v_title := 'Nouveau projet / besoin';
      v_body := coalesce(new.title,'') || ' — ' || coalesce(new.amount::text,'') || ' ' || coalesce(new.currency,'');
      v_link := '#/admin/projets';
    when 'beneficiaries' then
      v_kind := 'beneficiaire'; v_title := 'Nouveau bénéficiaire enregistré';
      v_body := coalesce(new.code,'') || ' — ' || coalesce(new.prenom,'') || ' ' || coalesce(new.nom,'');
      v_link := '#/admin/beneficiaires';
    when 'contact_requests' then
      v_kind := 'contact'; v_title := 'Nouveau message de contact';
      v_body := coalesce(new.subject,'') || ' — ' || coalesce(new.name,'');
      v_link := '#/admin/contacts';
    else return null;
  end case;
  insert into public.notifications (recipient_id, kind, title, body, link)
  select id, v_kind, v_title, v_body, v_link from public.profiles where role = 'admin';
  return null;
end $function$;

drop trigger if exists admin_notify_profiles on public.profiles;
create trigger admin_notify_profiles after insert on public.profiles
  for each row execute function public.admin_notify_event();

drop trigger if exists admin_notify_connections on public.connection_requests;
create trigger admin_notify_connections after insert or update of status on public.connection_requests
  for each row execute function public.admin_notify_event();

drop trigger if exists admin_notify_outcomes on public.funding_outcomes;
create trigger admin_notify_outcomes after insert on public.funding_outcomes
  for each row execute function public.admin_notify_event();

drop trigger if exists admin_notify_messages on public.messages;
create trigger admin_notify_messages after insert on public.messages
  for each row execute function public.admin_notify_event();

drop trigger if exists admin_notify_offers on public.offers;
create trigger admin_notify_offers after insert on public.offers
  for each row execute function public.admin_notify_event();

drop trigger if exists admin_notify_carrefours on public.carrefours;
create trigger admin_notify_carrefours after insert on public.carrefours
  for each row execute function public.admin_notify_event();

drop trigger if exists admin_notify_carrefour_members on public.carrefour_members;
create trigger admin_notify_carrefour_members after insert on public.carrefour_members
  for each row execute function public.admin_notify_event();

drop trigger if exists admin_notify_visibility on public.visibility_orders;
create trigger admin_notify_visibility after insert on public.visibility_orders
  for each row execute function public.admin_notify_event();

drop trigger if exists admin_notify_announcements on public.announcements;
create trigger admin_notify_announcements after insert on public.announcements
  for each row execute function public.admin_notify_event();

drop trigger if exists admin_notify_documents on public.documents;
create trigger admin_notify_documents after insert on public.documents
  for each row execute function public.admin_notify_event();

drop trigger if exists admin_notify_projects on public.projects;
create trigger admin_notify_projects after insert on public.projects
  for each row execute function public.admin_notify_event();

drop trigger if exists admin_notify_beneficiaries on public.beneficiaries;
create trigger admin_notify_beneficiaries after insert on public.beneficiaries
  for each row execute function public.admin_notify_event();

drop trigger if exists admin_notify_contact on public.contact_requests;
create trigger admin_notify_contact after insert on public.contact_requests
  for each row execute function public.admin_notify_event();


-- -----------------------------------------------------------------------------
-- 2. Messages de contact (formulaire public)
--    Tout visiteur peut envoyer un message ; seul l'administrateur le lit
--    et le met à jour.
-- -----------------------------------------------------------------------------
create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  subject text not null default 'Information',
  message text not null,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

alter table public.contact_requests enable row level security;

drop policy if exists contact_insert on public.contact_requests;
create policy contact_insert on public.contact_requests
  for insert to anon, authenticated
  with check (true);

drop policy if exists contact_admin_read on public.contact_requests;
create policy contact_admin_read on public.contact_requests
  for select to authenticated
  using (is_admin());

drop policy if exists contact_admin_update on public.contact_requests;
create policy contact_admin_update on public.contact_requests
  for update to authenticated
  using (is_admin())
  with check (is_admin());


-- -----------------------------------------------------------------------------
-- 3. Correctif de la politique de lecture du grand livre des carrefours
--    La version précédente contenait une comparaison d'une colonne avec elle-même
--    (faille de sécurité corrigée). Politique actuelle : administrateur,
--    organisateur du carrefour, ou membre accepté.
-- -----------------------------------------------------------------------------
drop policy if exists ledger_read on public.carrefour_ledger;
create policy ledger_read on public.carrefour_ledger
  for select to authenticated
  using (
    is_admin()
    or exists (
      select 1 from public.carrefours c
      where c.id = carrefour_ledger.carrefour_id
        and c.organizer_id = auth.uid()
    )
    or exists (
      select 1 from public.carrefour_members m
      where m.carrefour_id = carrefour_ledger.carrefour_id
        and m.beneficiary_id = my_beneficiary_id()
        and m.status = 'accepted'
    )
  );


-- -----------------------------------------------------------------------------
-- 4. Stockage des pièces (bucket privé « documents »)
--    Les fichiers sont rangés dans un dossier au nom de l'identifiant de
--    l'utilisateur. Lecture : le propriétaire, l'administrateur, le bénéficiaire
--    concerné ou le partenaire autorisé. Aucun lien public.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists docs_owner_insert on storage.objects;
create policy docs_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists docs_owner_delete on storage.objects;
create policy docs_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists docs_read on storage.objects;
create policy docs_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (
      (storage.foldername(name))[1] = (auth.uid())::text
      or is_admin()
      or exists (
        select 1 from public.documents d
        where d.storage_path = objects.name
          and (can_access_beneficiary(d.owner_beneficiary_id) or partner_can_read_document(d.id))
      )
    )
  );
