// =============================================================================
// Parent portal
// =============================================================================
// What a parent needs, in the order they need it: when is the next session,
// how many sessions are left, and how do I change something.
//
// The page holds no rules. Every price, every capacity decision, every refund
// is the server's. Where this file appears to know a rule — the cancellation
// warning — it is repeating what the server told it in system_settings, and
// the server decides again when the tap comes.
// =============================================================================

import { canCancel, creditSummary, nextSession } from "/shared/derive.js";
import { dateAndTime, money, whenLabel } from "/shared/format.js";
import { boot } from "/shared/boot.js";
import { signInView } from "/shared/signin.js";
import {
  badge, busy, confirmDialog, el, empty, errorBox, field, mount, spinner, toast,
} from "/shared/ui.js";

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

// pollsLeft is how many more quiet refreshes a pending payment gets before the
// screen stops waiting and says so. Polling forever would keep a spinner on a
// screen that is never going to change.
async function draw(root, api, { pollsLeft = 5 } = {}) {
  mount(root, spinner("Loading your account…"));

  const user = await api.auth.current();

  if (!user) {
    mount(
      root,
      signInView(api, {
        heading: "Your PTP account",
        note: "Sessions, credits and payments for your family.",
      }),
    );
    return;
  }

  let data;
  try {
    const [players, bookings, credits, payments, waitlists, pending, camps, thread, contacts] =
      await Promise.all([
        api.household(),
        api.bookings(),
        api.credits(),
        api.payments(),
        api.waitlistPlaces(),
        api.pendingCheckouts(),
        api.myCampRegistrations().catch(() => []),
        api.thread().catch(() => null),
        api.contacts().catch(() => []),
      ]);
    data = { players, bookings, credits, payments, waitlists, pending, camps, thread, contacts };
  } catch (error) {
    mount(root, errorBox(error, { onRetry: () => draw(root, api) }));
    return;
  }

  const now = new Date();
  const next = nextSession(data.bookings, { timeZone: api.timeZone, now });
  const credits = creditSummary(data.credits, { timeZone: api.timeZone, now });

  const upcoming = data.bookings
    .filter((b) => b.status === "confirmed" && b.session && new Date(b.session.starts_at) > now)
    .sort((a, b) => new Date(a.session.starts_at) - new Date(b.session.starts_at));

  const past = data.bookings
    .filter((b) => b.session && (new Date(b.session.starts_at) <= now || b.status === "attended"))
    .slice(0, 10);

  const views = {
    home: () => [
      el("h1", { text: "Your family" }),
      el("p", { class: "lede", text: data.players.map((p) => p.first_name).join(", ") || "No children on your account yet." }),

      ...pendingCards(data.pending, api, root, pollsLeft),
      nextCard(next),
      ...invitations(data.waitlists, api, root),
      creditsCard(credits),

      el("h2", { class: "section-label", text: "Coming up" }),
      upcoming.length === 0
        ? empty("Nothing booked yet.", "Browse the groups to find a session that fits.")
        : el("div", {}, upcoming.slice(0, 3).map((b) => bookingCard(b, api, root, now))),

      upcoming.length > 3
        ? el("a", { class: "button block mt-5", href: "#schedule",
                    text: `See all ${upcoming.length} sessions` })
        : null,

      el("h2", { class: "section-label", text: "Book something" }),
      el("div", { class: "stack" }, [
        el("a", { class: "button primary block", href: "/find-a-camp/", text: "Find a camp" }),
        el("a", { class: "button block", href: "/group-training/", text: "Book group training" }),
        el("a", { class: "button block", href: "/private-training/", text: "Book private training" }),
      ]),
    ],

    schedule: () => [
      el("h1", { text: "Schedule" }),
      el("p", { class: "lede", text: "Everything booked, soonest first." }),

      el("h2", { class: "section-label", text: "Coming up" }),
      upcoming.length === 0
        ? empty("Nothing booked yet.", "Browse the groups to find a session that fits.")
        : el("div", {}, upcoming.map((b) => bookingCard(b, api, root, now))),

      el("h2", { class: "section-label", text: "Camps" }),
      data.camps.length === 0
        ? empty("No camps booked.", "The 2027 weeks are open now.")
        : el("div", {}, data.camps.map((r) => campCard(r, api))),

      el("h2", { class: "section-label", text: "Sessions so far" }),
      past.length === 0 ? empty("Nothing yet.") : el("div", {}, past.map((b) => pastCard(b, api))),
    ],

    messages: () => [
      el("h1", { text: "Messages" }),
      el("p", { class: "lede", text: "The same thread as your texts. Anything about an injury, a payment or a complaint goes straight to a person." }),
      messageThread(data.thread, api, root),
    ],

    account: () => [
      el("h1", { text: "Account" }),

      el("h2", { class: "section-label", text: "Players" }),
      data.players.length === 0
        ? empty("No children on your account yet.")
        : el("div", {}, data.players.map((p) =>
            el("div", { class: "card" }, [
              el("h3", { text: `${p.first_name} ${p.last_name}` }),
              el("p", { class: "meta", text: p.birth_date ? `Born ${p.birth_date}` : "No birthday on file" }),
              el("p", { class: "meta", text: p.club_team || "No club recorded" }),
            ]))),

      el("h2", { class: "section-label", text: "Who we contact" }),
      el("div", {}, (data.contacts ?? []).map((c) =>
        el("div", { class: "card" }, [
          el("h3", { text: `${c.first_name} ${c.last_name}`.trim() || "Contact" }),
          el("p", { class: "meta", text: c.email ?? "" }),
          el("p", { class: "meta", text: c.phone ?? "" }),
          el("p", { class: "meta", text: consentLine(c) }),
        ]))),

      el("p", { class: "notice", text: "Reply STOP to any text and we stop immediately — everything, on every channel, straight away." }),

      el("h2", { class: "section-label", text: "Payments" }),
      data.payments.length === 0
        ? empty("No payments yet.")
        : el("div", {}, data.payments.map((p) => paymentCard(p, api))),

      el("div", { class: "mt-7" }, [
        el("button", { class: "button ghost", text: "Sign out", onclick: () => api.auth.signOut() }),
      ]),
    ],
  };

  mount(root, ...(views[tab()] ?? views.home)());
}

