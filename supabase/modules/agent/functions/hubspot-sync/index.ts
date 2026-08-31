// =============================================================================
// POST /hubspot-sync
// =============================================================================
// One direction, on purpose. Supabase is authoritative for bookings, capacity,
// packages, credits, schedules and messages; HubSpot holds the CRM view of the
// family and drives marketing. This pushes the second from the first.
//
// It does not pull. A HubSpot property is edited by a salesperson in a hurry;
// letting that overwrite a booking count would put marketing data in charge of
// what a family has paid for. Where HubSpot needs to originate something — a
// new lead from a form — it comes in through the ordinary contact path, is
// matched on a normalised identifier, and is subject to the same duplicate
// protection as anything else.
// =============================================================================

import { asService } from "../../../../functions/_shared/db.ts";
import { json } from "../../../../functions/_shared/http.ts";

const HUBSPOT = "https://api.hubapi.com";

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get("PTP_JOB_SECRET") ?? "";
  if (!secret || req.headers.get("x-ptp-job-secret") !== secret) {
    return new Response("Not found", { status: 404 });
  }

  const token = Deno.env.get("HUBSPOT_ACCESS_TOKEN");
  if (!token) return json({ error: "HUBSPOT_ACCESS_TOKEN is not set" }, 500);

  const db = asService();
  const since = new URL(req.url).searchParams.get("since")
    ?? new Date(Date.now() - 26 * 3_600_000).toISOString();

  // The shape HubSpot needs, assembled in SQL so this function does no
  // business thinking of its own.
  const { data: rows, error } = await db.rpc("hubspot_sync_batch", { p_since: since });

  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    try {
      const properties = {
        email: row.email,
        phone: row.phone,
        firstname: row.first_name,
        lastname: row.last_name,
        ptp_household_id: row.household_id,
        ptp_players: row.players,
        ptp_player_ages: row.player_ages,
        ptp_teams: row.teams,
        ptp_preferred_locations: row.preferred_locations,
        ptp_camp_interest: row.camp_interest,
        ptp_training_interest: row.training_interest,
        ptp_last_session: row.last_session,
        ptp_last_camp: row.last_camp,
        ptp_lifetime_spend: row.lifetime_spend_cents ? row.lifetime_spend_cents / 100 : 0,
        ptp_credits_available: row.credits_available,
        ptp_booking_status: row.booking_status,
        ptp_lead_status: row.lead_status,
        ptp_sms_consent: row.sms_consent,
        ptp_email_consent: row.email_consent,
        ptp_last_contact: row.last_contact_at,
        ptp_next_followup: row.next_followup_at,
      };

      // Upsert by email, which is HubSpot's own identity. The id it returns is
      // stored so the next run addresses the record directly and cannot create
      // a second one.
      const path = row.hubspot_contact_id
        ? `/crm/v3/objects/contacts/${row.hubspot_contact_id}`
        : `/crm/v3/objects/contacts?idProperty=email`;

      const response = await fetch(`${HUBSPOT}${path}`, {
        method: row.hubspot_contact_id ? "PATCH" : "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ properties }),
      });

      if (response.status === 409 && !row.hubspot_contact_id) {
        // Already there under this email. Find it and record the id rather
        // than making another.
        const search = await fetch(`${HUBSPOT}/crm/v3/objects/contacts/search`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: row.email }] }],
            limit: 1,
          }),
        });

        const found = await search.json();
        const id = found?.results?.[0]?.id;

        if (id) {
          await db.from("contacts").update({ hubspot_contact_id: id }).eq("id", row.contact_id);
          sent++;
          continue;
        }
      }

      if (!response.ok) throw new Error(`HubSpot returned ${response.status}`);

      const body = await response.json();

      if (!row.hubspot_contact_id && body?.id) {
        await db.from("contacts").update({ hubspot_contact_id: body.id }).eq("id", row.contact_id);
      }

      sent++;
    } catch (error) {
      failed++;
      console.error("hubspot sync failed for contact", row.contact_id, error);
    }
  }

  // A partial failure is recorded rather than retried in a loop: the next run
  // picks up anything still stale, because the batch is chosen by what has
  // changed rather than by a queue.
  if (failed > 0) {
    await db.rpc("escalate", {
      p_source: "integration",
      p_summary: `${failed} contacts did not reach HubSpot`,
      p_severity: "low",
      p_subject_table: null,
      p_subject_id: null,
      p_detail: { sent, failed, since },
    });
  }

  return json({ sent, failed, since });
});
