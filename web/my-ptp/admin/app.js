// =============================================================================
// Admin
// =============================================================================
// The screen PTP staff open first. It answers one question — what needs a
// person today — and then gets out of the way.
//
// Nothing here is protected by hiding a button. Every call asserts staff in the
// database, so an administrator screen loaded by somebody who is not one shows
// a refusal rather than data.
// =============================================================================

import { boot } from "/shared/boot.js";
import { dateAndTime, money, plural } from "/shared/format.js";
import { signInView } from "/shared/signin.js";
import {
  badge, busy, confirmDialog, el, empty, errorBox, field, mount, spinner, toast,
} from "/shared/ui.js";

const TABS = [["Today", "home"], ["Camps", "camps"], ["Groups", "groups"], ["Pay", "pay"]];

export async function start(root) {
  const api = await boot();

  const render = () => draw(root, api);
  api.auth.onChange(render);
  addEventListener("hashchange", render);
  await render();
}

function tab() {
  return (location.hash || "#home").slice(1);
}

async function draw(root, api) {
  mount(root, spinner("Loading…"));

  const user = await api.auth.current();

  if (!user) {
    mount(root, signInView(api, { heading: "Administrator sign in", note: "PTP staff only." }));
    return;
  }

  mount(root,
    el("nav", { class: "tabs", "aria-label": "Admin" },
      TABS.map(([label, key]) =>
        el("a", {
          class: "tab",
          href: `#${key}`,
          "aria-selected": String(key === tab() || (key === "home" && !location.hash)),
          text: label,
        }))),
    el("div", { id: "panel" }, [spinner()]),
  );

  const panel = document.querySelector("#panel");

  try {
    switch (tab()) {
      case "camps":  return await campsView(panel, api);
      case "groups": return await groupsView(panel, api);
      case "pay":    return await payView(panel, api);
      default:       return await todayView(panel, api, root);
    }
  } catch (error) {
    // The database refuses a non-administrator by name. Say that rather than
    // "something went wrong" — the reader is staff and can act on it.
    mount(panel, errorBox(error));
  }
}

// =============================================================================
// Today
// =============================================================================

