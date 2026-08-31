// =============================================================================
// Find a camp
// =============================================================================
// One search, four ways in: a ZIP with a radius, a state, a city, or nothing
// at all. All of them go through camps_near() in the database, so the list a
// parent sees here is the same list the state page and the AI agent see.
//
// A camp that is full stays in the results. Hiding the week a family wanted is
// how they conclude PTP does not run near them.
// =============================================================================

import { boot } from "/shared/boot.js";
import { campSummary } from "/shared/derive.js";
import { money } from "/shared/format.js";
import { badge, el, empty, errorBox, field, mount, spinner, toast } from "/shared/ui.js";

const RADII = [10, 25, 40, 60, 100];

export async function start(root) {
  const params = new URLSearchParams(location.search);

  const state = {
    zip: params.get("zip") ?? "",
    radius: Number(params.get("radius") ?? 40),
    us: params.get("state") ?? "",
    age: params.get("age") ? Number(params.get("age")) : null,
    dayOption: params.get("day") ?? "",
  };

  mount(root,
    el("section", { class: "hero" }, [
      el("div", { class: "wrap" }, [
        el("span", { class: "eyebrow", text: "Summer 2027" }),
        el("h1", { text: "Find a camp" }),
        el("p", { class: "lede", text: "Five-day camps across Pennsylvania and New Jersey for players ages 6–14." }),
      ]),
    ]),
    el("div", { class: "hero-rule" }),
    el("section", { class: "section" }, [
      el("div", { class: "wrap" }, [el("div", { id: "filters" }), el("div", { id: "results" })]),
    ]),
    interestSection(),
  );

  const api = await boot();
  mount(document.querySelector("#filters"), filters(state, () => search(api, state)));
  await search(api, state);
}

function filters(state, onSearch) {
  const zip = el("input", { type: "text", inputmode: "numeric", maxlength: "5",
                            value: state.zip, placeholder: "19401" });
  const radius = el("select", {}, RADII.map((miles) =>
    el("option", { value: String(miles), selected: miles === state.radius, text: `${miles} miles` })));
  const us = el("select", {}, [
    el("option", { value: "", text: "Any state" }),
    el("option", { value: "PA", selected: state.us === "PA", text: "Pennsylvania" }),
    el("option", { value: "NJ", selected: state.us === "NJ", text: "New Jersey" }),
  ]);
  const age = el("input", { type: "number", min: "4", max: "21",
                            value: state.age ?? "", placeholder: "Any" });
  const day = el("select", {}, [
    el("option", { value: "", text: "Either" }),
    el("option", { value: "full_day", selected: state.dayOption === "full_day", text: "Full day" }),
    el("option", { value: "half_day", selected: state.dayOption === "half_day", text: "Half day" }),
  ]);

  const form = el("form", { class: "tile" }, [
    el("div", { class: "field-row" }, [field("ZIP code", zip), field("Within", radius)]),
    el("div", { class: "field-row" }, [field("State", us), field("Player age", age)]),
    field("Full or half day", day),
    el("button", { class: "button primary block", type: "submit", text: "Search" }),
  ]);

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    state.zip = zip.value.trim();
    state.radius = Number(radius.value);
    state.us = us.value;
    state.age = age.value ? Number(age.value) : null;
    state.dayOption = day.value;

    if (state.zip && !/^\d{5}$/.test(state.zip)) {
      toast("That does not look like a ZIP code.", "error");
      return;
    }

    // The search is in the URL, so a parent can send it to the other parent.
    const query = new URLSearchParams();
    if (state.zip) query.set("zip", state.zip);
    if (state.radius !== 40) query.set("radius", String(state.radius));
    if (state.us) query.set("state", state.us);
    if (state.age) query.set("age", String(state.age));
    if (state.dayOption) query.set("day", state.dayOption);
    history.replaceState(null, "", query.toString() ? `?${query}` : location.pathname);

    onSearch();
  });

  return form;
}

async function search(api, state) {
  const host = document.querySelector("#results");
  mount(host, spinner("Searching…"));

  let camps;
  try {
    ({ camps } = await api.campsNear({
      zip: state.zip || null,
      radius: state.radius,
      state: state.us || null,
      age: state.age,
      dayOption: state.dayOption || null,
    }));
  } catch (error) {
    mount(host, errorBox(error, { onRetry: () => search(api, state) }));
    return;
  }

  if (camps.length === 0) {
    mount(host, empty(
      state.zip ? `Nothing within ${state.radius} miles of ${state.zip}.` : "No camps match that.",
      "Widen the distance, or join the early-access list below and we will tell you when we are near you.",
    ));
    return;
  }

  mount(host,
    el("p", { class: "meta mt-5 mb-3",
              text: `${camps.length} camp${camps.length === 1 ? "" : "s"}${state.zip ? `, nearest first` : ""}` }),
    el("div", { class: "grid grid-2" }, camps.map((camp) => resultCard(campSummary(camp)))),
  );
}

