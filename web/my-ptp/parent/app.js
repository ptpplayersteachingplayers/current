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
  badge, busy, confirmDialog, el, empty, errorBox, mount, spinner, toast,
} from "/shared/ui.js";

export async function start(root) {
  const api = await boot();

  const render = () => draw(root, api);
  api.auth.onChange(render);
  await render();
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
    const [players, bookings, credits, payments, waitlists, pending] = await Promise.all([
      api.household(),
      api.bookings(),
      api.credits(),
      api.payments(),
      api.waitlistPlaces(),
      api.pendingCheckouts(),
    ]);
    data = { players, bookings, credits, payments, waitlists, pending };
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

  mount(
    root,
    el("h1", { text: "Your family" }),
    el("p", { class: "lede", text: data.players.map((p) => p.first_name).join(", ") || "No children on your account yet." }),

    ...pendingCards(data.pending, api, root, pollsLeft),
    nextCard(next),
    ...invitations(data.waitlists, api, root),
    creditsCard(credits),

    el("h2", { text: "Coming up" }),
    upcoming.length === 0
      ? empty("Nothing booked yet.", "Browse the groups to find a session that fits.")
      : el("div", {}, upcoming.map((b) => bookingCard(b, api, root, now))),

    el("h2", { text: "Sessions so far" }),
    past.length === 0 ? empty("Nothing yet.") : el("div", {}, past.map((b) => pastCard(b, api))),

    el("h2", { text: "Payments" }),
    data.payments.length === 0
      ? empty("No payments yet.")
      : el("div", {}, data.payments.map((p) => paymentCard(p, api))),

    el("p", { class: "meta" }, [
      el("button", { class: "link", text: "Sign out", onclick: () => api.auth.signOut() }),
    ]),
  );
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