function consentLine(contact) {
  const on = [contact.sms_consent && "texts", contact.email_consent && "email"].filter(Boolean);
  return on.length ? `We may send you ${on.join(" and ")}.` : "We do not message you.";
}

function campCard(registration, api) {
  const camp = registration.camps ?? {};

  return el("div", { class: "card" }, [
    el("div", { class: "card-row" }, [
      el("div", {}, [
        el("h3", { text: camp.name ?? "Camp" }),
        el("p", { class: "meta", text: `${camp.city ?? ""} · ${camp.field_name ?? ""}` }),
        el("p", { class: "meta", text: camp.starts_on ? `${camp.starts_on} to ${camp.ends_on}` : "" }),
      ]),
      el("div", {}, [
        el("p", { class: "meta", text: registration.players?.first_name ?? "" }),
        badge(registration.day_option === "half_day" ? "Half day" : "Full day", "neutral"),
      ]),
    ]),
  ]);
}

// The thread, oldest first, with the family's own messages marked. Sending
// writes an inbound message the agent picks up — the same path a text takes.
function messageThread(thread, api, root) {
  // A parent with no thread cannot start one from here: conversations are
  // opened by the inbound webhook, and RLS gives a family read access to their
  // own thread rather than the ability to create one. So the empty state points
  // at the thing that does work rather than at a box that would fail.
  if (!thread?.conversation) {
    return el("div", {}, [
      empty("No messages yet.", "Text us and the conversation will appear here — the same thread, on this screen and on your phone."),
      el("a", { class: "button primary mt-5", href: "/contact/", text: "How to reach us" }),
    ]);
  }

  const box = el("textarea", { rows: "3", placeholder: "Ask us anything" });
  const send = el("button", { class: "button primary", text: "Send" });

  send.addEventListener("click", busy(send, async () => {
    const body = box.value.trim();
    if (!body) return;

    try {
      await api.sendMessage(thread.conversation.id, body);
      box.value = "";
      toast("Sent.");
      draw(root, api);
    } catch (error) {
      toast(error.message, "error");
    }
  }));

  return el("div", {}, [
    thread.conversation.human_owned
      ? el("p", { class: "notice", text: "One of the team is on this thread." })
      : null,

    el("div", { class: "stack mb-6" }, thread.messages.map((m) =>
      el("div", { class: m.direction === "inbound" ? "card message-mine" : "card" }, [
        el("p", { class: "meta flush", text: m.direction === "inbound" ? "You" : "PTP" }),
        el("p", { class: "flush", text: m.body }),
      ]))),

    el("div", {}, [field("Reply", box), send]),
  ]);
}