function resultCard(camp) {
  const actions = {
    register: ["Register", "primary"],
    waitlist: ["Join the waitlist", ""],
    interest: ["Get early access", ""],
    none: null,
  }[camp.action];

  return el("article", { class: "tile" }, [
    el("div", { class: "card-row" }, [
      el("div", {}, [
        el("h3", { text: `${camp.city}, ${camp.state}` }),
        el("p", { class: "meta", text: camp.field_name }),
      ]),
      badge(statusLabel(camp), statusTone(camp)),
    ]),

    el("table", { class: "mt-4" }, [
      el("tbody", {}, [
        row("Dates", camp.date_range),
        row("Hours", camp.daily_hours),
        row("Ages", `${camp.min_age}–${camp.max_age}`),
        camp.distance_miles !== null && camp.distance_miles !== undefined
          ? row("Distance", `${camp.distance_miles} miles`)
          : null,
        row("From", camp.from_price_cents ? money(camp.from_price_cents) : "—"),
        row("Places", camp.spots_left === null ? "—" : String(camp.spots_left)),
      ]),
    ]),

    el("div", { class: "button-join mt-4" }, [
      el("a", { class: "button ghost", href: `/camp/?c=${camp.slug}`, text: "Details" }),
      actions
        ? el("a", {
            class: `button ${actions[1]}`,
            href: `/camp/?c=${camp.slug}#register`,
            text: actions[0],
          })
        : null,
    ]),
  ]);
}

function row(label, value) {
  return el("tr", {}, [el("th", { scope: "row", style: "width:38%", text: label }), el("td", { text: value })]);
}

function statusLabel(camp) {
  if (camp.status === "early_access") return "Early access";
  if (camp.action === "waitlist") return "Waitlist";
  if (camp.status === "limited") return `${camp.spots_left} left`;
  return "Open";
}

function statusTone(camp) {
  if (camp.action === "waitlist") return "full";
  if (camp.status === "limited") return "nearly";
  return "open";
}

// =============================================================================
// Early access
// =============================================================================
// Collected honestly: this is interest, and the form says so twice — once
// above the button and once in what happens after it.

function interestSection() {
  const parent = el("input", { type: "text", required: true, autocomplete: "name" });
  const phone = el("input", { type: "tel", autocomplete: "tel", placeholder: "+1 215 555 0100" });
  const email = el("input", { type: "email", required: true, autocomplete: "email" });
  const zip = el("input", { type: "text", inputmode: "numeric", maxlength: "5", required: true });
  const player = el("input", { type: "text", required: true });
  const playerAge = el("input", { type: "number", min: "4", max: "21", required: true });
  const where = el("input", { type: "text", placeholder: "Norristown, Cherry Hill…" });
  const day = el("select", {}, [
    el("option", { value: "", text: "No preference" }),
    el("option", { value: "full_day", text: "Full day" }),
    el("option", { value: "half_day", text: "Half day" }),
  ]);
  const status = el("div");

  const form = el("form", { class: "tile" }, [
    el("div", { class: "field-row" }, [field("Your name", parent), field("Email", email)]),
    el("div", { class: "field-row" }, [field("Mobile", phone), field("ZIP code", zip)]),
    el("div", { class: "field-row" }, [field("Player name", player), field("Player age", playerAge)]),
    el("div", { class: "field-row" }, [field("Preferred location", where), field("Full or half day", day)]),
    el("p", { class: "notice", text: "This is not a booking. It puts you on the list so you hear before the camps go on general sale — places are taken in the order they are paid for." }),
    status,
    el("button", { class: "button primary block", type: "submit", text: "Join the early-access list" }),
  ]);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = form.querySelector("button");
    button.disabled = true;

    try {
      const api = await boot();
      await api.registerInterest({
        parent_name: parent.value.trim(),
        phone: phone.value.trim() || null,
        email: email.value.trim(),
        postal_code: zip.value.trim(),
        player_name: player.value.trim(),
        player_age: Number(playerAge.value),
        preferred_location: where.value.trim(),
        day_preference: day.value || null,
        season_year: 2027,
      });

      mount(status, el("div", { class: "notice", text: "You are on the list. We will message you when 2027 camps open — and again if we add one near you. It does not hold a place." }));
      form.reset();
    } catch (error) {
      mount(status, errorBox(error));
    } finally {
      button.disabled = false;
    }
  });

  return el("section", { class: "section inverse", id: "early-access" }, [
    el("div", { class: "wrap" }, [
      el("span", { class: "eyebrow", style: "color:#FCB900", text: "2027" }),
      el("h2", { text: "Early access" }),
      el("p", { class: "lede", text: "Tell us where you are and which weeks might work. You will hear first." }),
      form,
    ]),
  ]);
}
