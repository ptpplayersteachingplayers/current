// =============================================================================
// POST /email-inbound
// =============================================================================
// Inbound email, from the transactional provider's parsing webhook. Same shape
// as the SMS path — record first, think second — and the same identity
// matching, so a family who writes in joins the thread they already have
// rather than starting a second one.
// =============================================================================

import { asService } from "../../../../functions/_shared/db.ts";
import { verifyStripeSignature } from "../../../../functions/_shared/signature.ts";

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
    req.headers.get("x-mail-signature"),
    Deno.env.get("EMAIL_WEBHOOK_SECRET") ?? "",
  );

  if (!verified.ok) return new Response("Invalid signature", { status: 400 });

  const event = JSON.parse(rawBody);
  const db = asService();

  const { data: claimed } = await db.rpc("claim_webhook_event", {
    p_source: "email",
    p_external_id: event.message_id ?? event.id,
    p_event_type: "email.received",
    p_payload: event,
  });

  if (!claimed) return ok({ received: true, duplicate: true });

  try {
    const { data: recorded, error } = await db.rpc("record_inbound_message", {
      p_channel: "email",
      p_from_phone: null,
      p_from_email: event.from_email ?? event.from,
      // The plain-text part. HTML mail becomes a wall of markup that tells the
      // model nothing and costs a great deal to read.
      p_body: (event.text ?? event.body_plain ?? "").slice(0, 8000),
      p_external_id: event.message_id ?? event.id,
      p_subject: event.subject ?? null,
      p_display_name: event.from_name ?? "",
    });

    if (error) throw error;

    await db.rpc("complete_webhook_event", {
      p_source: "email", p_external_id: event.message_id ?? event.id, p_result: recorded,
    });

    if (recorded.duplicate || recorded.opted_out) return ok(recorded);

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

    const { data: retry } = await db.rpc("release_webhook_event", {
      p_source: "email", p_external_id: event.message_id ?? event.id, p_error: message,
    });

    return retry ? new Response("Try again", { status: 500 }) : ok({ failed: true });
  }
});
