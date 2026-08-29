// =============================================================================
// POST /waitlist
// =============================================================================
// Three actions on one endpoint because they are one decision to a parent:
// join the queue, take the place we offered, or say no thanks.
//
// Accepting returns a checkout, not a place. The waitlist row only converts
// when the payment settles — otherwise an accepted-but-unpaid invitation would
// hold a spot indefinitely while the family behind them waits.
// =============================================================================

import { asCaller } from "../_shared/db.ts";
import { json, preflight, fromDatabaseError } from "../_shared/http.ts";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  const options = preflight(req);
  if (options) return options;

  if (req.method !== "POST") return json({ error: "Use POST" }, 405, origin);

  let body: {
    action?: "join" | "accept" | "decline";
    group_id?: string;
    player_id?: string;
    waitlist_id?: string;
    idempotency_key?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected JSON" }, 400, origin);
  }

  const db = asCaller(req);

  switch (body.action) {
    case "join": {
      if (!body.group_id || !body.player_id) {
        return json({ error: "group_id and player_id are required" }, 400, origin);
      }

      const { data, error } = await db
        .rpc("join_waitlist", { p_group_id: body.group_id, p_player_id: body.player_id })
        .single();

      if (error) return fromDatabaseError(error, origin);
      return json({ waitlist: data }, 200, origin);
    }

    case "accept": {
      if (!body.waitlist_id) return json({ error: "waitlist_id is required" }, 400, origin);
      if (!body.idempotency_key) return json({ error: "idempotency_key is required" }, 400, origin);

      const { data, error } = await db
        .rpc("accept_waitlist_invite", {
          p_waitlist_id: body.waitlist_id,
          p_idempotency_key: body.idempotency_key,
        })
        .single();

      if (error) return fromDatabaseError(error, origin);

      // Deliberately not a payment intent: the client sends this id straight
      // on to /checkout, so there is one place that talks to Stripe.
      return json({ checkout_intent: data, next: "checkout" }, 200, origin);
    }

    case "decline": {
      if (!body.waitlist_id) return json({ error: "waitlist_id is required" }, 400, origin);

      const { error } = await db.rpc("decline_waitlist_invite", { p_waitlist_id: body.waitlist_id });

      if (error) return fromDatabaseError(error, origin);
      return json({ declined: true }, 200, origin);
    }

    default:
      return json({ error: "action must be join, accept or decline" }, 400, origin);
  }
});
