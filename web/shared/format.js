// =============================================================================
// Formatting
// =============================================================================
// Every date a parent or trainer reads goes through here, in the timezone the
// server told us to use — never the browser's. A family in Philadelphia
// checking the schedule from a hotel in Denver must see the time training
// actually starts, not the time it starts for them.
//
// No dependencies. Intl does all of it.
// =============================================================================

export const DEFAULT_TIMEZONE = "America/New_York";

// Money is integer cents everywhere, including here. Nothing in this file
// divides by 100 except this function.
export function money(cents, { withCents = "auto" } = {}) {
  if (cents === null || cents === undefined) return "—";

  const whole = cents % 100 === 0;
  const showCents = withCents === "always" || (withCents === "auto" && !whole);

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(cents / 100);
}

function parts(iso, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const found = {};
  for (const part of formatter.formatToParts(new Date(iso))) found[part.type] = part.value;
  return found;
}

export function time(iso, timeZone = DEFAULT_TIMEZONE) {
  const p = parts(iso, timeZone);
  // "5:30 PM" reads better lowercase and without the space, and drops the
  // ":00" on the hour: "5pm", not "5:00 PM".
  const minutes = p.minute === "00" ? "" : `:${p.minute}`;
  return `${p.hour}${minutes}${p.dayPeriod.toLowerCase()}`;
}

export function date(iso, timeZone = DEFAULT_TIMEZONE) {
  const p = parts(iso, timeZone);
  return `${p.weekday} ${p.day} ${p.month}`;
}

export function dateAndTime(iso, timeZone = DEFAULT_TIMEZONE) {
  return `${date(iso, timeZone)}, ${time(iso, timeZone)}`;
}

// The calendar day in a given zone, as YYYY-MM-DD. Comparing these strings is
// how "is this today?" is answered without any arithmetic on Date objects,
// which is where timezone bugs come from.
export function dayKey(iso, timeZone = DEFAULT_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date(iso));
}

export function relativeDay(iso, timeZone = DEFAULT_TIMEZONE, now = new Date()) {
  const target = dayKey(iso, timeZone);
  const today = dayKey(now, timeZone);

  if (target === today) return "Today";

  const tomorrow = dayKey(new Date(new Date(now).getTime() + 86_400_000), timeZone);
  if (target === tomorrow) return "Tomorrow";

  const yesterday = dayKey(new Date(new Date(now).getTime() - 86_400_000), timeZone);
  if (target === yesterday) return "Yesterday";

  return date(iso, timeZone);
}

export function whenLabel(iso, timeZone = DEFAULT_TIMEZONE, now = new Date()) {
  return `${relativeDay(iso, timeZone, now)}, ${time(iso, timeZone)}`;
}

// Whole hours where they are whole, one decimal where they are not. A trainer
// reading "2.5 hours" is fine; "2.4999999 hours" is not.
export function hours(startIso, endIso) {
  const milliseconds = new Date(endIso) - new Date(startIso);
  const value = milliseconds / 3_600_000;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
