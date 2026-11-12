/* DarajaPlus — envoi des notifications sur téléphone (Web Push).
   Appelée par la base de données à chaque nouvelle notification (voir la migration push_notifications).
   Sécurité :
   - la requête doit porter le secret partagé (en-tête x-push-secret), vérifié dans la base ;
   - le message est volontairement générique : aucun contenu personnel n'apparaît sur l'écran verrouillé ;
   - les abonnements expirés (404 / 410) sont supprimés automatiquement. */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { encryptPayload, vapidAuthorization } from "./webpush.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
// Clé publique VAPID : identique à DP.config.VAPID_PUBLIC_KEY côté site (ce n'est pas un secret).
const VAPID_PUBLIC_KEY = "BLl12mljo3bAkAG2AuAfGsEYFLJwSgmySMFd6o1sW9_5fBOdr7ukNeOJmWgvzOSwXiiOIwusau7tvO68TqiMci0";
const VAPID_SUBJECT = "https://darajaplus.vercel.app";

const PAYLOAD = JSON.stringify({
  title: "DarajaPlus",
  body: "Vous avez une nouvelle notification.",
  url: "./#/notifications"
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...((init.headers as Record<string, string>) ?? {})
    }
  });
}

async function checkSecret(secret: string): Promise<boolean> {
  if (!secret) return false;
  const res = await rest("rpc/push_check_secret", { method: "POST", body: JSON.stringify({ p_secret: secret }) });
  if (!res.ok) return false;
  return (await res.json()) === true;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  if (!VAPID_PRIVATE_KEY || !SUPABASE_URL || !SERVICE_KEY) return json({ error: "Configuration incomplète." }, 500);

  if (!(await checkSecret(req.headers.get("x-push-secret") ?? ""))) {
    return json({ error: "Non autorisé." }, 401);
  }

  const input = await req.json().catch(() => null);
  const id = input && typeof input.notification_id === "string" ? input.notification_id : "";
  if (!UUID.test(id)) return json({ error: "Requête invalide." }, 400);

  const notifs = await (await rest(`notifications?select=recipient_id&id=eq.${id}`)).json().catch(() => []);
  if (!Array.isArray(notifs) || notifs.length === 0) return json({ sent: 0, removed: 0, failed: 0 });

  const subs = await (await rest(
    `push_subscriptions?select=id,endpoint,p256dh,auth&profile_id=eq.${notifs[0].recipient_id}`
  )).json().catch(() => []);
  if (!Array.isArray(subs)) return json({ error: "Lecture impossible." }, 500);

  const plaintext = new TextEncoder().encode(PAYLOAD);
  let sent = 0, removed = 0, failed = 0;
  for (const s of subs) {
    try {
      const body = await encryptPayload(plaintext, s.p256dh, s.auth);
      const res = await fetch(s.endpoint, {
        method: "POST",
        headers: {
          Authorization: await vapidAuthorization(s.endpoint, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT),
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: "86400",
          Urgency: "normal"
        },
        body
      });
      if (res.status === 201 || res.status === 200) {
        sent++;
      } else if (res.status === 404 || res.status === 410) {
        // Abonnement expiré ou désinstallé : on le supprime.
        await rest(`push_subscriptions?id=eq.${s.id}`, { method: "DELETE" });
        removed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }
  return json({ sent, removed, failed });
});
