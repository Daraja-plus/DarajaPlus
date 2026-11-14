-- DarajaPlus — notifier la personne quand l'administrateur lui écrit en privé.
--
-- Chaque message privé écrit par l'administrateur crée une notification pour la personne destinataire
-- (rubrique « Notifications », et alerte sur téléphone si elle est activée).
-- Les messages envoyés par les personnes à l'administrateur ne notifient pas la personne elle-même :
-- l'administrateur est déjà notifié par le déclencheur existant (admin_notify_messages).
-- Migration additive : une nouvelle fonction et un nouveau déclencheur, aucune table modifiée.

create or replace function public.notifier_message_administrateur()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.from_admin then
    insert into public.notifications (recipient_id, kind, title, body, link)
    values (new.thread_user_id, 'message', 'Nouveau message de l’Administrateur', left(new.body, 140), '#/messages');
  end if;
  return null;
end $$;

drop trigger if exists notifier_message_administrateur on public.messages;
create trigger notifier_message_administrateur
  after insert on public.messages
  for each row execute function public.notifier_message_administrateur();
