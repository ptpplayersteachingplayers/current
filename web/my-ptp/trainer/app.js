// =============================================================================
// Trainer portal
// =============================================================================
// Used one-handed, outdoors, on a bad connection, usually in the two minutes
// before a session starts. So: the day first, the register two taps away, and
// the register saves per player rather than as one submit at the end — a
// trainer who loses signal halfway through has lost nothing.
//
// Pay is shown because it is a promise worth keeping in view: once a block is
// confirmed the trainer is paid for the scheduled hours whoever turns up.
// Nothing on this screen can change that, and marking a register does not
// touch it.
// =============================================================================

import { blockWarning, dayPlan, roster, rosterProgress } from "/shared/derive.js";
import { date, dayKey, money, plural, time } from "/shared/format.js";
import { boot } from "/shared/boot.js";
import { signInView } from "/shared/signin.js";
import {
  badge, busy, el, empty, errorBox, mount, spinner, toast,
} from "/shared/ui.js";

const MARKS = [
  { state: "present", label: "In" },
  { state: "late", label: "Late" },
  { state: "absent", label: "Out" },
  { state: "excused", label: "Exc" },
];

export async function start(root) {
  const api = await boot();

  const state = { view: "day", day: dayKey(new Date(), api.timeZone), sessionId: null };

  const render = () => draw(root, api, state);
  api.auth.onChange(render);

  // The bottom bar moves between views rather than scrolling to anchors that
  // do not exist. Leaving the register is a hash change too, so the back
  // button works the way a phone's back button is expected to.
  addEventListener("hashchange", () => {
    if (state.view === "register") state.view = "day";
    render();
  });

  await render();
}

function tab() {
  return (location.hash || "#home").slice(1);
}

async function draw(root, api, state) {
  mount(root, spinner("Loading your schedule…"));

  const user = await api.auth.current();

  if (!user) {
    mount(root, signInView(api, { heading: "Trainer sign in", note: "Your sessions, registers and hours." }));
    return;
  }

  if (state.view === "register") {
    await drawRegister(root, api, state);
    return;
  }

  // A fortnight either side: enough for "what did I do last week" and "what
  // is coming", small enough to arrive quickly on a phone.
  const from = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const to = new Date(Date.now() + 28 * 86_400_000).toISOString();

  let sessions;
  let shifts;
  let hours;
  try {
    [sessions, shifts, hours] = await Promise.all([
      api.mySessions(from, to),
      api.myShifts(from, to),
      api.myHours(new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10)),
    ]);
  } catch (error) {
    mount(root, errorBox(error, { onRetry: () => draw(root, api, state) }));
    return;
  }

  const plan = dayPlan(sessions, shifts, { timeZone: api.timeZone, now: new Date(), day: state.day });

  const upcomingDays = [...new Set(sessions
    .filter((s) => new Date(s.starts_at) > new Date() && s.status !== "canceled")
    .map((s) => dayKey(s.starts_at, api.timeZone)))]
    .sort()
    .slice(0, 7);

  const views = {
    home: () => [
      el("h1", { text: plan.label }),
      el("p", { class: "lede", text: date(`${state.day}T12:00:00Z`, "UTC") }),

      dayPicker(upcomingDays, state, api, () => draw(root, api, state)),
      plan.warning ? el("div", { class: "notice", text: plan.warning }) : null,
      shiftCard(plan, api, () => draw(root, api, state)),

      plan.items.length === 0
        ? empty("Nothing scheduled.", "Days you are booked appear above.")
        : el("div", {}, plan.items.map((item) => planRow(item, api, state, root))),
    ],

    schedule: () => [
      el("h1", { text: "Schedule" }),
      el("p", { class: "lede", text: "The next four weeks, as blocks rather than as a list of sessions." }),
      ...weekPlan(sessions, shifts, api, state, root),
    ],

    messages: () => [
      el("h1", { text: "Messages" }),
      el("p", { class: "lede", text: "Anything to do with a family goes through the office, not directly — so a parent hears one voice." }),
      el("div", { class: "card" }, [
        el("h3", { text: "Report a problem with a field" }),
        el("p", { class: "meta", text: "Locked gate, waterlogged pitch, nobody to let you in. Tell the office and they will move the session and message the families." }),
        el("a", { class: "button primary mt-4", href: "/contact/", text: "Message the office" }),
      ]),
      el("div", { class: "card" }, [
        el("h3", { text: "Something about a player" }),
        el("p", { class: "meta", text: "Injuries and anything to do with safety go in the register as a note — those reach the parent, and they reach a person here straight away." }),
      ]),
    ],

    pay: () => [
      el("h1", { text: "Pay" }),
      el("p", { class: "lede", text: "Paid by the scheduled hour. Once a block is confirmed you are paid for its length, whoever turns up." }),
      hoursTable(hours, api),
      el("div", { class: "mt-7" }, [
        el("button", { class: "button ghost", text: "Sign out", onclick: () => api.auth.signOut() }),
      ]),
    ],
  };

  mount(root, ...(views[tab()] ?? views.home)());
}

