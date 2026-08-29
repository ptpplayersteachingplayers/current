// =============================================================================
// Stripe webhook signature verification
// =============================================================================
// Deliberately dependency-free and free of any Deno global, so it can be run
// under plain Node in a test. This is the one piece of the whole edge layer
// where a mistake means anyone on the internet can confirm bookings, so it is
// the one piece that gets executed by a test rather than reasoned about.
//
// Stripe sends:  Stripe-Signature: t=1699999999,v1=<hex hmac>,v1=<another>
// The signed payload is `${t}.${rawBody}`, HMAC-SHA256 with the endpoint
// secret. Multiple v1 values appear during a secret rotation; any match is a
// pass.
// =============================================================================

export interface SignatureResult {
  ok: boolean;
  reason?: string;
}

export function parseSignatureHeader(header: string): { timestamp: number | null; signatures: string[] } {
  const signatures: string[] = [];
  let timestamp: number | null = null;

  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index === -1) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (key === "t") {
      const parsed = Number.parseInt(value, 10);
      timestamp = Number.isFinite(parsed) ? parsed : null;
    } else if (key === "v1") {
      signatures.push(value);
    }
  }

  return { timestamp, signatures };
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Length-independent equality. Comparing hex strings with === leaks where they
// first differ through timing; over a network that is largely theoretical, but
// the correct version is three lines.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  toleranceSeconds = 300,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<SignatureResult> {
  if (!header) return { ok: false, reason: "missing_signature_header" };
  if (!secret) return { ok: false, reason: "missing_endpoint_secret" };

  const { timestamp, signatures } = parseSignatureHeader(header);
  if (timestamp === null) return { ok: false, reason: "malformed_signature_header" };
  if (signatures.length === 0) return { ok: false, reason: "no_v1_signature" };

  // A valid signature on a five-hour-old body is a replay. Stripe's own
  // retries all carry a fresh timestamp.
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return { ok: false, reason: "timestamp_outside_tolerance" };
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const expected = toHex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`)),
  );

  for (const candidate of signatures) {
    if (constantTimeEqual(expected, candidate.toLowerCase())) return { ok: true };
  }

  return { ok: false, reason: "no_matching_signature" };
}