// The seconds between Stripe taking the money and the webhook creating the
// booking. Short, but a parent who has just been charged and sees nothing on
// this screen has every reason to pay a second time — so say what is
// happening, and check again without being asked.
function pendingCards(pending, api, root, pollsLeft) {
  if (pending.length === 0) return [];

  const waiting = pollsLeft > 0;
  if (waiting) {
    setTimeout(() => draw(root, api, { pollsLeft: pollsLeft - 1 }), 4000);
  }

  return pending.map((intent) =>
    el("div", { class: "card pending" }, [
      badge("Payment received", "nearly"),
      el("h3", { text: intent.training_groups?.name ?? "Your booking" }),
      el("p", {
        class: "meta",
        text: waiting
          ? `${money(intent.amount_cents)} paid. We are confirming your place — this takes a moment, and you do not need to pay again.`
          : `${money(intent.amount_cents)} paid, and we have it. The booking is taking longer than usual to appear — give us a ring and we will sort it out. Please do not pay again.`,
      }),
      waiting
        ? el("div", { class: "loading" }, [
            el("span", { class: "spinner", "aria-hidden": "true" }),
            el("span", { text: "Confirming" }),
          ])
        : null,
    ]),
  );
}

function nextCard(next) {
  if (!next) {
    return el("div", { class: "card card-inverse" }, [
      el("h3", { text: "Nothing booked" }),
      el("p", { class: "meta", text: "When you book a session it will show up here." }),
    ]);
  }

  return el("div", { class: "card card-inverse" }, [
    el("span", { class: "eyebrow", style: "color:#FCB900", text: next.isToday ? "Training today" : "Next session" }),
    el("h3", { text: next.headline }),
    el("p", { class: "meta", text: next.place }),
  ]);
}

function creditsCard(summary) {
  return el("div", { class: "card" }, [
    el("div", { class: "figure-pair" }, [
      el("p", { class: "figure", text: String(summary.available) }),
      el("p", { class: "figure-label", text: summary.available === 1 ? "session left" : "sessions left" }),
    ]),
    summary.note ? el("p", { class: "meta", text: summary.note }) : null,
  ]);
}

