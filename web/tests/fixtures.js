// =============================================================================
// The demo season, as the portals receive it
// =============================================================================
// Times are anchored to today at a fixed local hour rather than to a hardcoded
// date, because the trainer portal opens on today and a fixture pinned to a
// date in September silently tests an empty screen every other day of the year.
// =============================================================================

const ZONE = "America/New_York";

// How far the zone is from UTC at a given instant, in minutes. Needed because
// "today at 5pm in Norristown" is a different UTC instant in July and January,
// and a fixture that assumes one of them breaks twice a year.
function zoneOffsetMinutes(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  const p = {};
  for (const part of formatter.formatToParts(date)) p[part.type] = part.value;

  const asUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    p.hour === "24" ? 0 : Number(p.hour), Number(p.minute), Number(p.second),
  );

  return (asUtc - date.getTime()) / 60_000;
}

const pad = (n) => String(n).padStart(2, "0");

// The instant at which the clock in Norristown reads `hour:minute`, on the day
// `dayOffset` days from now.
export function atLocal(dayOffset, hour, minute = 0) {
  const day = new Date(Date.now() + dayOffset * 86_400_000);

  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(day);

  const guess = new Date(`${ymd}T${pad(hour)}:${pad(minute)}:00Z`);
  return new Date(guess.getTime() - zoneOffsetMinutes(guess, ZONE) * 60_000).toISOString();
}

const settings = [
  { key: "display_timezone", value: "America/New_York" },
  { key: "free_cancel_hours", value: 24 },
];

export const parentFixtures = {
  session: { user: { id: "u1", email: "simi.demo@example.test" }, access_token: "t" },
  tables: {
    system_settings: settings,
    players: [
      { id: "p1", first_name: "Tayo", last_name: "Adeyemi", birth_date: "2018-01-04", skill_level: 2, household_id: "h7" },
    ],
    bookings: [
      // Deliberately out of order, and the further one first: the portal must
      // sort rather than take the first row.
      booking("b1", "confirmed", atLocal(3, 17, 30), "s1"),
      booking("b2", "confirmed", atLocal(1, 17, 30), "s2"),
      { ...booking("b3", "attended", atLocal(-3, 17, 30), "s0"), credit_id: "c3" },
    ],
    package_credits: [
      { id: "c1", state: "reserved", expires_on: "2099-10-25", origin: "purchase" },
      { id: "c4", state: "available", expires_on: "2099-10-25", origin: "purchase" },
      { id: "c5", state: "available", expires_on: "2099-10-25", origin: "purchase" },
      { id: "c3", state: "consumed", expires_on: "2099-10-25", origin: "purchase" },
    ],
    payments: [
      {
        id: "pay1", amount_cents: 56000, refunded_cents: 0, status: "succeeded",
        description: "group_package", created_at: atLocal(-3, 9), succeeded_at: atLocal(-3, 9),
      },
    ],
    waitlists: [
      {
        id: "w1", state: "invited", position: 1,
        invited_at: atLocal(0, 8), invite_expires_at: atLocal(1, 8),
        group_id: "g2", player_id: "p1",
        training_groups: { name: "Tue/Thu U12 Advanced" },
      },
    ],
  },
};

function booking(id, status, startsAt, sessionId) {
  return {
    id, status, price_cents: 0, credit_id: `c-${id}`, payment_id: null,
    created_at: atLocal(-5, 9), player_id: "p1",
    players: { first_name: "Tayo", last_name: "Adeyemi" },
    sessions: {
      id: sessionId,
      starts_at: startsAt,
      ends_at: new Date(new Date(startsAt).getTime() + 3_600_000).toISOString(),
      kind: "group", status: status === "attended" ? "completed" : "scheduled", group_id: "g1",
      training_groups: { name: "Mon/Wed U9 Foundation" },
      locations: { name: "Northside Turf", address_line: "1 Turf Way", city: "Norristown" },
    },
  };
}

export const trainerFixtures = {
  session: { user: { id: "u2", email: "dani@example.test" }, access_token: "t" },
  tables: {
    system_settings: settings,
    sessions: [
      {
        id: "s1", kind: "group", status: "scheduled",
        starts_at: atLocal(0, 16), ends_at: atLocal(0, 17),
        paid_count: 5, location_id: "l1", group_id: "g1",
        training_groups: { name: "Mon/Wed U9 Foundation" },
        locations: { name: "Northside Turf", meeting_instructions: "Gate 2, by the scoreboard" },
      },
      // An hour after the first ends, at the same field: a gap the trainer is
      // paid through, and the portal must say so.
      {
        id: "s2", kind: "group", status: "scheduled",
        starts_at: atLocal(0, 18), ends_at: atLocal(0, 19),
        paid_count: 6, location_id: "l1", group_id: "g2",
        training_groups: { name: "Tue/Thu U12 Advanced" },
        locations: { name: "Northside Turf" },
      },
    ],
    trainer_shifts: [
      {
        id: "sh1", starts_at: atLocal(0, 16), ends_at: atLocal(0, 19),
        status: "confirmed", hourly_pay_cents: 4000, anchor_session_id: null, acknowledged_at: null,
      },
    ],
    trainer_hours: [
      { id: "th1", shift_id: "sh0", hours: 2, amount_cents: 8000, worked_on: "2026-08-27", paid_out_at: null },
    ],
    bookings: [
      { id: "b1", session_id: "s1", player_id: "p2", status: "confirmed", players: { first_name: "Zara", last_name: "Okafor" } },
      { id: "b2", session_id: "s1", player_id: "p1", status: "confirmed", players: { first_name: "Ada", last_name: "Hartley" } },
      // Cancelled, so never on the register.
      { id: "b3", session_id: "s1", player_id: "p3", status: "canceled", players: { first_name: "Leo", last_name: "Martelli" } },
      // A different session's booking, so the roster query is proved to filter.
      { id: "b4", session_id: "s2", player_id: "p4", status: "confirmed", players: { first_name: "Bao", last_name: "Nguyen" } },
    ],
    attendance: [{ session_id: "s1", player_id: "p1", state: "present", note: "" }],
  },
};
