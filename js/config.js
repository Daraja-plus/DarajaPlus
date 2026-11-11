/* Configuration publique de DarajaPlus.
   Ces valeurs sont publiques par conception : la sécurité repose sur les règles RLS
   et les fonctions serveur (aucun secret ici). */
window.DP = window.DP || {};
DP.config = {
  SITE_NAME: 'DarajaPlus',
  SUPABASE_URL: 'https://nfcfwvrllacpvlcsoycp.supabase.co',
  // Clé anon publique (JWT) : utilisée pour apikey et Authorization sans session.
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5mY2Z3dnJsbGFjcHZsY3NveWNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQyODE5NjEsImV4cCI6MjEwOTg1Nzk2MX0.CW28dKwQY_FIWBadeuBdXBBPx5BAPkj5EoTwlKN3M58',
  CONTACT_EMAIL: '', // À COMPLÉTER : adresse officielle (non fournie)
  VERSION: '1.0'
};
