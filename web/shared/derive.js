// =============================================================================
// Read models
// =============================================================================
// Turning rows into the two or three sentences a person actually needs.
//
// Nothing here decides anything. Prices, capacity, eligibility, refunds and
// pay are all settled in the database; these functions only describe what it
// decided. Where one of them looks like it is applying a rule — canCancel() is
// the obvious case — it is predicting, so the page can warn before the tap,
// and the server's answer is still the one that counts.
//
// Pure functions with the clock passed in, so they can be tested.
// =============================================================================

import { dayKey, money, plural, relativeDay, time, whenLabel } from "./format.js";

// -----------------------------------------------------------------------------
// Parent
// -----------------------------------------------------------------------------

// The one line at the top of the portal. A parent opening the app almost
// always wants exactly this.
export function nextSession(bookings, { timeZone, now = new Date() } = {}) {
  const upcoming = bookings
    .filter((b) => ["confirmed", "attended"].includes(b.status))
    .filter((b) => new Date(b.session.starts_at) > now)
    .sort((a, b) => new Date(a.session.starts_at) - new Date(b.session.starts_at));

  if (upcoming.length === 0) return null;

  const booking = upcoming[0];

  return {
    booking,
    player: booking.player,
    headline: `${booking.player.first_name} — ${whenLabel(booking.session.starts_at, timeZone, now)}`,
    place: booking.session.location?.name ?? "Location to be confirmed",
    isToday: dayKey(booking.session.starts_at, timeZone) === dayKey(now, timeZone),
  };
}

// Credits are rows, so this counts rows. The expiry line is the part families
// actually ask about.
export function creditSummary(credits, { timeZone, now = new Date(), soonDays = 21 } = {}) {
  const available = credits.filter((c) => c.state === "available");
  const reserved = credits.filter((c) => c.state === "reserved");
  const consumed = credits.filter((c) => c.state === "consumed");
  const expired = credits.filter((c) => c.state === "expired");

  const soon = available.filter((c) => {
    const days = (new Date(`${c.expires_on}T12:00:00Z`) - now) / 86_400_000;
    return days <= soonDays;
  });

  const nextExpiry = available
    .map((c) => c.expires_on)
    .sort()
    .at(0);

  let note = null;
  if (available.length === 0 && consumed.length > 0) {
    note = "All your sessions are booked in.";
  } else if (soon.length > 0) {
    note = `${plural(soon.length, "session")} ${soon.length === 1 ? "expires" : "expire"} on ${nextExpiry}.`;
  } else if (available.length > 0) {
    note = `${plural(available.length, "session")} left, good until ${nextExpiry}.`;
  }

  return {
    available: available.length,
    reserved: reserved.length,
    consumed: consumed.length,
    expired: expired.length,
    expiringSoon: soon.length,
    nextExpiry: nextExpiry ?? null,
    note,
  };
}

// A prediction, not a decision. cancel_booking() applies the policy; this is
// so the page can say what will happen before the parent commits to finding
// out. If the two ever disagree, the server is right.
export function canCancel(booking, { freeCancelHours = 24, now = new Date() } = {}) {
  if (["canceled", "refunded"].includes(booking.status)) {
    return { allowed: false, refundable: false, reason: "Already cancelled" };
  }

  const startsAt = new Date(booking.session.starts_at);

  if (startsAt <= now) {
    return { allowed: false, refundable: false, reason: "That session has already started" };
  }

  const hoursNotice = (startsAt - now) / 3_600_000;
  const refundable = hoursNotice >= freeCancelHours;

  return {
    allowed: true,
    refundable,
    hoursNotice: Math.round(hoursNotice * 10) / 10,
    // Said plainly, in advance. Nobody should discover the cancellation policy
    // by being charged by it.
    reason: refundable
      ? booking.credit_id
        ? "Your session credit comes straight back."
        : "You will be refunded in full."
      : `Less than ${freeCancelHours} hours' notice, so this one is not refundable — the trainer is already committed to the session.`,
  };
}