async function todayView(panel, api, root) {
  const today = await api.admin.today();

  const urgent = (today.escalations ?? []).filter((e) => e.overdue || e.severity === "urgent");

  mount(panel,
    el("h1", { text: "Today" }),
    el("p", { class: "lede", text: (today.escalations ?? []).length === 0
      ? "Nothing is waiting on a person."
      : `${plural((today.escalations ?? []).length, "thing")} waiting on a person.` }),

    today.automation_paused
      ? el("div", { class: "notice" }, [
          el("strong", { text: "Automation is paused. " }),
          "No reminders, follow-ups or agent replies are going out.",
        ])
      : null,

    el("div", { class: "stat-strip" }, [
      stat(String((today.escalations ?? []).length), "need a person", urgent.length > 0),
      stat(String(today.sessions_today ?? 0), "sessions today"),
      stat(String((today.groups_nearly_running ?? []).length), "groups nearly running"),
      stat(String((today.unpaid_checkouts ?? []).length), "unpaid checkouts"),
    ]),

    el("h2", { class: "section-label", text: "Needs a person" }),
    (today.escalations ?? []).length === 0
      ? empty("Nothing waiting.", "Escalations appear here the moment the agent raises one.")
      : el("div", {}, today.escalations.map((e) => escalationRow(e, api, root))),

    el("h2", { class: "section-label", text: "One family from running" }),
    (today.groups_nearly_running ?? []).length === 0
      ? empty("No groups on the line.")
      : el("div", {}, today.groups_nearly_running.map((g) =>
          el("div", { class: "card" }, [
            el("div", { class: "card-row" }, [
              el("div", {}, [
                el("h3", { text: g.name }),
                el("p", { class: "meta", text: `${g.paid} paid · ${plural(g.sessions_remaining, "session")} left in the season` }),
              ]),
              badge(g.short_by === 1 ? "1 to start" : `${g.short_by} to start`, "nearly"),
            ]),
          ]))),

    el("h2", { class: "section-label", text: "Camps not selling" }),
    (today.camps_at_risk ?? []).length === 0
      ? empty("Nothing at risk inside six weeks.")
      : el("div", {}, today.camps_at_risk.map((c) =>
          el("div", { class: "card" }, [
            el("div", { class: "card-row" }, [
              el("div", {}, [
                el("h3", { text: c.name }),
                el("p", { class: "meta", text: `${c.registered} of ${c.capacity} · ${c.days_until} days away` }),
              ]),
              badge(`${Math.round(c.fill_rate * 100)}%`, "warn"),
            ]),
          ]))),

    (today.failed_jobs ?? []).length > 0 || today.stuck_webhooks > 0
      ? el("div", {}, [
          el("h2", { class: "section-label", text: "The machinery" }),
          today.stuck_webhooks > 0
            ? el("p", { class: "notice", text: `${plural(today.stuck_webhooks, "webhook")} gave up and need replaying by hand.` })
            : null,
          ...(today.failed_jobs ?? []).map((j) =>
            el("div", { class: "card" }, [
              el("h3", { text: j.job_key }),
              el("p", { class: "meta", text: j.error }),
              el("p", { class: "meta", text: dateAndTime(j.started_at, api.timeZone) }),
            ])),
        ])
      : null,

    (today.unverified_fields ?? []).length > 0
      ? el("div", {}, [
          el("h2", { class: "section-label", text: "Fields nobody has confirmed" }),
          el("p", { class: "meta", text: "A group cannot open on any of these." }),
          ...today.unverified_fields.map((l) =>
            el("div", { class: "card" }, [el("h3", { text: `${l.name}, ${l.city}` })])),
        ])
      : null,

    pauseControl(today, api, root),
  );
}

function stat(value, label, alarm = false) {
  return el("div", { class: "stat" }, [
    el("p", { class: "figure", text: value }),
    el("p", { class: "figure-label", text: label }),
    alarm ? badge("overdue", "warn") : null,
  ]);
}

function escalationRow(escalation, api, root) {
  const ack = el("button", { class: "button ghost small", text: "I have got this" });
  const done = el("button", { class: "button small", text: "Resolve" });

  ack.addEventListener("click", busy(ack, async () => {
    await api.admin.acknowledge(escalation.id);
    toast("Marked as picked up.");
    draw(root, api);
  }));

  done.addEventListener("click", busy(done, async () => {
    const note = el("input", { type: "text", placeholder: "What did you do?" });
    const resume = el("input", { type: "checkbox" });

    const confirmed = await confirmDialog({
      title: "Close this one",
      body: [
        escalation.summary,
        el("div", {}, [field("What you did", note)]),
        el("label", { class: "checkbox" }, [resume, el("span", { text: "Let the assistant answer this family again" })]),
      ],
      confirmLabel: "Close it",
    });

    if (!confirmed) return;

    try {
      await api.admin.resolve(escalation.id, note.value.trim() || "Resolved", resume.checked);
      toast("Closed.");
      draw(root, api);
    } catch (error) {
      toast(error.message, "error");
    }
  }));

  return el("div", { class: escalation.overdue ? "card card-overdue" : "card" }, [
    el("div", { class: "card-row" }, [
      el("div", {}, [
        el("h3", { text: escalation.summary }),
        el("p", { class: "meta", text: [escalation.household, escalation.contact, escalation.phone].filter(Boolean).join(" · ") }),
        escalation.recommended_action
          ? el("p", { class: "meta", text: `Suggested: ${escalation.recommended_action}` })
          : null,
      ]),
      badge(escalation.overdue ? "Overdue" : escalation.severity, escalation.overdue ? "full" : "neutral"),
    ]),
    el("div", { class: "button-row" }, [ack, done]),
  ]);
}

