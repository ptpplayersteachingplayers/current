// =============================================================================
// GET /catalog
// =============================================================================
// What a parent sees before they have an account: the open season, its groups,
// how full each one is, and when it meets.
//
// Read with the anon key, so the public-catalogue RLS policies decide what is
// visible. Draft groups and unverified fields are absent because the policy
// says so, not because this function remembered to filter them out.
// =============================================================================

import { anonymous } from "../_shared/db.ts";
import { json, preflight } from "../_shared/http.ts";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  const options = preflight(req);
  if (options) return options;

  const url = new URL(req.url);
  const playerId = url.searchParams.get("player_id");

  const db = anonymous();

  const { data: seasons, error: seasonError } = await db
    .from("seasons")
    .select("id, name, starts_on, ends_on, weeks, credits_expire_on")
    .order("starts_on");

  // The package price comes from here rather than being written into the
  // booking page. A page that hardcodes a price will one day quote a number
  // the checkout then refuses to charge.
  const { data: settingRows } = await db
    .from("system_settings")
    .select("key, value")
    .in("key", ["group_package_price_cents", "group_package_sessions"]);

  const settings = Object.fromEntries((settingRows ?? []).map((row) => [row.key, Number(row.value)]));

  if (seasonError) {
    console.error("catalog seasons", seasonError);
    return json({ error: "Could not load the catalogue" }, 500, origin);
  }

  const { data: groups, error: groupError } = await db
    .from("training_groups")
    .select(
      "id, season_id, name, slug, status, min_age, max_age, min_skill, max_skill, " +
        "min_players, target_players, max_players, dropin_price_cents, " +
        "locations(name, city), trainers(display_name, slug), " +
        "group_meeting_times(weekday, starts_at, ends_at)",
    )
    .order("name");

  if (groupError) {
    console.error("catalog groups", groupError);
    return json({ error: "Could not load the catalogue" }, 500, origin);
  }

  // Occupancy one group at a time: it is a function, not a column, because it
  // counts live holds as well as paid places.
  const occupancy = await Promise.all(
    (groups ?? []).map(async (group) => {
      const { data } = await db.rpc("group_occupancy", { p_group_id: group.id }).single();
      return [group.id, data] as const;
    }),
  );
  const byGroup = new Map(occupancy);

  // If they told us which child, say plainly which groups that child can join.
  // Better than letting a family fill in a form and be refused at the end.
  let eligibility = new Map<string, boolean>();
  if (playerId) {
    const checks = await Promise.all(
      (groups ?? []).map(async (group) => {
        const { data } = await db.rpc("player_is_eligible", {
          p_player_id: playerId,
          p_group_id: group.id,
        });
        return [group.id, data === true] as const;
      }),
    );
    eligibility = new Map(checks);
  }

  return json(
    {
      seasons,
      package: {
        price_cents: settings.group_package_price_cents ?? null,
        sessions: settings.group_package_sessions ?? null,
      },
      groups: (groups ?? []).map((group) => {
        const counts = byGroup.get(group.id) as
          | { paid: number; held: number; total: number; capacity: number }
          | undefined;

        return {
          ...group,
          occupancy: counts ?? null,
          spots_left: counts ? Math.max(0, counts.capacity - counts.total) : null,
          // What the parent actually needs to know, in the words we use with
          // them rather than the enum name.
          headline:
            group.status === "full"
              ? "Full — join the waitlist"
              : group.status === "confirmed"
              ? "Running"
              : `Needs ${Math.max(0, group.min_players - (counts?.paid ?? 0))} more to start`,
          eligible: playerId ? eligibility.get(group.id) ?? false : null,
        };
      }),
    },
    200,
    origin,
  );
});
