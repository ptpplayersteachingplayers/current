// =============================================================================
// The read models
// =============================================================================
//   node web/tests/derive.test.mjs
//
// These are the only parts of the interface with anything to get wrong, so
// they are the parts written as pure functions with the clock passed in.
// =============================================================================

import {
  campAction, campDateRange, campEligibility, campSummary, canCancel, clockRange,
  creditSummary, dayPlan, groupCard, meetingLabel, nextSession, roster, rosterProgress,
} from "../shared/derive.js";
import { dayKey, hours, money, relativeDay, time, whenLabel } from "../shared/format.js";

let pass = 0;
let fail = 0;

function check(description, got, expected) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ok   ${description}`);
    pass++;
  } else {
    console.log(`  FAIL ${description}\n         got:      ${JSON.stringify(got)}\n         expected: ${JSON.stringify(expected)}`);
    fail++;
  }
}

const TZ = "America/New_York";
// A Thursday in September, 9am Eastern.
const NOW = new Date("2026-09-03T13:00:00Z");

console.log("FORMATTING");
check("whole dollars lose the cents", money(56000), "$560");
check("…but odd amounts keep them", money(4550), "$45.50");
check("zero is zero, not blank", money(0), "$0");
check("a missing amount is not $0.00", money(null), "—");
check("times read the way people say them", time("2026-09-03T21:30:00Z", TZ), "5:30pm");
check("…and drop :00 on the hour", time("2026-09-03T21:00:00Z", TZ), "5pm");
check(
  "the timezone is the club's, not the browser's",
  time("2026-09-04T00:30:00Z", TZ),
  "8:30pm",
);
check(
  "…which is a different calendar day in UTC",
  dayKey("2026-09-04T00:30:00Z", TZ),
  "2026-09-03",
);
check("today is Today", relativeDay("2026-09-03T22:00:00Z", TZ, NOW), "Today");
check("tomorrow is Tomorrow", relativeDay("2026-09-04T22:00:00Z", TZ, NOW), "Tomorrow");
check("further out gets a date", relativeDay("2026-09-10T22:00:00Z", TZ, NOW), "Thu 10 Sep");
check("whole hours have no decimal", hours("2026-09-03T13:00:00Z", "2026-09-03T15:00:00Z"), "2");
check("half hours do", hours("2026-09-03T13:00:00Z", "2026-09-03T14:30:00Z"), "1.5");
console.log("");

console.log("PARENT — what is next");
const bookings = [
  {
    id: "b1", status: "confirmed", credit_id: "c1",
    player: { first_name: "Tayo" },
    session: { starts_at: "2026-09-10T21:30:00Z", location: { name: "Northside Turf" } },
  },
  {
    id: "b2", status: "confirmed", credit_id: "c2",
    player: { first_name: "Tayo" },
    session: { starts_at: "2026-09-04T21:30:00Z", location: { name: "Northside Turf" } },
  },
  {
    id: "b3", status: "canceled", credit_id: null,
    player: { first_name: "Tayo" },
    session: { starts_at: "2026-09-03T21:30:00Z", location: { name: "Northside Turf" } },
  },
];

check(
  "the soonest confirmed session wins, not the first in the list",
  nextSession(bookings, { timeZone: TZ, now: NOW }).headline,
  "Tayo — Tomorrow, 5:30pm",
);
check(
  "a cancelled session is never what is next",
  nextSession(bookings, { timeZone: TZ, now: NOW }).booking.id,
  "b2",
);
check(
  "a family with nothing booked gets null, not a crash",
  nextSession([], { timeZone: TZ, now: NOW }),
  null,
);
check(
  "a session that has already started is behind us",
  nextSession(
    [{ ...bookings[1], session: { starts_at: "2026-09-03T12:00:00Z" } }],
    { timeZone: TZ, now: NOW },
  ),
  null,
);
console.log("");

console.log("PARENT — credits");
const credits = [
  { state: "available", expires_on: "2026-10-25" },
  { state: "available", expires_on: "2026-10-25" },
  { state: "reserved", expires_on: "2026-10-25" },
  { state: "consumed", expires_on: "2026-10-25" },
  { state: "expired", expires_on: "2026-08-01" },
];
const summary = creditSummary(credits, { timeZone: TZ, now: NOW });
check("available is counted", summary.available, 2);
check("reserved is not available", summary.reserved, 1);
check("spent is counted separately", summary.consumed, 1);
// These three asserted "good until 2026-10-25" for a year, which is a database
// column read out loud rather than a date written to a parent. The assertion
// was the bug: it could not fail while the page was wrong.
check(
  "the note says how many and until when, as a date a person writes",
  summary.note,
  "2 sessions left, good until Sun 25 Oct.",
);
check(
  "one session reads as one, not '1 sessions'",
  creditSummary([{ state: "available", expires_on: "2026-12-01" }], { timeZone: TZ, now: NOW }).note,
  "1 session left, good until Tue 1 Dec.",
);
check(
  "credits about to expire say so instead",
  creditSummary([{ state: "available", expires_on: "2026-09-10" }], { timeZone: TZ, now: NOW }).note,
  "1 session expires on Thu 10 Sep.",
);
// expires_on is a date, not a moment. Read naively it lands on the previous
// evening in New York and the parent is told the wrong day.
check(
  "a date is not shifted backwards by the timezone",
  creditSummary([{ state: "available", expires_on: "2027-01-01" }], { timeZone: TZ, now: NOW }).note,
  "1 session left, good until Fri 1 Jan.",
);
check(
  "a family with none left but some spent is reassured, not alarmed",
  creditSummary([{ state: "consumed", expires_on: "2026-10-25" }], { timeZone: TZ, now: NOW }).note,
  "All your sessions are booked in.",
);
console.log("");

console.log("PARENT — cancelling, said before it happens");
const soon = { status: "confirmed", credit_id: "c1", session: { starts_at: "2026-09-03T18:00:00Z" } };
const later = { status: "confirmed", credit_id: "c1", session: { starts_at: "2026-09-10T18:00:00Z" } };

check("a week out is refundable", canCancel(later, { now: NOW }).refundable, true);
check(
  "…and a credit-paid booking is told the credit returns",
  canCancel(later, { now: NOW }).reason,
  "Your session credit comes straight back.",
);
check(
  "a card-paid booking is told about the money",
  canCancel({ ...later, credit_id: null, payment_id: "p1" }, { now: NOW }).reason,
  "You will be refunded in full.",
);
check("five hours out is not refundable", canCancel(soon, { now: NOW }).refundable, false);
check(
  "…and is told why, in advance, rather than discovering it",
  canCancel(soon, { now: NOW }).reason,
  "Less than 24 hours' notice, so this one is not refundable — the trainer is already committed to the session.",
);
check("a past session cannot be cancelled", canCancel({ status: "confirmed", session: { starts_at: "2026-09-01T18:00:00Z" } }, { now: NOW }).allowed, false);
check("nor one already cancelled", canCancel({ status: "canceled", session: { starts_at: "2026-09-10T18:00:00Z" } }, { now: NOW }).allowed, false);
check(
  "the free window comes from settings, not a constant here",
  canCancel(soon, { now: NOW, freeCancelHours: 2 }).refundable,
  true,
);
console.log("");

console.log("PARENT — browsing groups");
const group = {
  id: "g1", name: "Mon/Wed U9 Foundation", status: "forming",
  min_age: 7, max_age: 9, min_players: 4, max_players: 6, dropin_price_cents: 4000,
  locations: { name: "Northside Turf" },
  trainers: { display_name: "Dani Okoro" },
  group_meeting_times: [
    { weekday: 3, starts_time: "17:30:00", duration_minutes: 60 },
    { weekday: 1, starts_time: "17:30:00", duration_minutes: 60 },
  ],
};

check(
  "one family short is worth saying exactly",
  groupCard(group, { paid: 3, held: 0, total: 3, capacity: 6 }).status,
  "One more family and this group starts",
);
check(
  "two short is a plural that reads properly",
  groupCard(group, { paid: 2, held: 0, total: 2, capacity: 6 }).status,
  "Needs 2 more families to start",
);
check(
  "a running group says so",
  groupCard({ ...group, status: "confirmed" }, { paid: 4, held: 0, total: 4, capacity: 6 }).status,
  "Running",
);
check(
  "…and flags the last place",
  groupCard({ ...group, status: "confirmed" }, { paid: 5, held: 0, total: 5, capacity: 6 }).status,
  "Running — one place left",
);
check(
  "a full group offers the waitlist rather than a dead end",
  groupCard({ ...group, status: "full" }, { paid: 6, held: 0, total: 6, capacity: 6 }).status,
  "Full — join the waitlist",
);
check(
  "a held place counts against what is left",
  groupCard(group, { paid: 3, held: 1, total: 4, capacity: 6 }).spotsLeft,
  2,
);
check(
  "the badge stays short, because a long one pushes a phone sideways",
  groupCard(group, { paid: 3, held: 0, total: 3, capacity: 6 }).pill,
  "1 to start",
);
check(
  "…and counts up honestly when more are needed",
  groupCard(group, { paid: 1, held: 0, total: 1, capacity: 6 }).pill,
  "3 to start",
);
check(
  "a full group's badge is the action, not the problem",
  groupCard({ ...group, status: "full" }, { paid: 6, held: 0, total: 6, capacity: 6 }).pill,
  "Waitlist",
);
check("meeting days are listed in week order", meetingLabel(group.group_meeting_times), "Mon & Wed at 5:30pm");
check("a group with no times set does not pretend", meetingLabel([]), "Schedule to be confirmed");
console.log("");

console.log("TRAINER — the day");
const sessions = [
  { id: "s1", starts_at: "2026-09-03T21:00:00Z", ends_at: "2026-09-03T22:00:00Z", status: "scheduled", location_id: "l1", paid_count: 5, training_groups: { name: "U9 Foundation" }, locations: { name: "Northside Turf" } },
  { id: "s2", starts_at: "2026-09-03T23:00:00Z", ends_at: "2026-09-04T00:00:00Z", status: "scheduled", location_id: "l1", paid_count: 6, training_groups: { name: "U12 Advanced" }, locations: { name: "Northside Turf" } },
  { id: "s3", starts_at: "2026-09-05T14:00:00Z", ends_at: "2026-09-05T15:00:00Z", status: "scheduled", location_id: "l2", paid_count: 1, locations: { name: "Riverside Park" } },
];
const shifts = [
  { id: "sh1", starts_at: "2026-09-03T21:00:00Z", ends_at: "2026-09-04T00:00:00Z", status: "confirmed", hourly_pay_cents: 4000 },
];

const plan = dayPlan(sessions, shifts, { timeZone: TZ, now: NOW });
check("only today's sessions", plan.sessionCount, 2);
check("the day is labelled in words", plan.label, "Today");
check("a gap between sessions is made visible", plan.items[1].kind, "gap");
check("…and named in hours", plan.items[1].label, "1 hour gap");
check("scheduled hours are the two sessions", plan.scheduledHours, 2);
check("the block is three, because the gap is part of the commitment", plan.blockHours, 3);
check(
  "pay follows the whole block, gap included, because that is the promise",
  plan.payCents,
  12000,
);
check("a confirmed block needs no warning", plan.warning, null);
check(
  "a proposed one says what it is waiting for",
  dayPlan(sessions, [{ ...shifts[0], status: "proposed" }], { timeZone: TZ, now: NOW }).warning,
  "Not confirmed yet — this block needs one more booking before it goes ahead.",
);
check(
  "a cancelled session is off the plan",
  dayPlan(
    [{ ...sessions[0], status: "canceled" }, sessions[1]],
    shifts, { timeZone: TZ, now: NOW },
  ).sessionCount,
  1,
);
check(
  "a day with nothing on it still renders",
  dayPlan(sessions, shifts, { timeZone: TZ, now: NOW, day: "2026-09-04" }).items,
  [],
);
console.log("");

console.log("TRAINER — the register");
const rosterBookings = [
  { id: "b1", player_id: "p2", status: "confirmed", players: { first_name: "Zara", last_name: "Okafor" } },
  { id: "b2", player_id: "p1", status: "confirmed", players: { first_name: "Ada", last_name: "Hartley" } },
  { id: "b3", player_id: "p3", status: "canceled", players: { first_name: "Leo", last_name: "Martelli" } },
];
const marks = [{ player_id: "p1", state: "present", note: "" }];
const entries = roster(rosterBookings, marks);

check("cancelled players are not on the register", entries.length, 2);
check("names are alphabetical, as a register is read", entries.map((e) => e.name), ["Ada Hartley", "Zara Okafor"]);
check("an existing mark is carried through so a half-done register resumes", entries[0].state, "present");
check("an unmarked player is null, not absent", entries[1].state, null);
check("progress is countable", rosterProgress(entries).label, "1 of 2 marked");
check("…and knows when it is done", rosterProgress(entries).complete, false);
check(
  "a fully marked register is complete",
  rosterProgress(roster(rosterBookings, [
    { player_id: "p1", state: "present" }, { player_id: "p2", state: "absent" },
  ])).complete,
  true,
);

console.log("");

console.log("CAMPS");
const camp = {
  id: "c1", slug: "norristown-week-1", name: "Norristown Summer Camp — Week 1",
  city: "Norristown", state: "PA", field_name: "Northside Turf",
  starts_on: "2027-06-21", ends_on: "2027-06-25",
  daily_starts_at: "09:00:00", daily_ends_at: "15:00:00",
  min_age: 6, max_age: 14,
  full_day_price_cents: 39500, half_day_price_cents: 27500,
  offers_full_day: true, offers_half_day: true,
  status: "registration_open",
  occupancy: { paid: 6, held: 0, total: 6, capacity: 60 },
};

check("a camp week reads as a week, not two dates", campDateRange("2027-06-21", "2027-06-25"), "Mon 21 – Fri 25 Jun");
check("…and spans a month boundary properly", campDateRange("2027-06-28", "2027-07-02"), "Mon 28 Jun – Fri 2 Jul");
check("field hours are shown as given, not converted", clockRange("09:00:00", "15:00:00"), "9am–3pm");
check("the headline price is the cheapest option offered", campSummary(camp).from_price_cents, 27500);
check(
  "…and a full-day-only camp quotes the full day",
  campSummary({ ...camp, offers_half_day: false }).from_price_cents,
  39500,
);
check("places left is capacity minus everything taken", campSummary(camp).spots_left, 54);
check("a held place counts as taken", campSummary({ ...camp, occupancy: { paid: 6, held: 2, total: 8, capacity: 60 } }).spots_left, 52);
check("an open camp offers registration", campSummary(camp).action, "register");
check("a full camp offers the waitlist", campSummary({ ...camp, status: "full" }).action, "waitlist");
check(
  "…and so does one with zero places, whatever its status says",
  campSummary({ ...camp, occupancy: { paid: 60, held: 0, total: 60, capacity: 60 } }).action,
  "waitlist",
);
check("an early-access camp collects interest, not money", campSummary({ ...camp, status: "early_access" }).action, "interest");

check(
  "age is measured on the first day of camp, not today",
  campEligibility(camp, { first_name: "Tayo", birth_date: "2021-01-04" }).age,
  6,
);
check(
  "a child who is too young is told which camp is wrong, and by how much",
  campEligibility(camp, { first_name: "Nia", birth_date: "2022-08-01" }).reason,
  "This camp starts at 6. Nia is 4.",
);
check(
  "a child who turns 15 the week after is still eligible",
  campEligibility(camp, { first_name: "Ada", birth_date: "2012-06-28" }).eligible,
  true,
);
check(
  "…and one who turned 15 the week before is not",
  campEligibility(camp, { first_name: "Ada", birth_date: "2012-06-14" }).eligible,
  false,
);
check("a player with no birthday recorded is not blocked", campEligibility(camp, { first_name: "X" }).eligible, true);

console.log("");
console.log("============================================================");
console.log(`  ${pass} passed, ${fail} failed`);
console.log("============================================================");
process.exit(fail === 0 ? 0 : 1);
