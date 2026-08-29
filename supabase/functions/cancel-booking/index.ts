// =============================================================================
// POST /cancel-booking
// =============================================================================
// The database decides whether a refund is due; Stripe performs it; the
// database records it. Three steps, in that order, because only the first one
// knows the policy and only the second one can move money.
//
// If Stripe fails after cancel_booking() has committed, the booking is
// cancelled and the refund is not made. That is the safe direction: the family
// has their spot back and the money is recoverable by hand. The opposite —
// refunding and failing to cancel — is not recoverable, because a refunded
// family would still be holding a place.
// =============================================================================

import { asCaller, asService } from "../_shared/db.ts";
import { json, preflight, fromDatabaseError } from "../_shared/http.ts";
import { createRefund } from "../_shared/stripe.ts";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  const options = preflight(req);
  if (options) return options;

  if (req.method !== "POST") return json({ error: "Use POST" }, 405, origin);

  let body: { booking_id?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected JSON" }, 400, origin);
  }

  if (!body.booking_id) return json({ error: "booking_id is required" }, 400, origin);

  const caller = asCaller(req);

  // Read the booking through the caller's own token: RLS returns nothing if it
  // is not theirs, and cancel_booking() checks again anyway.
  const { data: booking, error: readError } = await caller
    .from("bookings")
    .select("id, payment_id, price_cents, status")
    .eq("id", body.booking_id)
    .single();

  if (readError) return fromDatabaseError(readError, origin);

  const { data: outcome, error } = await caller.rpc("cancel_booking", {
    p_booking_id: body.booking_id,
    p_by_staff: false,
    p_reason: body.reason ?? "",
  });

  if (error) return fromDatabaseError(error, origin);

  if (!outcome.refund_due || !booking.payment_id || booking.price_cents === 0) {
    return json({ ...outcome, refunded: false }, 200, origin);
  }

  const service = asService();

  const { data: payment } = await service
    .from("payments")
    .select("id, stripe_payment_intent_id, amount_cents, refunded_cents")
    .eq("id", booking.payment_id)
    .single();

  if (!payment?.stripe_payment_intent_id) {
    return json({ ...outcome, refunded: false, note: "No card payment to refund" }, 200, origin);
  }

  try {
    const refund = await createRefund({
      paymentIntentId: payment.stripe_payment_intent_id,
      amountCents: booking.price_cents,
      reason: body.reason ?? "cancellation",
      // Derived from the booking, so a retried cancel cannot refund twice even
      // if it somehow gets past the "already cancelled" check.
      idempotencyKey: `ptp_refund_${booking.id}`,
    });

    const { error: recordError } = await service.rpc("record_refund", {
      p_payment_id: payment.id,
      p_amount_cents: refund.amount,
      p_stripe_refund_id: refund.id,
      p_reason: body.reason ?? "cancellation",
      p_booking_id: booking.id,
    });

    if (recordError) throw recordError;

    return json({ ...outcome, refunded: true, amount_cents: refund.amount }, 200, origin);
  } catch (stripeError) {
    console.error("refund failed after cancellation", body.booking_id, stripeError);

    // The place is already released. Say so plainly rather than implying the
    // whole thing failed, and put it in front of a person.
    await service.rpc("escalate", {
      p_source: "payment",
      p_summary: "Booking cancelled but the refund did not go through",
      p_severity: "urgent",
      p_subject_table: "bookings",
      p_subject_id: body.booking_id,
      p_detail: { error: String((stripeError as { message?: string })?.message ?? stripeError) },
    });

    return json(
      { ...outcome, refunded: false, note: "Cancelled. The refund needs a moment — we are on it." },
      200,
      origin,
    );
  }
});
