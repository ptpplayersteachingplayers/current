// =============================================================================
// POST /quo-webhook
// =============================================================================
// Inbound SMS. The same three steps as the Stripe webhook, for the same
// reasons: verify, claim, then act.
//
// The message is recorded before the agent is asked to think about it. If the
// model is down, or slow, or wrong, the text is still in the thread and the
// conversation still shows the family waiting.
// =============================================================================

import { asService } from "../_shared/db.ts";
import { verifyStripeSignature } from "../_shared/signature.ts";

const ok = (payload: Record<string, unknown> = { received: true }) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Use POST", { status: 405 });

  const rawBody = await req.text();

  // Quo signs with the same scheme Stripe uses — an HMAC over
  // `${timestamp}.${body}` — so the verified implementation is reused rather
  // than written a second time.
  const verified = await verifyStripeSignature(
    rawBody,
    req.headers.get("quo-signature") ?? req.headers.get("x-quo-signature"),
    Deno.env.get("QUO_WEBHOOK_SECRET") ?? "",
  );

  if (!verified.ok) {
    console.warn("rejected quo webhook", verified.reason);
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(rawBody);
  const db = asService();

  const { data: claimed } = await db.rpc("claim_webhook_event", {
    p_source: "quo",
    p_external_id: event.id,
    p_event_type: event.type ?? "message.received",
    p_payload: event,
  });

  if (!claimed) return ok({ received: true, duplicate: true });

  try {
    if ((event.type ?? "message.received") !== "message.received") {
      await db.rpc("complete_webhook_event", {
        p_source: "quo", p_external_id: event.id, p_result: { ignored: event.type },
      });
      return ok();
    }

    const message = event.data ?? event;

    const { data: recorded, error } = await db.rpc("record_inbound_message", {
      p_channel: "sms",
      p_from_phone: message.from,
      p_from_email: null,
      p_body: message.body ?? message.text ?? "",
      p_external_id: message.id,
      p_subject: null,
      p_display_name: message.contact_name ?? "",
    });

    if (error) throw error;

    await db.rpc("complete_webhook_event", {
      p_source: "quo", p_external_id: event.id, p_result: recorded,
    });

    // Somebody who has just texted STOP is not asked anything else.
    if (recorded.duplicate || recorded.opted_out) return ok(recorded);

    // Thinking happens in its own function, and its failure is not this
    // function's failure: the message is saved either way.
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/agent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ptp-job-secret": Deno.env.get("PTP_JOB_SECRET") ?? "",
      },
      body: JSON.stringify({ conversation_id: recorded.conversation_id }),
    }).catch((error) => console.error("agent dispatch failed", error));

    return ok(recorded);
  } catch (error) {
    const message = String((error as { message?: string })?.message ?? error);
    console.error("quo webhook failed", message);

    const { data: retry } = await db.rpc("release_webhook_event", {
      p_source: "quo", p_external_id: event.id, p_error: message,
    });

    return retry ? new Response("Try again", { status: 500 }) : ok({ failed: true });
  }
});