// The switch, with the consequence spelled out. Pausing everything during an
// incident is the right move and should be one tap; doing it by accident
// should not be.
function pauseControl(today, api, root) {
  const button = el("button", {
    class: today.automation_paused ? "button primary" : "button ghost",
    text: today.automation_paused ? "Start automation again" : "Pause all automation",
  });

  button.addEventListener("click", busy(button, async () => {
    const pausing = !today.automation_paused;
    const reason = el("input", { type: "text", placeholder: pausing ? "What is happening?" : "All clear" });

    const confirmed = await confirmDialog({
      title: pausing ? "Stop everything?" : "Start everything again?",
      body: [
        pausing
          ? "No reminders, no follow-ups, no agent replies, and no scheduled jobs except the ones that release held places. Bookings and payments carry on."
          : "Reminders, follow-ups and the assistant start again from now. Nothing that was skipped while paused is sent retrospectively.",
        el("div", {}, [field("Reason", reason)]),
      ],
      confirmLabel: pausing ? "Pause everything" : "Start again",
    });

    if (!confirmed) return;

    await api.admin.setPaused(pausing, reason.value.trim());
    toast(pausing ? "Paused." : "Running again.");
    draw(root, api);
  }));

  return el("div", { class: "mt-7" }, [
    el("h2", { class: "section-label", text: "The big switch" }),
    el("p", { class: "meta", text: "One control, checked by every job and every outbound message." }),
    button,
  ]);
}

// =============================================================================
// Camps and groups
// =============================================================================

async function campsView(panel, api) {
  const camps = await api.admin.camps();

  mount(panel,
    el("h1", { text: "Camps" }),
    camps.length === 0
      ? empty("No camps published.")
      : el("div", { class: "table-scroll" }, [
          el("table", {}, [
            el("thead", {}, [el("tr", {}, [
              el("th", { text: "Camp" }), el("th", { text: "Starts" }),
              el("th", { text: "Filled" }), el("th", { text: "Revenue" }),
              el("th", { text: "Status" }),
            ])]),
            el("tbody", {}, camps.map((c) =>
              el("tr", {}, [
                el("td", {}, [
                  el("strong", { text: c.name }),
                  el("p", { class: "meta flush", text: `${c.city}, ${c.state}` }),
                ]),
                el("td", { text: `${c.starts_on} (${c.days_until}d)` }),
                el("td", { text: `${c.registered}/${c.capacity} · ${Math.round(c.fill_rate * 100)}%` }),
                el("td", { text: money(c.revenue_cents) }),
                el("td", {}, [badge(c.status, c.status === "full" ? "full" : c.status === "limited" ? "nearly" : "neutral")]),
              ]))),
          ]),
        ]),
  );
}

async function groupsView(panel, api) {
  const groups = await api.admin.groups();

  mount(panel,
    el("h1", { text: "Groups" }),
    el("p", { class: "lede", text: "Sorted by how far each one is from running." }),
    groups.length === 0
      ? empty("No groups this season.")
      : el("div", { class: "table-scroll" }, [
          el("table", {}, [
            el("thead", {}, [el("tr", {}, [
              el("th", { text: "Group" }), el("th", { text: "Paid" }),
              el("th", { text: "Short by" }), el("th", { text: "Sessions left" }),
              el("th", { text: "Revenue" }), el("th", { text: "Status" }),
            ])]),
            el("tbody", {}, groups.map((g) =>
              el("tr", {}, [
                el("td", {}, [el("strong", { text: g.name })]),
                el("td", { text: `${g.paid}/${g.capacity}` }),
                el("td", { text: g.short_by === 0 ? "—" : String(g.short_by) }),
                el("td", { text: String(g.sessions_remaining) }),
                el("td", { text: money(g.revenue_cents) }),
                el("td", {}, [badge(g.status, g.status === "full" ? "full" : g.status === "confirmed" ? "running" : "nearly")]),
              ]))),
          ]),
        ]),
  );
}

// =============================================================================
// Pay
// =============================================================================

