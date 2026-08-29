// =============================================================================
// POST /book-with-credit
// =============================================================================
// No money moves, so there is no Stripe here and no webhook to wait for. The
// database picks the credit that expires soonest, reserves it under a lock and
// spends it in the same transaction that creates the booking.
// =============================================================================

import { asCaller } from "../_shared/db.ts";
import { json, preflight, fromDatabaseError } from "../_shared/http.ts";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  const options = preflight(req);
  if (options) return options;

  if (req.method !== "POST") return json({ error: "Use POST" }, 405, origin);

  let body: { session_id?: string; player_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected JSON" }, 400, origin);
  }

  if (!body.session_id || !body.player_id) {
    return json({ error: "session_id and player_id are required" }, 400, origin);
  }

  const { data, error } = await asCaller(req)
    .rpc("book_with_credit", { p_session_id: body.session_id, p_player_id: body.player_id })
    .single();

  if (error) return fromDatabaseError(error, origin);

  return json({ booking: data }, 200, origin);
});
