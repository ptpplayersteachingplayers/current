// =============================================================================
// Deployment configuration
// =============================================================================
// Only public values live here. The anon key is designed to be published — it
// carries no authority of its own; every row it can reach is decided by RLS.
//
// The service role key, the Stripe secret and the job secret are NOT here and
// must never be. If one ever appears in this directory, rotate it: this file
// ships to every browser that loads the site.
// =============================================================================

export const config = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-ANON-KEY",

  get functionsBase() {
    return `${this.supabaseUrl}/functions/v1`;
  },

  // Overridden at runtime from system_settings.display_timezone, so this is
  // only what the first paint uses.
  timeZone: "America/New_York",

  // Publishable, by name and by design. Used to mount Stripe's payment form.
  stripePublishableKey: "pk_test_REPLACE_ME",
};
