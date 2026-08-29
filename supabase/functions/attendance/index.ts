// =============================================================================
// POST /attendance
// =============================================================================
// The trainer's phone, on a field, probably on one bar of signal. So: a whole
// roster in one request, and an upsert underneath, because the tap that gets
// retried must not become a second row.
//
// Attendance does not affect pay. Once a group is confirmed the trainer is
// paid for the scheduled hours whoever turns up — that is the rule from 0006
// and nothing in this endpoint may quietly undo it.
// =============================================================================

import { asCaller } from "../_shared/db.ts";
import { json, preflight, fromDatabaseError } from "../_shared/http.ts";

const STATES = new Set(["present", "late", "absent", "excused", "canceled", "makeup"]);

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  const options = preflight(req);
  if (options) return options;

  if (req.method !== "POST") return json({ error: "Use POST" }, 405, origin);

  let body: {
    session_id?: string;
    entries?: Array<{ player_id: string; state: string; note?: string }>;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected JSON" }, 400, origin);
  }

  if (!body.session_id) return json({ error: "session_id is required" }, 400, origin);
  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    return json({ error: "entries is required" }, 400, origin);
  }

  for (const entry of body.entries) {
    if (!entry.player_id || !STATES.has(entry.state)) {
      return json({ error: `Unknown attendance state for ${entry.player_id}` }, 400, origin);
    }
  }

  const db = asCaller(req);
  const recorded: unknown[] = [];

  for (const entry of body.entries) {
    const { data, error } = await db
      .rpc("record_attendance", {
        p_session_id: body.session_id,
        p_player_id: entry.player_id,
        p_state: entry.state,
        p_note: entry.note ?? "",
      })
      .single();

    // The first refusal ends it: the trainer is not the one running this
    // session, and the rest of the roster will fail the same way.
    if (error) return fromDatabaseError(error, origin);

    recorded.push(data);
  }

  return json({ recorded }, 200, origin);
});
