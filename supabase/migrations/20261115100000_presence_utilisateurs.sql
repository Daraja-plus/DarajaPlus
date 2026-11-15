-- DarajaPlus — présence des utilisateurs (en ligne ou vus il y a combien de temps).
--
-- L'application signale une activité au serveur toutes les 2 minutes, tant qu'elle est ouverte.
-- Le serveur n'enregistre qu'au plus une fois par minute et par personne.
-- Seule la date de dernière activité est conservée, dans une table séparée (aucun journal d'audit,
-- aucune notification) : seul l'administrateur peut la lire.
-- Migration additive : une nouvelle table et une nouvelle fonction, aucune table existante modifiée.

create table if not exists public.presences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

alter table public.presences enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'presences' and policyname = 'presences_admin_lecture') then
    create policy presences_admin_lecture on public.presences for select to authenticated using (public.is_admin());
  end if;
end $$;

revoke all on public.presences from anon, authenticated;
grant select on public.presences to authenticated;

create or replace function public.marquer_presence()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'active') then return; end if;
  insert into public.presences (profile_id, last_seen_at) values (auth.uid(), now())
  on conflict (profile_id) do update set last_seen_at = excluded.last_seen_at
  where public.presences.last_seen_at < now() - interval '60 seconds';
end $$;

revoke all on function public.marquer_presence() from public, anon;
grant execute on function public.marquer_presence() to authenticated;
