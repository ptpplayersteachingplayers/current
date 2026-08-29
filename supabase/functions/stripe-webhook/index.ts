// =============================================================================
// POST /stripe-webhook
// =============================================================================
// The only thing in the system that turns a payment into a place.
//
// Order matters and is not negotiable:
//
//   1. Read the RAW body. Parsing first and re-serialising breaks the
//      signature, because the bytes Stripe signed are not the bytes
//      JSON.stringify produces.
//   2. Verify the signature. Nothing before this point may touch the database.
//   3. Claim the event id. If another delivery already claimed it, return 200
//      and stop — Stripe has done its job and we have done ours.
//   4. Act, inside a database function that is itself idempotent.
//
// Steps 3 and 4 are both idempotent on purpose. Step 3 stops the work being
// repeated; step 4 means it is harmless if it somehow is.
//
// On failure the event is released rather than swallowed, so Stripe's own
// retry schedule gets another go at it. After the limit it stays failed and a
// person gets the payload — a payment that quietly never became a booking is
// the worst outcome available here.
// =============================================================================

import { asService } from "../_shared/db.ts";
import { verifyStripeSignature } from "../_shared/signature.ts";

// Stripe does not read a response body, and an error message here would only
// ever be read by someone probing the endpoint.
const ok = (payload: Record<string, unknown> = { received: true }) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Use POST", { status: 405 });

  const rawBody = await req.text();

  const verified = await verifyStripeSignature(
    rawBody,
    req.headers.get("stripe-signature"),
    Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "",
  );

  if (!verified.ok) {
    console.warn("rejected webhook", verified.reason);
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(rawBody);
  const service = asService();

  const { data: claimed, error: claimError } = await service.rpc("claim_webhook_event", {
    p_source: "stripe",
    p_external_id: event.id,
    p_event_type: event.type,
    p_payload: event,
  });

  if (claimError) {
    // Could not even record it. Ask for a retry — losing a payment event is
    // far worse than processing one twice.
    console.error("could not claim webhook event", claimError);
    return new Response("Try again", { status: 500 });
  }

  if (!claimed) return ok({ received: true, duplicate: true });

  try {
    const result = await handle(service, event);
    await service.rpc("complete_webhook_event", {
      p_source: "stripe",
      p_external_id: event.id,
      p_result: result,
    });
    return ok();
  } catch (error) {
    const message = String((error as { message?: string })?.message ?? error);
    console.error("webhook handling failed", event.type, message);

    const { data: retry } = await service.rpc("release_webhook_event", {
      p_source: "stripe",
      p_external_id: event.id,
      p_error: message,
    });

    // 500 asks Stripe to deliver it again; 200 accepts it and leaves the
    // escalation release_webhook_event raised for a person to work through.
    return retry ? new Response("Try again", { status: 500 }) : ok({ received: true, failed: true });
  }
});

async function handle(service: ReturnType<typeof asService>, event: Record<string, any>) {
  switch (event.type) {
    case "payment_intent.succeeded": {
      const intent = event.data.object;

      const { data, error } = await service.rpc("settle_checkout", {
        p_stripe_payment_intent_id: intent.id,
        p_amount_cents: intent.amount_received ?? intent.amount,
        p_charge_id: intent.latest_charge ?? null,
      });

      if (error) throw error;
      return data;
    }

    case "payment_intent.payment_failed":
      // Nothing to undo: no booking was ever created. The hold lapses on its
      // own in fifteen minutes, which is also how the parent gets to retry.
      return { ignored: "payment_failed" };

    case "charge.refunded": {
      // Refunds we issued are already recorded by the cancel endpoint. One
      // issued from the Stripe dashboard is not, and someone should know the
      // two systems have diverged.
      const charge = event.data.object;

      const { error } = await service.rpc("escalate", {
        p_source: "payment",
        p_summary: "A refund was issued in Stripe; check it matches a cancellation here",
        p_severity: "normal",
        p_subject_table: "payments",
        p_subject_id: null,
        p_detail: { charge_id: charge.id, amount_refunded: charge.amount_refunded },
      });

      if (error) throw error;
      return { escalated: true };
    }

    default:
      return { ignored: event.type };
  }
}