async function payView(panel, api) {
  const to = new Date();
  const from = new Date(to.getTime() - 13 * 86_400_000);
  const iso = (d) => d.toISOString().slice(0, 10);

  const rows = await api.admin.payroll(iso(from), iso(to));
  const owed = rows.reduce((sum, r) => sum + Number(r.unpaid_cents ?? 0), 0);

  mount(panel,
    el("h1", { text: "Pay" }),
    el("p", { class: "lede", text: `${iso(from)} to ${iso(to)}. Paid by the scheduled hour, whoever turned up.` }),

    el("div", { class: "stat-strip" }, [
      stat(money(rows.reduce((sum, r) => sum + Number(r.amount_cents ?? 0), 0)), "earned"),
      stat(money(owed), "still owed"),
      stat(String(rows.length), "trainers"),
      stat(String(rows.reduce((sum, r) => sum + Number(r.sessions ?? 0), 0)), "shifts"),
    ]),

    rows.length === 0
      ? empty("No hours recorded in this period.")
      : el("div", {}, rows.map((r) => payRow(r, api, iso(from), iso(to), panel))),

    el("button", {
      class: "button ghost mt-7",
      text: "Download CSV",
      onclick: () => downloadCsv(rows, iso(from), iso(to)),
    }),
  );
}

function payRow(row, api, from, to, panel) {
  const pay = el("button", {
    class: "button small",
    text: `Mark ${money(row.unpaid_cents)} paid`,
    disabled: Number(row.unpaid_cents ?? 0) === 0,
  });

  pay.addEventListener("click", busy(pay, async () => {
    const reference = el("input", { type: "text", placeholder: "Transfer or batch reference" });

    const confirmed = await confirmDialog({
      title: `Mark ${row.trainer_name} paid`,
      body: [
        `${money(row.unpaid_cents)} for ${row.hours} hours between ${from} and ${to}.`,
        "This records the payment. It does not move any money — do that in Stripe and put the reference here.",
        el("div", {}, [field("Reference", reference)]),
      ],
      confirmLabel: "Record it",
    });

    if (!confirmed) return;

    try {
      const marked = await api.admin.markPaid(row.trainer_id, from, to, reference.value.trim() || "manual");
      toast(`${plural(marked, "entry", "entries")} marked paid.`);
      await payView(panel, api);
    } catch (error) {
      toast(error.message, "error");
    }
  }));

  return el("div", { class: "card" }, [
    el("div", { class: "card-row" }, [
      el("div", {}, [
        el("h3", { text: row.trainer_name }),
        el("p", { class: "meta", text: `${row.hours} hours · ${plural(row.sessions, "shift")} · ${row.first_worked} to ${row.last_worked}` }),
        row.stripe_account_id ? null : el("p", { class: "meta", text: "No Stripe account connected." }),
      ]),
      el("div", {}, [
        el("p", { class: "figure", text: money(row.amount_cents) }),
        Number(row.unpaid_cents ?? 0) > 0
          ? el("p", { class: "figure-label", text: `${money(row.unpaid_cents)} owed` })
          : badge("settled", "running"),
      ]),
    ]),
    Number(row.unpaid_cents ?? 0) > 0 ? el("div", { class: "button-row" }, [pay]) : null,
  ]);
}

// Built in the browser from rows already on screen — no export endpoint, and
// therefore no second definition of what a payroll row contains.
function downloadCsv(rows, from, to) {
  const header = ["Trainer", "Hours", "Shifts", "Amount", "Unpaid", "Stripe account", "From", "To"];

  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

  const body = rows.map((r) => [
    r.trainer_name, r.hours, r.sessions,
    (Number(r.amount_cents) / 100).toFixed(2),
    (Number(r.unpaid_cents) / 100).toFixed(2),
    r.stripe_account_id ?? "", r.first_worked, r.last_worked,
  ].map(escape).join(","));

  const csv = [header.map(escape).join(","), ...body].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));

  const link = el("a", { href: url, download: `ptp-payroll-${from}-to-${to}.csv` });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
