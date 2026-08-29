// =============================================================================
// Booking
// =============================================================================
// The public page. Browse the groups, pick a child, pay.
//
// This file never sees a price it did not receive from the server, and never
// sends one. /checkout prices the purchase, takes a hold, and returns a Stripe
// client secret; the payment form is Stripe's own. Between the tap and the
// confirmation, the parent's spot is held for fifteen minutes — which is why
// this page says so rather than leaving them guessing.
// =============================================================================

import { groupCard } from "/shared/derive.js";
import { money } from "/shared/format.js";
import { checkoutKey, clearCheckoutKey } from "/shared/api.js";
import { boot } from "/shared/boot.js";
import { config } from "/config.js";
import { signInView } from "/shared/signin.js";
import {
  badge, busy, el, empty, errorBox, field, mount, spinner, toast,
} from "/shared/ui.js";

export async function start(root) {
  const api = await boot();
  const state = {
    view: "browse", groupId: null, playerId: null,
    stripePublishableKey: config.stripePublishableKey,
  };

  const render = () => draw(root, api, state);
  api.auth.onChange(render);
  await render();
}

async function draw(root, api, state) {
  mount(root, spinner("Loading the season…"));

  let catalog;
  try {
    catalog = await api.catalog(state.playerId);
  } catch (error) {
    mount(root, errorBox(error, { onRetry: () => draw(root, api, state) }));
    return;
  }

  const user = await api.auth.current();
  const players = user ? await api.household().catch(() => []) : [];

  if (state.view === "checkout") {
    await drawCheckout(root, api, state, catalog, players);
    return;
  }

  const season = catalog.seasons?.[0];

  mount(
    root,
    el("h1", { text: season?.name ?? "Training" }),
    el("p", {
      class: "lede",
      text: seasonLede(season, catalog.package),
    }),

    user ? playerPicker(players, state, () => draw(root, api, state)) : null,

    (catalog.groups ?? []).length === 0
      ? empty("No groups are open yet.", "We open the next season a few weeks before it starts.")
      : el(
          "div",
          {},
          (catalog.groups ?? []).map((group) => groupRow(group, api, state, root, user)),
        ),

    user
      ? null
      : el("div", { class: "card" }, [
          el("h3", { text: "Sign in to book" }),
          signInView(api, { heading: "Your PTP account", note: "One account for the whole family." }),
        ]),
  );
}

// Every number in this sentence came from the server. If the catalogue does
// not carry a price, the page says less rather than guessing.
function seasonLede(season, pkg) {
  if (!season) return "Groups open shortly.";

  const shape = `${season.weeks} weeks, twice a week.`;
  if (!pkg?.price_cents) return shape;

  const sessions = pkg.sessions ? `${pkg.sessions} sessions` : "the season";
  return `${shape} ${money(pkg.price_cents)} for ${sessions}.`;
}

function playerPicker(players, state, rerender) {
  if (players.length === 0) {
    return el("div", { class: "notice", text: "Add a child to your account before booking." });
  }

  const select = el(
    "select",
    {},
    [el("option", { value: "", text: "Who is this for?" })].concat(
      players.map((p) =>
        el("option", { value: p.id, selected: p.id === state.playerId, text: `${p.first_name} ${p.last_name}` }),
      ),
    ),
  );

  select.addEventListener("change", () => {
    state.playerId = select.value || null;
    // Re-fetching the catalogue with a player id gets eligibility per group,
    // so a family is told what fits before they choose rather than after.
    rerender();
  });

  return field("Booking for", select);
}

function groupRow(group, api, state, root, user) {
  const card = groupCard(group, group.occupancy);
  const ineligible = state.playerId && group.eligible === false;

  const book = el("button", {
    class: "button small",
    text: group.status === "full" ? "Join the waitlist" : "Book the season",
    disabled: !user || !state.playerId || ineligible,
  });

  book.addEventListener(
    "click",
    busy(book, async () => {
      if (group.status === "full") {
        try {
          await api.actions.joinWaitlist({ groupId: group.id, playerId: state.playerId });
          toast("You are on the list. We will message you the moment a place opens.");
        } catch (error) {
          toast(error.message, "error");
        }
        return;
      }

      state.view = "checkout";
      state.groupId = group.id;
      draw(root, api, state);
    }),
  );

  return el("div", { class: "card" }, [
    el("div", { class: "card-row" }, [
      el("div", {}, [
        el("h3", { text: card.name }),
        el("p", { class: "meta", text: `${card.ages} · ${card.meets}` }),
        el("p", { class: "meta", text: [card.place, card.trainer].filter(Boolean).join(" · ") }),
      ]),
      // A short pill, and the sentence on its own line below — a badge wide
      // enough for "One more family and this group starts" pushes a 390px
      // phone sideways.
      badge(card.pill, card.tone),
    ]),
    el("p", { class: `status status-${card.tone}`, text: card.status }),
    ineligible
      ? el("p", {
          class: "notice",
          text: "This group is outside the age or level band for the child you picked.",
        })
      : null,
    el("div", { class: "card-row" }, [
      el("p", { class: "meta", text: card.dropIn ? `Drop-in ${card.dropIn}` : "" }),
      book,
    ]),
  ]);
}

