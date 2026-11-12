-- Notifications sur téléphone (Web Push).
-- 1) abonnements des appareils (un appareil = un abonnement, protégé par RLS) ;
-- 2) fonctions d'enregistrement, de vérification du secret et d'envoi ;
-- 3) envoi automatique à chaque nouvelle notification, via la fonction Edge « push-notify ».
-- Le secret partagé est créé dans le coffre Supabase (vault) et n'est jamais affiché.

create extension if not exists pg_net;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_profile_idx on public.push_subscriptions (profile_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using (profile_id = auth.uid());

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated using (profile_id = auth.uid());

-- Secret partagé entre la base et la fonction : créé une seule fois, jamais affiché.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'push_webhook_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'push_webhook_secret',
      'Secret partagé entre la base et la fonction push-notify'
    );
  end if;
end $$;

-- La fonction Edge vérifie le secret qu'elle reçoit, sans jamais le connaître.
create or replace function public.push_check_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'push_webhook_secret' and decrypted_secret = p_secret
  );
$$;

revoke all on function public.push_check_secret(text) from public, anon, authenticated;
grant execute on function public.push_check_secret(text) to service_role;

-- Enregistrement de l'appareil par l'utilisateur connecté (compte actif uniquement).
-- Si l'appareil était déjà abonné par un autre compte, l'abonnement est transféré au compte courant.
create or replace function public.push_register_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'active') then
    raise exception 'Compte non actif.';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 2000
     or p_p256dh is null or p_auth is null then
    raise exception 'Abonnement invalide.';
  end if;
  insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, user_agent, last_seen_at)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200), now())
  on conflict (endpoint) do update set
    profile_id = excluded.profile_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    last_seen_at = now();
end;
$$;

revoke all on function public.push_register_subscription(text, text, text, text) from public, anon;
grant execute on function public.push_register_subscription(text, text, text, text) to authenticated;

-- Déclencheur : demande l'envoi après chaque nouvelle notification.
-- Une erreur d'envoi ne doit jamais empêcher l'enregistrement de la notification.
create or replace function public.push_notify_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  begin
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'push_webhook_secret';

    if v_secret is not null then
      perform net.http_post(
        url := 'https://nfcfwvrllacpvlcsoycp.supabase.co/functions/v1/push-notify',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
        body := jsonb_build_object('notification_id', new.id),
        timeout_milliseconds := 5000
      );
    end if;
  exception when others then
    raise warning 'Notification sur téléphone non envoyée : %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.push_notify_on_insert() from public, anon, authenticated;

drop trigger if exists notifications_push_after_insert on public.notifications;
create trigger notifications_push_after_insert
  after insert on public.notifications
  for each row execute function public.push_notify_on_insert();