// What a family sees on a group card while browsing.
export function groupCard(group, occupancy) {
  const capacity = occupancy?.capacity ?? group.max_players;
  const taken = occupancy?.total ?? 0;
  const paid = occupancy?.paid ?? 0;
  const needed = Math.max(0, group.min_players - paid);

  let status;   // the sentence, on its own line
  let pill;     // two or three words, in the badge
  let tone;

  if (group.status === "full") {
    status = "Full — join the waitlist";
    pill = "Waitlist";
    tone = "waitlist";
  } else if (group.status === "confirmed") {
    status = capacity - taken === 1 ? "Running — one place left" : "Running";
    pill = "Running";
    tone = "running";
  } else if (needed === 1) {
    // The most persuasive true sentence available, and it is worth saying
    // exactly: one family is what stands between this group and running.
    status = "One more family and this group starts";
    pill = "1 to start";
    tone = "nearly";
  } else {
    status = `Needs ${plural(needed, "more family", "more families")} to start`;
    pill = `${needed} to start`;
    tone = "forming";
  }

  return {
    id: group.id,
    name: group.name,
    status,
    pill,
    tone,
    spotsLeft: Math.max(0, capacity - taken),
    ages: group.min_age && group.max_age ? `Ages ${group.min_age}–${group.max_age}` : "All ages",
    place: group.locations?.name ?? group.location?.name ?? null,
    trainer: group.trainers?.display_name ?? group.trainer?.display_name ?? null,
    meets: meetingLabel(group.group_meeting_times ?? group.meeting_times ?? []),
    dropIn: group.dropin_price_cents ? money(group.dropin_price_cents) : null,
  };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function meetingLabel(meetingTimes) {
  if (meetingTimes.length === 0) return "Schedule to be confirmed";

  const sorted = [...meetingTimes].sort((a, b) => a.weekday - b.weekday);
  const days = sorted.map((m) => WEEKDAYS[m.weekday].slice(0, 3)).join(" & ");

  // The clock times on a meeting row are local wall-clock strings, not
  // instants, so they are shown as given rather than converted.
  const at = sorted[0]?.starts_at ? ` at ${trimClock(sorted[0].starts_at)}` : "";
  return `${days}${at}`;
}

function trimClock(clock) {
  const [h, m] = String(clock).split(":");
  const hour = Number(h);
  const suffix = hour >= 12 ? "pm" : "am";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return m === "00" ? `${twelve}${suffix}` : `${twelve}:${m}${suffix}`;
}

// -----------------------------------------------------------------------------
// Trainer
// -----------------------------------------------------------------------------

// A trainer's day, grouped into the blocks 0006 built, with the gaps between
// them made visible. An hour of unpaid waiting between two sessions is the
// thing they most want to know about before they agree to it.
export function dayPlan(sessions, shifts, { timeZone, now = new Date(), day = null } = {}) {
  const target = day ?? dayKey(now, timeZone);

  const todays = sessions
    .filter((s) => dayKey(s.starts_at, timeZone) === target)
    .filter((s) => s.status !== "canceled")
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

  const shift = shifts.find((s) => dayKey(s.starts_at, timeZone) === target) ?? null;

  const items = [];
  let previous = null;

  for (const session of todays) {
    if (previous) {
      const gapMinutes = Math.round((new Date(session.starts_at) - new Date(previous.ends_at)) / 60_000);
      if (gapMinutes > 0) {
        items.push({
          kind: "gap",
          minutes: gapMinutes,
          label: gapMinutes >= 60
            ? `${(gapMinutes / 60).toFixed(gapMinutes % 60 === 0 ? 0 : 1)} hour gap`
            : `${gapMinutes} minute gap`,
          sameLocation: previous.location_id === session.location_id,
        });
      }
    }

    items.push({
      kind: "session",
      session,
      label: `${time(session.starts_at, timeZone)}–${time(session.ends_at, timeZone)}`,
      title: session.training_groups?.name ?? session.group?.name ?? "Private session",
      place: session.locations?.name ?? session.location?.name ?? null,
      players: session.paid_count ?? 0,
    });

    previous = session;
  }

  const scheduledMs = todays.reduce((total, s) => total + (new Date(s.ends_at) - new Date(s.starts_at)), 0);

  // Two different numbers, and conflating them is how a trainer decides the
  // app is lying to them: the sessions add up to two hours, the block they are
  // committed to and paid for is three.
  const blockHours = shift ? (new Date(shift.ends_at) - new Date(shift.starts_at)) / 3_600_000 : null;

  return {
    day: target,
    label: todays.length > 0 ? relativeDay(todays[0].starts_at, timeZone, now) : relativeDay(now, timeZone, now),
    items,
    sessionCount: todays.length,
    scheduledHours: scheduledMs / 3_600_000,
    blockHours,
    shift,
    // Pay follows the shift, which follows scheduled hours — not attendance,
    // and not the number of players. Showing it here keeps that promise in
    // front of the person it was made to.
    payCents: shift ? Math.round((shift.hourly_pay_cents ?? 0) * blockHours) : null,
    warning: blockWarning(shift),
  };
}

export function blockWarning(shift) {
  if (!shift) return null;

  if (shift.status === "proposed") {
    return "Not confirmed yet — this block needs one more booking before it goes ahead.";
  }
  if (shift.status === "acknowledged") {
    return "You have accepted this. It is confirmed once the block fills.";
  }
  return null;
}

// The register. Everyone with a live booking, and whatever mark they already
// have, so a half-finished register resumes rather than restarts.
export function roster(bookings, attendance) {
  const marks = new Map(attendance.map((a) => [a.player_id, a]));

  return bookings
    .filter((b) => !["canceled", "refunded"].includes(b.status))
    .map((b) => ({
      playerId: b.player_id,
      name: `${b.players?.first_name ?? b.player?.first_name ?? ""} ${b.players?.last_name ?? b.player?.last_name ?? ""}`.trim(),
      bookingId: b.id,
      state: marks.get(b.player_id)?.state ?? null,
      note: marks.get(b.player_id)?.note ?? "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function rosterProgress(entries) {
  const marked = entries.filter((e) => e.state !== null).length;
  return {
    marked,
    total: entries.length,
    complete: entries.length > 0 && marked === entries.length,
    label: `${marked} of ${entries.length} marked`,
  };
}