// A waitlist offer has a clock on it, so it goes above everything except the
// next session — a family who misses the window loses the place to the next
// family, and that should never be a surprise.
function invitations(waitlists, api, root) {
  return waitlists
    .filter((w) => w.state === "invited")
    .map((w) => {
      const accept = el("button", { class: "button", text: "Take the place" });
      const decline = el("button", { class: "button ghost small", text: "No thanks" });

      accept.addEventListener(
        "click",
        busy(accept, async () => {
          try {
            const { checkout_intent } = await api.actions.acceptWaitlist({
              waitlistId: w.id,
              idempotencyKey: `waitlist-${w.id}`,
            });
            location.href = `/group-training/?checkout=${checkout_intent.id}`;
          } catch (error) {
            toast(error.message, "error");
          }
        }),
      );

      decline.addEventListener(
        "click",
        busy(decline, async () => {
          await api.actions.declineWaitlist({ waitlistId: w.id });
          toast("Thanks — we have passed the place on.");
          draw(root, api);
        }),
      );

      return el("div", { class: "card" }, [
        badge("A place has opened", "nearly"),
        el("h3", { text: w.training_groups?.name ?? "Your waitlisted group" }),
        el("p", {
          class: "meta",
          text: w.invite_expires_at
            ? `Yours until ${dateAndTime(w.invite_expires_at, api.timeZone)}, then it goes to the next family.`
            : "Take it whenever you are ready.",
        }),
        el("div", { class: "sheet-actions" }, [decline, accept]),
      ]);
    });
}

function bookingCard(booking, api, root, now) {
  const outlook = canCancel(booking, { freeCancelHours: api.freeCancelHours, now });
  const cancel = el("button", { class: "button ghost small", text: "Cancel" });

  cancel.addEventListener(
    "click",
    busy(cancel, async () => {
      const confirmed = await confirmDialog({
        title: `Cancel ${booking.player?.first_name ?? "this session"}?`,
        body: [whenLabel(booking.session.starts_at, api.timeZone, now), outlook.reason],
        confirmLabel: "Yes, cancel it",
      });

      if (!confirmed) return;

      try {
        // The server decides the refund, not the sentence above. If they
        // disagree, this is the one that counts.
        const result = await api.actions.cancelBooking({ bookingId: booking.id, reason: "parent" });

        toast(
          result.refunded
            ? `Cancelled. ${money(result.amount_cents)} is on its way back.`
            : result.refund_due
            ? "Cancelled. Your credit is back in your account."
            : "Cancelled.",
        );

        draw(root, api);
      } catch (error) {
        toast(error.message, "error");
      }
    }),
  );

  return el("div", { class: "card" }, [
    el("div", { class: "card-row" }, [
      el("div", {}, [
        el("h3", { text: booking.session.group?.name ?? "Private session" }),
        el("p", { class: "meta", text: whenLabel(booking.session.starts_at, api.timeZone, now) }),
        el("p", { class: "meta", text: booking.session.location?.name ?? "Location to be confirmed" }),
      ]),
      el("div", {}, [
        el("p", { class: "meta", text: booking.player?.first_name ?? "" }),
        badge(booking.credit_id ? "Credit" : money(booking.price_cents), "neutral"),
      ]),
    ]),
    outlook.allowed
      ? el("div", {}, [
          !outlook.refundable ? el("p", { class: "notice", text: outlook.reason }) : null,
          cancel,
        ])
      : null,
  ]);
}

function pastCard(booking, api) {
  const tone = booking.status === "attended" ? "running" : booking.status === "canceled" ? "waitlist" : "neutral";

  return el("div", { class: "card card-row" }, [
    el("div", {}, [
      el("h3", { text: booking.session.group?.name ?? "Private session" }),
      el("p", { class: "meta", text: `${booking.player?.first_name ?? ""} · ${dateAndTime(booking.session.starts_at, api.timeZone)}` }),
    ]),
    badge(booking.status, tone),
  ]);
}

function paymentCard(payment, api) {
  const refunded = payment.refunded_cents > 0;

  return el("div", { class: "card card-row" }, [
    el("div", {}, [
      el("h3", { text: payment.description || "Payment" }),
      el("p", { class: "meta", text: dateAndTime(payment.created_at, api.timeZone) }),
    ]),
    el("div", {}, [
      el("p", { class: "figure", text: money(payment.amount_cents) }),
      refunded ? el("p", { class: "figure-label", text: `${money(payment.refunded_cents)} refunded` }) : null,
    ]),
  ]);
}
