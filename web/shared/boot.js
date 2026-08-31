// =============================================================================
// Starting up
// =============================================================================

import { config } from "../config.js";
import { createApi } from "./api.js";
import { DEFAULT_TIMEZONE } from "./format.js";

const SUPABASE_CDN = "https://esm.sh/@supabase/supabase-js@2.45.4";

export async function boot() {
  // A test may put a stubbed client here. It is checked for explicitly rather
  // than by mocking the module loader, so it is obvious from reading this
  // function that the hook exists — and it does nothing unless something sets
  // it, which nothing in production does.
  const injected = globalThis.__PTP_TEST_CLIENT__;

  // A hanging script tag is indistinguishable from a broken page. Ten seconds
  // is long enough for a bad connection and short enough that somebody on a
  // platform gets an answer rather than a spinner.
  const client = injected ?? await withTimeout(
    import(SUPABASE_CDN).then(({ createClient }) => createClient(
      config.supabaseUrl,
      config.supabaseAnonKey,
      { auth: { persistSession: true, autoRefreshToken: true } },
    )),
    10_000,
    "Could not load the booking system",
  );

  const api = createApi(client, {
    functionsBase: config.functionsBase,
    timeZone: config.timeZone,
  });

  // The club's timezone, and the cancellation window, come from the database.
  // A portal that hard-codes either will one day disagree with the server in
  // front of a parent.
  try {
    const settings = await api.settings(["display_timezone", "free_cancel_hours"]);
    api.timeZone = stripQuotes(settings.display_timezone) ?? DEFAULT_TIMEZONE;
    api.freeCancelHours = Number(settings.free_cancel_hours ?? 24);
  } catch {
    api.timeZone = DEFAULT_TIMEZONE;
    api.freeCancelHours = 24;
  }

  return api;
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

// system_settings.value is jsonb, so a string setting arrives as '"America/New_York"'
// through PostgREST rather than as a bare string.
function stripQuotes(value) {
  if (typeof value !== "string") return value ?? null;
  return value.replace(/^"|"$/g, "") || null;
}
