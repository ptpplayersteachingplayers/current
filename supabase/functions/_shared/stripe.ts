// =============================================================================
// Stripe, over fetch
// =============================================================================
// The three calls this platform makes, written directly against the REST API
// rather than pulling in the SDK: it is less code than the shim needed to make
// the SDK behave in Deno, and every request is visible.
//
// Every write carries an idempotency key. Stripe then guarantees that a retry
// after a timeout returns the original charge instead of making a second one —
// which matters most in the case where we never saw the first response.
// =============================================================================

const API = "https://api.stripe.com/v1";

function secret(): string {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return key;
}

async function post(path: string, form: Record<string, string>, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret()}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(form).toString(),
  });

  const body = await response.json();

  if (!response.ok) {
    // Surface Stripe's own message; it is written for humans and is usually
    // the most useful thing we could say.
    throw new Error(body?.error?.message ?? `Stripe returned ${response.status}`);
  }

  return body;
}

export interface PaymentIntent {
  id: string;
  client_secret: string;
  amount: number;
  status: string;
}

export async function createPaymentIntent(args: {
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
  description: string;
}): Promise<PaymentIntent> {
  const form: Record<string, string> = {
    amount: String(args.amountCents),
    currency: args.currency,
    description: args.description,
    "automatic_payment_methods[enabled]": "true",
  };

  for (const [key, value] of Object.entries(args.metadata)) {
    form[`metadata[${key}]`] = value;
  }

  return await post("/payment_intents", form, args.idempotencyKey);
}

export async function createRefund(args: {
  paymentIntentId: string;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
}): Promise<{ id: string; amount: number; status: string }> {
  return await post(
    "/refunds",
    {
      payment_intent: args.paymentIntentId,
      amount: String(args.amountCents),
      "metadata[reason]": args.reason,
    },
    args.idempotencyKey,
  );
}
