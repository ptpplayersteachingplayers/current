// =============================================================================
// POST /checkout
// =============================================================================
// Turns "I want this" into a Stripe PaymentIntent.
//
// The client sends what it wants and its own idempotency key. It does not send
// a price, and there is no parameter here through which it could. The amount
// comes back from begin_checkout(), which read it from system_settings.
//
// Two idempotency layers, because they fail differently:
//
//   * begin_checkout() is unique on (household, key) — a second tap gets the
//     same intent row rather than a second hold.
//   * Stripe's Idempotency-Key is derived from that intent's id — a retry
//     after a network timeout returns the original PaymentIntent rather than
//     creating a second one we would never learn about.
// =============================================================================

import { asCaller, asService } from "../_shared/db.ts";
import { json, preflight, fromDatabaseError } from "../_shared/http.ts";
import { createPaymentIntent } from "../_shared/stripe.ts";

const KINDS = new Set(["group_package", "group_dropin", "private"]);

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  const options = preflight(req);
  if (options) return options;

  if (req.method !== "POST") return json({ error: "Use POST" }, 405, origin);

  let body: { kind?: string; player_id?: string; target_id?: string; idempotency_key?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected JSON" }, 400, origin);
  }

  const { kind, player_id, target_id, idempotency_key } = body;

  if (!kind || !KINDS.has(kind)) return json({ error: "Unknown kind" }, 400, origin);
  if (!player_id || !target_id) return json({ error: "player_id and target_id are required" }, 400, origin);
  if (!idempotency_key) return json({ error: "idempotency_key is required" }, 400, origin);

  // As the caller, so the household guard in begin_checkout() sees who this is.
  const { data: intent, error } = await asCaller(req)
    .rpc("begin_checkout", {
      p_kind: kind,
      p_player_id: player_id,
      p_target_id: target_id,
      p_idempotency_key: idempotency_key,
    })
    .single();

  if (error) return fromDatabaseError(error, origin);

  // Already paid for — a client that lost its response and retried. Say so
  // rather than opening a second PaymentIntent.
  if (intent.state === "settled") {
    return json({ status: "already_paid", intent_id: intent.id }, 200, origin);
  }

  const service = asService();

  let paymentIntent;
  try {
    paymentIntent = await createPaymentIntent({
      amountCents: intent.amount_cents,
      currency: intent.currency,
      idempotencyKey: `ptp_checkout_${intent.id}`,
      description: `PTP ${kind.replace("_", " ")}`,
      metadata: {
        checkout_intent_id: intent.id,
        household_id: intent.household_id,
        player_id: intent.player_id,
        kind: intent.kind,
      },
    });
  } catch (stripeError) {
    console.error("stripe payment intent failed", stripeError);

    // The hold stands until it expires on its own. Releasing it here would
    // race with a PaymentIntent that may in fact have been created.
    return json({ error: "Could not start payment. Please try again." }, 502, origin);
  }

  const { error: attachError } = await service.rpc("attach_payment_intent", {
    p_intent_id: intent.id,
    p_stripe_id: paymentIntent.id,
  });

  if (attachError) return fromDatabaseError(attachError, origin);

  // The client secret is what the browser needs to complete the payment. It is
  // scoped to this one PaymentIntent and is safe to hand over; the secret key
  // that created it is not and never leaves this function.
  return json(
    {
      intent_id: intent.id,
      amount_cents: intent.amount_cents,
      currency: intent.currency,
      expires_at: intent.expires_at,
      client_secret: paymentIntent.client_secret,
      publishable_key: Deno.env.get("STRIPE_PUBLISHABLE_KEY") ?? null,
    },
    200,
    origin,
  );
});
