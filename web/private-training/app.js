// =============================================================================
// Private training
// =============================================================================
// The board only ever shows times a coach can actually work. A slot appears
// here when it joins existing work — a confirmed group before or after it, or
// another paid private on the same day. A single isolated hour at a field
// forty minutes away is not offered at all.
//
// Where a slot is the first of a weekend block, the page says so plainly: the
// time is theirs subject to one more booking, and they are told that before
// they pay rather than after.
// =============================================================================

import { boot } from "/shared/boot.js";
import { checkoutKey, clearCheckoutKey } from "/shared/api.js";
import { dateAndTime, money, time } from "/shared/format.js";
import { signInView } from "/shared/signin.js";
import { badge, busy, el, empty, errorBox, field, mount, spinner, toast } from "/shared/ui.js";

export async function start(root) {
  mount(root,
    el("section", { class: "hero" }, [
      el("div", { class: "wrap" }, [
        el("span", { class: "eyebrow", text: "One player, one coach" }),
        el("h1", { text: "Private training" }),
        el("p", { class: "lede", text: "Weekend sessions with a current college or professional player. What you see below is what a coach can genuinely work — nothing is listed that would send them out for a single isolated hour." }),
      ]),
    ]),
    el("div", { class: "hero-rule" }),
    el("div", { id: "board" }),
  );

  const host = document.querySelector("#board");
  mount(host, el("div", { class: "wrap section" }, [spinner("Loading availability…")]));

  const api = await boot();
  const state = { playerId: null };

  const render = async () => {
    const user = await api.auth.current();
    const players = user ? await api.household().catch(() => []) : [];

    let slots;
    try {
      slots = await api.privateSlots();
    } catch (error) {
      mount(host, el("div", { class: "wrap section" }, [errorBox(error)]));
      return;
    }

    mount(host, el("div", { class: "wrap section" }, [
      user
        ? players.length === 0
          ? el("div", { class: "notice", text: "Add a child to your account before booking." })
          : playerPicker(players, state, () => render())
        : null,

      slots.length === 0
        ? empty("No private sessions are open at the moment.",
                "They open as group blocks are confirmed. Message us and we will tell you when one fits.")
        : el("div", {}, byDay(slots, api).map(([day, list]) =>
            el("div", { class: "mb-6" }, [
              el("h3", { text: day }),
              el("div", { class: "grid grid-2" },
                list.map((slot) => slotCard(slot, api, state, user, players))),
            ]))),

      user ? null : el("div", { class: "card mt-5" }, [
        el("h3", { text: "Sign in to book" }),
        signInView(api, { heading: "Your PTP account", note: "One account for the whole family." }),
      ]),
    ]));
  };

  api.auth.onChange(render);
  await render();
}

function playerPicker(players, state, rerender) {
  const select = el("select", {}, [
    el("option", { value: "", text: "Who is this for?" }),
    ...players.map((p) =>
      el("option", { value: p.id, selected: p.id === state.playerId, text: `${p.first_name} ${p.last_name}` })),
  ]);

  select.addEventListener("change", () => {
    state.playerId = select.value || null;
    rerender();
  });

  return el("div", { class: "card mb-5" }, [field("Booking for", select)]);
}

function byDay(slots, api) {
  const days = new Map();

  for (const slot of slots) {
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: api.timeZone, weekday: "long", day: "numeric", month: "long",
    }).format(new Date(slot.starts_at));

    if (!days.has(label)) days.set(label, []);
    days.get(label).push(slot);
  }

  return [...days.entries()];
}

function slotCard(slot, api, state, user, players) {
  const book = el("button", {
    class: "button primary block",
    disabled: !user || !state.playerId,
    text: `Book ${money(slot.price_cents)}`,
  });

  book.addEventListener("click", busy(book, async () => {
    try {
      const checkout = await api.actions.startCheckout({
        kind: "private",
        playerId: state.playerId,
        targetId: slot.slot_id,
        idempotencyKey: checkoutKey("private", state.playerId, slot.slot_id),
      });

      if (checkout.status === "already_paid") {
        clearCheckoutKey("private", state.playerId, slot.slot_id);
        toast("That one is already booked and in your account.");
        return;
      }

      sessionStorage.setItem("ptp.private.checkout", JSON.stringify({ checkout, slotId: slot.slot_id }));
      location.href = `/private-training/pay/?slot=${slot.slot_id}`;
    } catch (error) {
      toast(error.message, "error");
    }
  }));

  return el("article", { class: "card" }, [
    el("div", { class: "card-row" }, [
      el("div", {}, [
        el("h3", { text: `${time(slot.starts_at, api.timeZone)}–${time(slot.ends_at, api.timeZone)}` }),
        el("p", { class: "meta", text: slot.trainer_name }),
        el("p", { class: "meta", text: slot.location_name ?? "Location confirmed on booking" }),
      ]),
      badge(slot.joins_existing_work ? "Confirmed block" : "Needs one more", 
            slot.joins_existing_work ? "open" : "nearly"),
    ]),

    // Said before they pay, not after. The family's time is theirs either way;
    // what is uncertain is whether the block goes ahead, and pretending
    // otherwise is how a Saturday gets cancelled on someone.
    slot.joins_existing_work
      ? null
      : el("p", { class: "notice mt-4",
                  text: "This is the first session of the day. Your time is held either way — the block is confirmed once a second family books alongside you, and we tell you the moment it is." }),

    el("div", { class: "mt-4" }, [book]),
  ]);
}
