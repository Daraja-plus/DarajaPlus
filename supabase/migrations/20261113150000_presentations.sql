-- DarajaPlus — « Présenter mon projet » : une fiche de présentation par bénéficiaire.
-- Contenu : une réponse par rubrique (content, JSON) et jusqu'à 4 photos (photos, chemins dans le bucket privé « visuels »,
-- dans le dossier du bénéficiaire).
-- Accès : seul le bénéficiaire lit, crée et modifie sa fiche. Aucun accès pour l'administrateur ni pour les partenaires
-- (décision à prendre). Pas de suppression depuis le site.

create table if not exists public.presentations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  content jsonb not null default '{}'::jsonb,
  photos jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint presentations_content_objet check (jsonb_typeof(content) = 'object'),
  constraint presentations_photos_max check (
    case when jsonb_typeof(photos) = 'array' then jsonb_array_length(photos) <= 4 else false end
  )
);

alter table public.presentations enable row level security;

-- Le visiteur non connecté n'a aucun droit ; le compte connecté ne peut ni supprimer ni tronquer la table.
revoke all on table public.presentations from anon;
revoke all on table public.presentations from authenticated;
grant select, insert, update on table public.presentations to authenticated;

create policy presentations_proprietaire_lecture on public.presentations
  for select to authenticated
  using (user_id = auth.uid());

create policy presentations_proprietaire_creation on public.presentations
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'beneficiary')
  );

create policy presentations_proprietaire_modification on public.presentations
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
