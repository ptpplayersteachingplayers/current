// =============================================================================
// Paying for a private session
// =============================================================================
// Separated from the board so the payment screen is one thing on one page. The
// checkout was created before the redirect, so the hold is already running and
// the countdown here is the server's own expiry.
// =============================================================================

import { clearCheckoutKey } from "/shared/api.js";
import { boot } from "/shared/boot.js";
import { money } from "/shared/format.js";
import { el, errorBox, empty, mount } from "/shared/ui.js";

export async function start(root) {
  const stored = sessionStorage.getItem("ptp.private.checkout");

  if (!stored) {
    mount(root, el("div", { class: "wrap section" }, [
      empty("Nothing to pay for.", "Pick a time from the board and we will hold it while you pay."),
      el("a", { class: "button primary", href: "/private-training/", text: "See what is open" }),
    ]));
    return;
  }

  const { checkout, slotId } = JSON.parse(stored);
  const api = await boot();

  const slot = el("div", { id: "payment-element" });
  const pay = el("button", { class: "button primary block", text: `Pay ${money(checkout.amount_cents)}` });
  const errors = el("div");
  const notice = el("p", { class: "notice" });

  mount(root, el("section", { class: "section" }, [
    el("div", { class: "wrap" }, [
      el("h1", { text: "Confirm your session" }),
      el("div", { class: "card card-inverse" }, [
        el("div", { class: "card-row" }, [
          el("div", {}, [el("h3", { text: "Private session" }), el("p", { class: "meta", text: "One hour, one coach" })]),
          el("p", { class: "figure", text: money(checkout.amount_cents) }),
        ]),
      ]),
      notice,
      errors,
      el("div", { class: "card" }, [slot, pay]),
    ]),
  ]));

  countdown(notice, checkout.expires_at, () => { location.href = "/private-training/"; });

  if (!globalThis.Stripe || !checkout.publishable_key) {
    mount(errors, errorBox(new Error("The payment form could not load. Please refresh, or ring us and we will take it over the phone.")));
    pay.disabled = true;
    return;
  }

  const stripe = globalThis.Stripe(checkout.publishable_key);
  const elements = stripe.elements({ clientSecret: checkout.client_secret });
  elements.create("payment").mount(slot);

  pay.addEventListener("click", async () => {
    pay.disabled = true;
    mount(errors);

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: new URL("/my-ptp/parent/", location.href).href },
    });

    if (error) {
      mount(errors, errorBox(error));
      pay.disabled = false;
    } else {
      sessionStorage.removeItem("ptp.private.checkout");
      clearCheckoutKey("private", null, slotId);
    }
  });
}

function countdown(node, expiresAt, onExpiry) {
  const tick = () => {
    const remaining = new Date(expiresAt) - Date.now();

    if (remaining <= 0) {
      node.textContent = "Your fifteen minutes are up, so the time has gone back on the board. Nothing was charged.";
      clearInterval(timer);
      setTimeout(onExpiry, 4000);
      return;
    }

    const minutes = Math.floor(remaining / 60_000);
    const seconds = String(Math.floor((remaining % 60_000) / 1000)).padStart(2, "0");
    node.textContent = `Your time is held for ${minutes}:${seconds} while you pay. If something goes wrong, nothing is charged and the time goes back on the board.`;
  };

  const timer = setInterval(tick, 1000);
  tick();
}