// The month ahead, grouped by day, so a trainer can see which weekends are
// committed and which are still empty.
function weekPlan(sessions, shifts, api, state, root) {
  const days = [...new Set(sessions
    .filter((s) => s.status !== "canceled" && new Date(s.starts_at) > new Date())
    .map((s) => dayKey(s.starts_at, api.timeZone)))].sort();

  if (days.length === 0) {
    return [empty("Nothing booked in the next four weeks.",
                  "Blocks appear here as soon as they are confirmed.")];
  }

  return days.map((day) => {
    const plan = dayPlan(sessions, shifts, { timeZone: api.timeZone, now: new Date(), day });

    return el("div", { class: "card" }, [
      el("div", { class: "card-row" }, [
        el("div", {}, [
          el("h3", { text: date(`${day}T12:00:00Z`, "UTC") }),
          el("p", { class: "meta", text: `${plural(plan.sessionCount, "session")}${plan.blockHours ? ` · ${plan.blockHours} hour block` : ""}` }),
        ]),
        plan.payCents !== null ? el("p", { class: "figure", text: money(plan.payCents) }) : null,
      ]),
      plan.warning ? el("p", { class: "notice", text: plan.warning }) : null,
    ]);
  });
}

function dayPicker(days, state, api, rerender) {
  const today = dayKey(new Date(), api.timeZone);
  const options = [...new Set([today, ...days])].sort().slice(0, 8);

  return el(
    "div",
    { class: "tabs" },
    options.map((day) =>
      el("button", {
        class: "tab",
        "aria-selected": String(day === state.day),
        text: day === today ? "Today" : date(`${day}T12:00:00Z`, "UTC").replace(/ \w+$/, ""),
        onclick: () => {
          state.day = day;
          rerender();
        },
      }),
    ),
  );
}

function shiftCard(plan, api, rerender) {
  if (!plan.shift) return null;

  const accept = el("button", { class: "button small", text: "Accept this block" });

  accept.addEventListener(
    "click",
    busy(accept, async () => {
      try {
        await api.acknowledgeShift(plan.shift.id);
        toast("Thanks — noted.");
        rerender();
      } catch (error) {
        toast(error.message, "error");
      }
    }),
  );

  return el("div", { class: "card card-row" }, [
    el("div", {}, [
      // The block, not the sum of the sessions. Showing "2 hours" beside a
      // three-hour payment is how a trainer decides the app is wrong.
      el("h3", { text: `${plan.blockHours} hour block` }),
      el("p", {
        class: "meta",
        text: `${time(plan.shift.starts_at, api.timeZone)}–${time(plan.shift.ends_at, api.timeZone)} · ${plural(plan.sessionCount, "session")}`,
      }),
      // Said out loud, on the screen the promise is made to.
      el("p", { class: "meta", text: "Paid for the whole block, however many players turn up." }),
    ]),
    el("div", {}, [
      el("p", { class: "figure", text: money(plan.payCents) }),
      blockWarning(plan.shift) ? badge(plan.shift.status, "warn") : badge(plan.shift.status, "running"),
      plan.shift.status === "proposed" ? accept : null,
    ]),
  ]);
}

