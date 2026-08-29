// =============================================================================
// POST /jobs?tier=five_minute
// =============================================================================
// Called by pg_cron or an external scheduler. It knows nothing about what a
// tier contains — jobs_for_tier() in the database decides that, so the
// schedule can change without a deploy.
//
// Authenticated by a shared secret rather than a user token, because there is
// no user: this is a machine waking another machine.
// =============================================================================

import { asService } from "../_shared/db.ts";
import { json } from "../_shared/http.ts";

const TIERS = new Set(["five_minute", "hourly", "daily", "weekly"]);

// Both strings are ours, but comparing secrets with === leaks their prefix
// through timing, and the correct version is four lines.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  const expected = Deno.env.get("PTP_JOB_SECRET") ?? "";
  const provided = req.headers.get("x-ptp-job-secret") ?? "";

  if (!expected || !constantTimeEqual(expected, provided)) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(req.url);
  const tier = url.searchParams.get("tier") ?? "";
  const job = url.searchParams.get("job");

  const service = asService();

  // A single job by name, for running one thing by hand during an incident.
  if (job) {
    const { data, error } = await service.rpc("run_scheduled_job", {
      p_job_key: job,
      p_tier: "manual",
    });

    if (error) {
      console.error("job failed", job, error);
      return json({ error: error.message }, 500);
    }

    return json(data);
  }

  if (!TIERS.has(tier)) return json({ error: "Unknown tier" }, 400);

  const { data, error } = await service.rpc("run_tier", { p_tier: tier });

  if (error) {
    // run_tier records and escalates each failure itself; this is the case
    // where the call never got that far.
    console.error("tier failed", tier, error);
    return json({ error: error.message }, 500);
  }

  return json(data);
});
