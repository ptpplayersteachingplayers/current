// =============================================================================
// Request and response helpers
// =============================================================================

const ALLOWED_ORIGINS = (Deno.env.get("PTP_ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export function corsHeaders(origin: string | null): Record<string, string> {
  // An explicit allow-list, not "*". These endpoints move money and read
  // family data; any site being able to call them with a stolen token is not
  // a trade worth making for convenience in development.
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? "";

  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, content-type, x-idempotency-key",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(body: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export function preflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

// Postgres error codes the database raises deliberately, mapped to statuses a
// client can act on. Everything else is a 500 with no detail: an unexpected
// database message is not something to show a parent.
const STATUS_BY_CODE: Record<string, number> = {
  "23505": 409, // unique_violation
  "23514": 409, // check_violation — "that group is full", "already cancelled"
  "23P01": 409, // exclusion_violation — a trainer double-booking
  "P0002": 404, // no_data_found
  "42501": 403, // insufficient_privilege — the household guards
};

interface PostgrestError {
  code?: string;
  message?: string;
}

export function fromDatabaseError(error: PostgrestError, origin: string | null): Response {
  const status = STATUS_BY_CODE[error.code ?? ""] ?? 500;

  if (status === 500) {
    console.error("unexpected database error", error);
    return json({ error: "Something went wrong. Nothing was charged." }, 500, origin);
  }

  return json({ error: error.message ?? "Request refused" }, status, origin);
}
