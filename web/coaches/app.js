// =============================================================================
// The coaches
// =============================================================================
// Read from the trainers table, which is a public directory of active coaches
// only. A coach whose background check has lapsed is not active, and therefore
// is not on this page — which is the point of it being one query rather than a
// hand-maintained list.
// =============================================================================

import { boot } from "/shared/boot.js";
import { el, empty, errorBox, mount, spinner } from "/shared/ui.js";

export async function start(root) {
  mount(root,
    el("section", { class: "hero" }, [
      el("div", { class: "wrap" }, [
        el("span", { class: "eyebrow", text: "Who your child works with" }),
        el("h1", { text: "Meet the coaches" }),
        el("p", { class: "lede", text: "Every PTP session is run by a current college or professional player. Every coach is background-checked, and a coach whose check has lapsed does not appear here." }),
      ]),
    ]),
    el("div", { class: "hero-rule" }),
    el("div", { id: "list" }),
  );

  const host = document.querySelector("#list");
  mount(host, el("div", { class: "wrap section" }, [spinner("Loading coaches…")]));

  const api = await boot();

  let coaches;
  try {
    coaches = await api.trainers();
  } catch (error) {
    mount(host, el("div", { class: "wrap section" }, [errorBox(error)]));
    return;
  }

  mount(host, el("div", { class: "wrap section" }, [
    coaches.length === 0
      ? empty("Coach profiles are on their way.")
      : el("div", { class: "grid grid-3" }, coaches.map((coach) =>
          el("article", { class: "tile" }, [
            coach.photo_url ? el("img", { src: coach.photo_url, alt: coach.display_name,
                                          class: "mb-4" }) : null,
            el("h3", { text: coach.display_name }),
            el("p", { class: "meta", text: coach.bio }),
            el("a", { class: "button block mt-4",
                      href: "/private-training/", text: "Book with a coach" }),
          ]))),
    el("div", { class: "card-inverse", style: "margin-top:var(--s7)" }, [
      el("h3", { text: "Play in college or professionally?" }),
      el("p", { class: "meta", text: "We are always looking for players who can coach. Sessions are paid by the scheduled hour, and the schedule is built in blocks so you are not driving across the county for one hour of work." }),
      el("a", { class: "button primary", href: "/apply-to-coach/", text: "Apply to coach" }),
    ]),
  ]));
}
