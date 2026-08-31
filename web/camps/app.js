// =============================================================================
// Camp locations
// =============================================================================
// The same list as the finder, grouped by state and city. Which page you are
// on decides the filter — /camps/pennsylvania/ is this module with a state.
// One query behind all three, so a camp cannot appear on one and not another.
// =============================================================================

import { boot } from "/shared/boot.js";
import { campSummary } from "/shared/derive.js";
import { money } from "/shared/format.js";
import { badge, el, empty, errorBox, mount, spinner } from "/shared/ui.js";

const STATE_FROM_PATH = { "/camps/pennsylvania/": "PA", "/camps/new-jersey/": "NJ" };
const STATE_NAMES = { PA: "Pennsylvania", NJ: "New Jersey" };

export async function start(root) {
  const state = STATE_FROM_PATH[location.pathname] ?? null;
  const heading = state ? `${STATE_NAMES[state]} camps` : "Camp locations";

  mount(root,
    el("section", { class: "hero" }, [
      el("div", { class: "wrap" }, [
        el("span", { class: "eyebrow", text: "Summer 2027" }),
        el("h1", { text: heading }),
        el("p", { class: "lede", text: state
          ? `Every PTP week running in ${STATE_NAMES[state]}.`
          : "Every PTP week, by state and town." }),
      ]),
    ]),
    el("div", { class: "hero-rule" }),
    el("div", { id: "list" }),
  );

  const host = document.querySelector("#list");
  mount(host, el("div", { class: "wrap section" }, [spinner("Loading camps…")]));

  const api = await boot();

  let camps;
  try {
    ({ camps } = await api.camps({ state, limit: 100 }));
  } catch (error) {
    mount(host, el("div", { class: "wrap section" }, [errorBox(error)]));
    return;
  }

  if (camps.length === 0) {
    mount(host, el("div", { class: "wrap section" }, [
      empty("Nothing scheduled here yet.", "Join the early-access list and you will hear first."),
      el("a", { class: "button primary", href: "/find-a-camp/#early-access", text: "Get early access" }),
    ]));
    return;
  }

  // Grouped by state, then town — which is how a parent thinks about where
  // they are willing to drive.
  const byState = new Map();
  for (const camp of camps.map(campSummary)) {
    if (!byState.has(camp.state)) byState.set(camp.state, new Map());
    const towns = byState.get(camp.state);
    if (!towns.has(camp.city)) towns.set(camp.city, []);
    towns.get(camp.city).push(camp);
  }

  mount(host, el("div", { class: "wrap" }, [...byState.entries()].map(([code, towns]) =>
    el("section", { class: "section" }, [
      el("h2", { text: STATE_NAMES[code] ?? code }),
      ...[...towns.entries()].map(([city, list]) =>
        el("div", { class: "mb-6" }, [
          el("h3", { text: city }),
          el("div", { class: "grid grid-2" }, list.map(campRow)),
        ])),
    ]))));
}

function campRow(camp) {
  return el("article", { class: "tile" }, [
    el("div", { class: "card-row" }, [
      el("div", {}, [
        el("h3", { text: camp.date_range }),
        el("p", { class: "meta", text: `${camp.field_name} · ${camp.daily_hours}` }),
        el("p", { class: "meta", text: `Ages ${camp.min_age}–${camp.max_age} · from ${camp.from_price_cents ? money(camp.from_price_cents) : "—"}` }),
      ]),
      badge(camp.action === "waitlist" ? "Waitlist"
            : camp.status === "limited" ? `${camp.spots_left} left` : "Open",
            camp.action === "waitlist" ? "full" : camp.status === "limited" ? "nearly" : "open"),
    ]),
    el("a", { class: "button block", href: `/camp/?c=${camp.slug}`, class: "mt-4", text: "Details" }),
  ]);
}