function planRow(item, api, state, root) {
  if (item.kind === "gap") {
    return el("p", {
      class: "plan-gap",
      text: item.sameLocation ? item.label : `${item.label} — and a different field`,
    });
  }

  const open = el("button", { class: "button small", text: `Register (${item.players})` });

  open.addEventListener("click", () => {
    state.view = "register";
    state.sessionId = item.session.id;
    // Carried across so the register says which session it is. A trainer
    // running two groups an hour apart should never have to guess.
    state.sessionLabel = `${item.title} · ${item.label}`;
    draw(root, api, state);
  });

  return el("div", { class: "plan-item" }, [
    el("div", { class: "plan-time", text: item.label }),
    el("div", {}, [
      el("h3", { text: item.title }),
      el("p", { class: "meta", text: item.place ?? "Location to be confirmed" }),
      item.session.locations?.meeting_instructions
        ? el("p", { class: "meta", text: item.session.locations.meeting_instructions })
        : null,
    ]),
    el("div", { style: "margin-left:auto" }, [open]),
  ]);
}

async function drawRegister(root, api, state) {
  mount(root, spinner("Loading the register…"));

  let data;
  try {
    data = await api.sessionRoster(state.sessionId);
  } catch (error) {
    mount(root, errorBox(error, { onRetry: () => drawRegister(root, api, state) }));
    return;
  }

  const entries = roster(data.bookings, data.attendance);
  const progress = el("p", { class: "lede progress", text: rosterProgress(entries).label });

  const back = el("button", {
    class: "link",
    text: "← Back to the day",
    onclick: () => {
      state.view = "day";
      draw(root, api, state);
    },
  });

  const rows = entries.map((entry) => registerRow(entry, entries, api, state, progress));

  mount(
    root,
    back,
    el("h1", { text: "Register" }),
    state.sessionLabel ? el("p", { class: "lede", text: state.sessionLabel }) : null,
    progress,
    entries.length === 0
      ? empty("Nobody is booked into this session yet.")
      : el("div", { class: "card" }, rows),
    // Saved one player at a time, above. There is no submit button on purpose:
    // a register half-marked on a dying phone is still half-saved.
    el("p", { class: "meta", text: "Each mark saves as you tap it." }),
  );
}

function registerRow(entry, entries, api, state, progress) {
  const buttons = MARKS.map((mark) => {
    const button = el("button", {
      class: "mark",
      text: mark.label,
      "aria-pressed": String(entry.state === mark.state),
      "aria-label": `${entry.name}: ${mark.label}`,
    });

    button.addEventListener("click", async () => {
      const previous = entry.state;
      entry.state = mark.state;

      // Painted immediately: the trainer has moved on to the next player
      // before the request finishes.
      for (const [index, other] of buttons.entries()) {
        other.setAttribute("aria-pressed", String(MARKS[index].state === entry.state));
      }
      progress.textContent = rosterProgress(entries).label;

      try {
        await api.actions.recordAttendance({
          sessionId: state.sessionId,
          entries: [{ player_id: entry.playerId, state: mark.state }],
        });
      } catch (error) {
        entry.state = previous;
        for (const [index, other] of buttons.entries()) {
          other.setAttribute("aria-pressed", String(MARKS[index].state === entry.state));
        }
        progress.textContent = rosterProgress(entries).label;
        toast(error.message, "error");
      }
    });

    return button;
  });

  return el("div", { class: "register-row" }, [
    el("span", { class: "register-name", text: entry.name }),
    el("div", { class: "marks" }, buttons),
  ]);
}

function hoursTable(hours, api) {
  if (hours.length === 0) return empty("No hours recorded yet.");

  const total = hours.reduce((sum, h) => sum + h.amount_cents, 0);
  const unpaid = hours.filter((h) => !h.paid_at).reduce((sum, h) => sum + h.amount_cents, 0);

  return el("div", { class: "card" }, [
    el("div", { class: "card-row" }, [
      el("div", {}, [
        el("p", { class: "figure", text: money(total) }),
        el("p", { class: "figure-label", text: "last 60 days" }),
      ]),
      el("div", {}, [
        el("p", { class: "figure", text: money(unpaid) }),
        el("p", { class: "figure-label", text: "awaiting payout" }),
      ]),
    ]),
    el("h3", { class: "mt-4", text: "Recent days" }),
    ...hours.slice(0, 10).map((h) =>
      el("div", { class: "register-row" }, [
        el("span", { class: "register-name", text: h.worked_on }),
        el("span", { class: "meta", text: `${(h.minutes / 60).toFixed(h.minutes % 60 === 0 ? 0 : 1)} h` }),
        el("span", { text: money(h.amount_cents) }),
        h.paid_at ? badge("paid", "running") : badge("due", "neutral"),
      ]),
    ),
  ]);
}
