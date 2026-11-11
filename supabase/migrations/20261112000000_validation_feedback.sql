-- =============================================================================
-- DarajaPlus — validation immédiate des comptes
--
-- 1. Dès qu'un compte passe de « en attente » (ou « refusé ») à « actif », la
--    personne reçoit une notification datée (date et heure de Kinshasa) qui la
--    confirme et l'invite à commencer. Le type de notification est « compte_valide ».
-- 2. Le journal d'audit (audit_logs) enregistre déjà chaque changement de statut
--    avec validated_at et validated_by (trigger audit_profiles) : l'historique
--    est conservé sans écriture supplémentaire.
-- 3. Les autres changements de statut (suspension, réactivation, refus) gardent
--    leur notification d'avant.
--
-- Idempotente : peut être rejouée sans erreur.
-- Le trigger profiles_notify (AFTER UPDATE OF status) existe déjà : on remplace
-- seulement sa fonction.
-- =============================================================================

create or replace function public.notify_profile_status()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_home text;
  v_when text;
  v_invite text;
begin
  if new.status is not distinct from old.status or new.role = 'admin' then
    return new;
  end if;

  -- espace d'accueil de chaque rôle (correspond à homeFor() dans js/app.js)
  v_home := case new.role
    when 'beneficiary' then '#/espace'
    when 'host' then '#/hote'
    when 'agent' then '#/agent'
    when 'partner' then '#/partenaire'
    else '#/'
  end;

  if new.status = 'active' and old.status in ('pending', 'rejected') then
    v_when := to_char(coalesce(new.validated_at, now()) at time zone 'Africa/Kinshasa', 'DD/MM/YYYY "à" HH24:MI');
    v_invite := case new.role
      when 'beneficiary' then 'Consultez votre fiche, déposez vos pièces et découvrez les opportunités.'
      when 'host' then 'Suivez les Agents et les bénéficiaires de votre zone.'
      when 'agent' then 'Enregistrez et accompagnez vos bénéficiaires.'
      when 'partner' then 'Présentez vos offres et consultez les dossiers autorisés.'
      else ''
    end;
    insert into notifications (recipient_id, kind, title, body, link)
    values (new.id, 'compte_valide', 'Votre compte est validé',
            'Validé le ' || v_when || ' (heure de Kinshasa). ' || v_invite || ' Commencez dès maintenant.',
            v_home);
    return new;
  end if;

  insert into notifications (recipient_id, kind, title, body, link)
  values (new.id, 'compte',
    case new.status
      when 'active' then 'Votre compte est de nouveau actif'
      when 'rejected' then 'Votre demande de compte n''a pas été retenue'
      when 'suspended' then 'Votre compte est suspendu'
      else 'Votre compte est en attente de validation'
    end,
    coalesce(new.rejection_reason, 'Ouvrez votre espace pour voir les étapes suivantes.'),
    case when new.status = 'active' then v_home else '#/en-attente' end);
  return new;
end $function$;
