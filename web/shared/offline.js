// =============================================================================
// When we cannot be reached
// =============================================================================
// Every page that loads data can fail to load it: the connection drops, the
// CDN is slow, Supabase is having a morning. The first version of this printed
// one unstyled sentence into an empty page — no gutter, no way back, no way to
// reach a person. A parent standing in a car park deserves better than that,
// and it is the state they are most likely to see.
// =============================================================================

import { el, mount } from "./ui.js";

export function offlineView(root, { retry = null, detail = null } = {}) {
  const again = el("button", { class: "button primary", text: "Try again" });

  again.addEventListener("click", () => {
    if (retry) retry();
    else location.reload();
  });

  mount(root,
    el("section", { class: "section" }, [
      el("div", { class: "wrap" }, [
        el("span", { class: "eyebrow", text: "Not our finest moment" }),
        el("h1", { text: "We cannot load this right now" }),
        el("p", { class: "lede", text: "Your booking, your payment and your place are all safe — this is the page failing to load, not anything on your account." }),

        el("div", { class: "button-row" }, [
          again,
          el("a", { class: "button ghost", href: "/", text: "Back to the start" }),
        ]),

        el("div", { class: "tile", style: "margin-top:var(--s7);max-width:34rem" }, [
          el("h3", { text: "If it keeps happening" }),
          el("p", { class: "meta", text: "Text us and we will book you in over the phone. We would rather do that than have you keep refreshing." }),
        ]),

        detail ? el("p", { class: "meta", style: "margin-top:var(--s6)", text: detail }) : null,
      ]),
    ]),
  );
}
