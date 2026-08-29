// =============================================================================
// POST /camp-checkout
// =============================================================================
// The camp equivalent of /checkout, and deliberately the same shape: the
// client says which camp, which child and which day option, and the server
// decides what that costs.
//
// The paperwork is checked in the database before Stripe is touched, so a
// family is never charged for a place that then cannot be confirmed for want
// of an emergency contact.
// =============================================================================

import { asCaller, asService } from "../_shared/db.ts";
import { json, preflight, fromDatabaseError } from "../_shared/http.ts";
import { createPaymentIntent } from "../_shared/stripe.ts";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  const options = preflight(req);
  if (options) return options;

  if (req.method !== "POST") return json({ error: "Use POST" }, 405, origin);

  let body: {
    camp_id?: string;
    player_id?: string;
    day_option?: string;
    addon_ids?: string[];
    details?: Record<string, string>;
    idempotency_key?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected JSON" }, 400, origin);
  }

  if (!body.camp_id || !body.player_id) {
    return json({ error: "camp_id and player_id are required" }, 400, origin);
  }
  if (!["full_day", "half_day"].includes(body.day_option ?? "")) {
    return json({ error: "day_option must be full_day or half_day" }, 400, origin);
  }
  if (!body.idempotency_key) {
    return json({ error: "idempotency_key is required" }, 400, origin);
  }

  // As the caller, so the household guard inside the function sees who this is.
  const { data: intent, error } = await asCaller(req)
    .rpc("begin_camp_registration", {
      p_camp_id: body.camp_id,
      p_player_id: body.player_id,
      p_day_option: body.day_option,
      p_idempotency_key: body.idempotency_key,
      p_addon_ids: body.addon_ids ?? [],
      p_details: body.details ?? {},
    })
    .single();

  if (error) return fromDatabaseError(error, origin);

  if (intent.state === "settled") {
    return json({ status: "already_paid", intent_id: intent.id }, 200, origin);
  }

  const service = asService();

  let paymentIntent;
  try {
    paymentIntent = await createPaymentIntent({
      amountCents: intent.amount_cents,
      currency: intent.currency,
      idempotencyKey: `ptp_camp_${intent.id}`,
      description: "PTP camp registration",
      metadata: {
        checkout_intent_id: intent.id,
        household_id: intent.household_id,
        player_id: intent.player_id,
        camp_id: body.camp_id,
        kind: "camp",
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
