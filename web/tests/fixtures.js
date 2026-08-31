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

// Plain hours from now, for the cases where what matters is which side of a
// deadline something falls on rather than which day it lands on. Rounded down
// to the half hour, because "5:30pm" reads like a training session and
// "5:28pm" reads like a bug.
export function inHours(offset) {
  const at = new Date(Date.now() + offset * 3_600_000);
  at.setMinutes(at.getMinutes() < 30 ? 0 : 30, 0, 0);
  return at.toISOString();
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
    // Offsets in hours rather than wall-clock days, so both sides of the
    // 24-hour cancellation line are always represented whatever time of day
    // the tests or the screenshots run. Deliberately out of order, and the
    // further one first: the portal must sort rather than take the first row.
    bookings: [
      booking("b1", "confirmed", inHours(40), "s1"),
      booking("b2", "confirmed", inHours(5), "s2"),
      { ...booking("b3", "attended", inHours(-72), "s0"), credit_id: "c3" },
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
        description: "Season package", created_at: atLocal(-3, 9), succeeded_at: atLocal(-3, 9),
      },
    ],
    checkout_intents: [],
    conversations: [
      { id: "cv1", channel: "sms", state: "open", human_owned: false, last_message_at: inHours(-2) },
    ],
    messages: [
      { id: "m1", conversation_id: "cv1", direction: "inbound", sender_kind: "parent",
        body: "Is there a camp near 19401 in June?", created_at: inHours(-3), channel: "sms" },
      { id: "m2", conversation_id: "cv1", direction: "outbound", sender_kind: "ai",
        body: "Norristown, week of 21 June, ages 6–14, 9am to 3pm. 54 places left. Want the link?",
        created_at: inHours(-2), channel: "sms" },
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
      { id: "th1", shift_id: "sh0", minutes: 120, amount_cents: 8000, worked_on: "2026-08-27",
        paid_at: null, status: "pending" },
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

// The same family, in the seconds between Stripe taking the money and the
// webhook creating the booking.
export const midCheckoutFixtures = {
  ...parentFixtures,
  tables: {
    ...parentFixtures.tables,
    checkout_intents: [
      {
        id: "ci1", kind: "group_package", amount_cents: 56000, state: "submitted",
        created_at: atLocal(0, 9), group_id: "g1", player_id: "p1",
        training_groups: { name: "Mon/Wed U9 Foundation" },
      },
    ],
  },
};

// =============================================================================
// For the screenshots
// =============================================================================
// The same family with sessions at plausible hours — 5:30 on a weekday evening
// rather than however many hours from whenever the script happens to run. The
// suite above wants determinism; a picture wants to look like a Tuesday.

const demoBookings = [
  booking("b1", "confirmed", atLocal(3, 17, 30), "s1"),
  booking("b2", "confirmed", atLocal(1, 17, 30), "s2"),
  { ...booking("b3", "attended", atLocal(-3, 17, 30), "s0"), credit_id: "c3" },
];

export const demoFixtures = {
  ...parentFixtures,
  tables: { ...parentFixtures.tables, bookings: demoBookings },
};

export const demoMidCheckoutFixtures = {
  ...midCheckoutFixtures,
  tables: { ...midCheckoutFixtures.tables, bookings: demoBookings },
};

// An administrator: the same shape as a parent, plus the claim. The claim is
// what the database checks; nothing about the interface grants it.
// Every write the screens make, in order. Reset by resetCalls() between tests.
export const calls = [];
export function resetCalls() { calls.length = 0; }

export const adminFixtures = {
  ...parentFixtures,
  session: {
    user: { id: "u9", email: "ops@example.test", app_metadata: { ptp_role: "admin" } },
    access_token: "t",
  },
  tables: {
    ...parentFixtures.tables,
    seasons: [
      { id: "s1", name: "Autumn 2026", starts_on: "2026-09-08", ends_on: "2026-11-03", weeks: 8, status: "running" },
    ],
    locations: [
      { id: "l1", name: "Norristown Turf", city: "Norristown", state: "PA",
        permit_status: "permitted", verified_at: inHours(-800), active: true },
      { id: "l2", name: "Cheltenham Field", city: "Cheltenham", state: "PA",
        permit_status: "unknown", verified_at: null, active: true },
    ],
    trainers: [
      { id: "t1", first_name: "Dani", last_name: "Okoro", status: "active", background_check_status: "cleared" },
      { id: "t2", first_name: "Marcus", last_name: "Bell", status: "active", background_check_status: "pending" },
    ],
    training_groups: [
      { id: "g1", name: "Mon/Wed U9 Foundation", slug: "u9-foundation", season_id: "s1",
        location_id: "l1", trainer_id: "t1", min_age: 8, max_age: 9, min_skill: 1, max_skill: 3,
        min_players: 4, target_players: 5, max_players: 6, status: "draft", dropin_price_cents: null,
        group_meeting_times: [
          { id: "m1", weekday: 1, starts_time: "17:30:00", duration_minutes: 60 },
          { id: "m2", weekday: 3, starts_time: "17:30:00", duration_minutes: 60 },
        ] },
    ],
  },

  rpc: {
    operations_today: () => ({
      escalations: [
        {
          id: "e1", severity: "urgent", summary: "Parent reported an injury at Tuesday's session",
          source: "safety", raised_at: inHours(-5), due_at: inHours(-1), overdue: true,
          recommended_action: "Ring them today", household: "Adeyemi family",
          contact: "Simi Adeyemi", phone: "+12155550208", conversation_id: "cv1",
        },
        {
          id: "e2", severity: "normal", summary: "Charged amount does not match the quoted price",
          source: "payment", raised_at: inHours(-2), due_at: inHours(2), overdue: false,
          recommended_action: "Check the Stripe intent", household: "Nguyen family",
          contact: "Mai Nguyen", phone: "+12155550203", conversation_id: null,
        },
      ],
      groups_nearly_running: [
        { id: "g1", name: "Mon/Wed U9 Foundation", paid: 3, short_by: 1, sessions_remaining: 14 },
      ],
      camps_at_risk: [
        { id: "c1", name: "Princeton Week 3", city: "Princeton", fill_rate: 0.2,
          days_until: 30, registered: 8, capacity: 40 },
      ],
      unpaid_checkouts: [
        { id: "ci9", kind: "group_package", amount_cents: 56000,
          created_at: inHours(-6), household: "Silva family" },
      ],
      failed_jobs: [],
      stuck_webhooks: 0,
      unverified_fields: [{ id: "l9", name: "Westgate Park", city: "Trenton" }],
      automation_paused: false,
      sessions_today: 4,
    }),

    camp_utilisation: () => [
      { camp_id: "c1", name: "Norristown Week 1", city: "Norristown", state: "PA",
        starts_on: "2027-06-21", status: "registration_open", capacity: 60, registered: 6,
        fill_rate: 0.1, revenue_cents: 237000, days_until: 120 },
    ],

    group_utilisation: () => [
      { group_id: "g1", name: "Mon/Wed U9 Foundation", status: "forming", min_players: 4,
        paid: 3, capacity: 6, fill_rate: 0.5, short_by: 1, revenue_cents: 168000,
        sessions_remaining: 14 },
    ],

    // ---- the training write surface ---------------------------------------
    // These record what was asked for, so a test can assert the screen sent
    // the right thing rather than only that it did not crash.
    upsert_training_group: (args) => { calls.push(["upsert_training_group", args]); return "g-new"; },
    set_group_meeting_times: (args) => { calls.push(["set_group_meeting_times", args]); return 16; },
    publish_training_group: (args) => {
      calls.push(["publish_training_group", args]);
      return { group_id: args.p_group_id, status: "forming", meeting_times: 2, sessions_generated: 16 };
    },
    cancel_training_group: (args) => { calls.push(["cancel_training_group", args]); return { paid_bookings: 0 }; },
    upsert_location: (args) => { calls.push(["upsert_location", args]); return "l-new"; },
    verify_location: (args) => {
      calls.push(["verify_location", args]);
      if (args.p_verified === false) {
        throw new Error("Cannot unverify: 1 group(s) are open on this field. Move or cancel them first");
      }
      return true;
    },

    payroll_for_period: () => [
      { trainer_id: "t1", trainer_name: "Dani Okoro", stripe_account_id: "acct_1",
        sessions: 6, minutes: 720, hours: 12, amount_cents: 48000, unpaid_cents: 16000,
        first_worked: "2026-08-17", last_worked: "2026-08-28" },
      { trainer_id: "t2", trainer_name: "Marcus Bell", stripe_account_id: null,
        sessions: 4, minutes: 480, hours: 8, amount_cents: 32000, unpaid_cents: 0,
        first_worked: "2026-08-18", last_worked: "2026-08-27" },
    ],

    acknowledge_escalation: () => null,
    resolve_escalation: () => null,
    set_automation_paused: (args) => args.p_paused,
    mark_payroll_paid: () => 3,
  },
};
