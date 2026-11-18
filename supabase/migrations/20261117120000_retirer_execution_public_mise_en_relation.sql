-- Retire le droit d'exécution accordé à PUBLIC (donc à anon) sur les fonctions de mise en relation.
-- Ces fonctions ne doivent être appelées que par un utilisateur connecté (authenticated) ou par le service (service_role).
-- Les contrôles d'identité dans les fonctions restent en place ; cette migration ajoute une barrière au niveau des droits.

revoke all on function public.partner_request_connection(uuid, text) from public, anon;
grant execute on function public.partner_request_connection(uuid, text) to authenticated, service_role;

revoke all on function public.admin_review_connection(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_connection(uuid, boolean, text) to authenticated, service_role;

revoke all on function public.beneficiary_consent(uuid, uuid[], integer) from public, anon;
grant execute on function public.beneficiary_consent(uuid, uuid[], integer) to authenticated, service_role;