async function drawCheckout(root, api, state, catalog, players) {
  const group = (catalog.groups ?? []).find((g) => g.id === state.groupId);
  const player = players.find((p) => p.id === state.playerId);

  mount(root, spinner("Holding your place…"));

  let checkout;
  try {
    checkout = await api.actions.startCheckout({
      kind: "group_package",
      playerId: state.playerId,
      targetId: state.groupId,
      // Survives a reload, so refreshing mid-payment resumes the same
      // purchase rather than starting a second one.
      idempotencyKey: checkoutKey("group_package", state.playerId, state.groupId),
    });
  } catch (error) {
    mount(
      root,
      errorBox(error),
      el("button", {
        class: "button ghost",
        text: "Back to the groups",
        onclick: () => {
          state.view = "browse";
          draw(root, api, state);
        },
      }),
    );
    return;
  }

  if (checkout.status === "already_paid") {
    clearCheckoutKey("group_package", state.playerId, state.groupId);
    mount(root, el("div", { class: "card hero" }, [
      el("h3", { text: "Already paid" }),
      el("p", { class: "detail", text: "This one is booked. It is in your account." }),
    ]));
    return;
  }

  const paymentSlot = el("div", { id: "payment-element" });
  const pay = el("button", { class: "button block", text: `Pay ${money(checkout.amount_cents)}` });
  const errors = el("div");

  mount(
    root,
    el("button", {
      class: "link",
      text: "← Back to the groups",
      onclick: () => {
        state.view = "browse";
        draw(root, api, state);
      },
    }),
    el("h1", { text: group?.name ?? "Your place" }),
    el("p", { class: "lede", text: player ? `For ${player.first_name}` : "" }),

    el("div", { class: "card" }, [
      el("div", { class: "card-row" }, [
        el("div", {}, [
          el("h3", { text: "Season package" }),
          el("p", { class: "meta", text: catalog.package?.sessions ? `${catalog.package.sessions} sessions` : "" }),
        ]),
        el("p", { class: "figure", text: money(checkout.amount_cents) }),
      ]),
    ]),

    holdNotice(checkout, { onExpiry: () => { state.view = "browse"; draw(root, api, state); } }),

    errors,
    el("div", { class: "card" }, [paymentSlot, pay]),
  );

  await mountStripe({ checkout, paymentSlot, pay, errors, state, api });
}

// The hold is a real row with a real expiry, and the parent can see it run
// down. The number is the server's — expire_booking_holds() releases the spot
// on its own schedule, and a countdown that disagreed with it would be worse
// than none.
function holdNotice(checkout, { onExpiry }) {
  const node = el("p", { class: "notice" });

  const tick = () => {
    const remaining = new Date(checkout.expires_at) - Date.now();

    if (remaining <= 0) {
      node.textContent =
        "Your fifteen minutes are up, so the place has gone back on the board. Nothing was charged. Start again and it is probably still there.";
      clearInterval(timer);
      // Back to the groups after a beat, rather than leaving a dead payment
      // form on the screen.
      setTimeout(onExpiry, 4000);
      return;
    }

    const minutes = Math.floor(remaining / 60_000);
    const seconds = String(Math.floor((remaining % 60_000) / 1000)).padStart(2, "0");

    node.textContent =
      `Your place is held for ${minutes}:${seconds} while you pay. ` +
      "If something goes wrong, nothing is charged and the place goes back on the board.";
  };

  const timer = setInterval(tick, 1000);
  tick();

  return node;
}

// Stripe's own form, in Stripe's own iframe. Card details never touch this
// page, which is the whole reason for using it.
async function mountStripe({ checkout, paymentSlot, pay, errors, state, api }) {
  const publishable = checkout.publishable_key ?? state.stripePublishableKey;

  if (!globalThis.Stripe || !publishable) {
    mount(
      errors,
      errorBox(new Error("The payment form could not load. Please refresh, or ring us and we will take it over the phone.")),
    );
    pay.disabled = true;
    return;
  }

  const stripe = globalThis.Stripe(publishable);
  const elements = stripe.elements({ clientSecret: checkout.client_secret });
  elements.create("payment").mount(paymentSlot);

  pay.addEventListener(
    "click",
    busy(pay, async () => {
      mount(errors);

      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: new URL("/my-ptp/parent/", location.href).href },
      });

      // Only reached when the payment did not proceed; a success navigates
      // away. Even then the booking is made by the webhook, not by that
      // redirect — a parent who closes the tab still gets their place.
      if (error) mount(errors, errorBox(error));
      else clearCheckoutKey("group_package", state.playerId, state.groupId);
    }),
  );
}
