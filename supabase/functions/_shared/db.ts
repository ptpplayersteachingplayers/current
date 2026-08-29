// =============================================================================
// Database clients
// =============================================================================
// Two of them, and which one a handler uses is a security decision, not a
// convenience one.
//
//   asCaller(req)  — the parent's or trainer's own token. RLS applies, and the
//                    assert_* guards inside the SECURITY DEFINER functions see
//                    a real auth.uid(). This is the default for anything a
//                    browser triggers.
//
//   asService()    — the service role. Bypasses RLS entirely. Only for the
//                    Stripe webhook and the scheduled jobs, which have no user
//                    and must act with authority.
//
// The service key is read from the environment inside the function, is never
// returned in a response, and never reaches the client bundle.
// =============================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function asCaller(req: Request): SupabaseClient {
  const authorization = req.headers.get("Authorization") ?? "";

  return createClient(required("SUPABASE_URL"), required("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
}

export function asService(): SupabaseClient {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

export function anonymous(): SupabaseClient {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false },
  });
}
