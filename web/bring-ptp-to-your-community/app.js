// =============================================================================
// Bring PTP to your community
// =============================================================================
// For clubs, townships and schools with a field and a group of players. The
// enquiry is stored as camp interest with a preferred location, so it lands in
// the same place a parent's early-access request does and the same follow-up
// job chases it.
// =============================================================================

import { boot } from "/shared/boot.js";
import { el, errorBox, field, mount } from "/shared/ui.js";

export async function start(root) {
  const name = el("input", { type: "text", required: true, autocomplete: "name" });
  const org = el("input", { type: "text", required: true, placeholder: "Club, township or school" });
  const email = el("input", { type: "email", required: true, autocomplete: "email" });
  const phone = el("input", { type: "tel", autocomplete: "tel" });
  const zip = el("input", { type: "text", inputmode: "numeric", maxlength: "5", required: true });
  const players = el("input", { type: "number", min: "1", placeholder: "Roughly how many" });
  const notes = el("textarea", { rows: "4", placeholder: "The field, the ages, and when you were thinking" });
  const status = el("div");

  const form = el("form", { class: "card" }, [
    el("div", { class: "field-row" }, [field("Your name", name), field("Organisation", org)]),
    el("div", { class: "field-row" }, [field("Email", email), field("Phone", phone)]),
    el("div", { class: "field-row" }, [field("ZIP code", zip), field("Players you expect", players)]),
    field("Anything else", notes),
    status,
    el("button", { class: "button primary block", type: "submit", text: "Send it over" }),
  ]);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;

    try {
      const api = await boot();
      await api.registerInterest({
        parent_name: `${name.value.trim()} — ${org.value.trim()}`,
        email: email.value.trim(),
        phone: phone.value.trim() || null,
        postal_code: zip.value.trim(),
        player_name: "",
        player_age: null,
        preferred_location: org.value.trim(),
        preferred_weeks: [],
        season_year: 2027,
      });

      mount(status, el("div", { class: "notice", text: "Thank you — we will be in touch within a couple of days. If it is urgent, ring us." }));
      form.reset();
    } catch (error) {
      mount(status, errorBox(error));
    } finally {
      button.disabled = false;
    }
  });

  mount(root,
    el("section", { class: "hero" }, [
      el("div", { class: "wrap" }, [
        el("span", { class: "eyebrow", text: "For clubs, townships and schools" }),
        el("h1", { text: "Bring PTP to your community" }),
        el("p", { class: "lede", text: "If you have a field and a group of players, we will bring the coaches. We ran the PTP × Colonial clinic for 74 players and 10 coaches on exactly that basis." }),
      ]),
    ]),
    el("div", { class: "hero-rule" }),
    el("section", { class: "section" }, [
      el("div", { class: "wrap" }, [
        el("div", { class: "grid grid-2" }, [
          el("div", {}, [
            el("h2", { text: "What we bring" }),
            el("ul", {}, [
              el("li", { text: "Current college and professional players as coaches" }),
              el("li", { text: "Session plans by age and level" }),
              el("li", { text: "Equipment, bibs and goals" }),
              el("li", { text: "Insurance and background-checked staff" }),
              el("li", { text: "Registration and payment handled by us" }),
            ]),
            el("h2", { class: "mt-5", text: "What you bring" }),
            el("ul", {}, [
              el("li", { text: "A field we can be permitted on" }),
              el("li", { text: "A group of players, or a way of reaching them" }),
            ]),
          ]),
          form,
        ]),
      ]),
    ]),
  );
}
