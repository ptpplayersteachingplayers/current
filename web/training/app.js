// =============================================================================
// How training works
// =============================================================================
// The page that answers "what is the difference" before a parent has to guess.
// Every number here is read from system_settings, so it cannot fall out of step
// with what the checkout actually charges.
// =============================================================================

import { boot } from "/shared/boot.js";
import { money } from "/shared/format.js";
import { el, mount, spinner } from "/shared/ui.js";

export async function start(root) {
  mount(root, el("div", { class: "wrap section" }, [spinner()]));

  const api = await boot();

  let settings = {};
  try {
    settings = await api.settings([
      "group_package_price_cents", "group_package_sessions", "group_dropin_price_cents",
      "private_hourly_price_cents", "group_max_players", "group_min_players",
      "season_weeks", "sessions_per_week", "free_cancel_hours",
    ]);
  } catch { /* the page still renders, just without the numbers */ }

  const n = (key, fallback) => Number(settings[key] ?? fallback);

  mount(root,
    el("section", { class: "hero" }, [
      el("div", { class: "wrap" }, [
        el("span", { class: "eyebrow", text: "September to June" }),
        el("h1", { text: "How training works" }),
        el("p", { class: "lede", text: "Two ways to train year-round. Both are coached by current college and professional players, and both are built around blocks of work rather than one-off sessions." }),
      ]),
    ]),
    el("div", { class: "hero-rule" }),

    el("section", { class: "section" }, [
      el("div", { class: "wrap" }, [
        el("div", { class: "grid grid-2" }, [
          el("div", { class: "card" }, [
            el("h3", { text: "Group training" }),
            el("p", { class: "meta", text: `${n("season_weeks", 8)} weeks, ${n("sessions_per_week", 2)} sessions a week, ${n("group_package_sessions", 16)} sessions in all.` }),
            el("p", { class: "figure", style: "margin:14px 0 0", text: money(n("group_package_price_cents", 56000)) }),
            el("p", { class: "figure-label", text: "for the season" }),
            el("p", { class: "meta", style: "margin-top:14px", text: `Groups are capped at ${n("group_max_players", 6)} and matched by age and level. A group runs once ${n("group_min_players", 4)} families are in — the page tells you how close it is rather than making you ask.` }),
            el("p", { class: "meta", text: `Single sessions are ${money(n("group_dropin_price_cents", 4000))} when a group has room.` }),
            el("a", { class: "button primary block", href: "/group-training/", text: "Find my group" }),
          ]),
          el("div", { class: "card" }, [
            el("h3", { text: "Private training" }),
            el("p", { class: "meta", text: "One player, one coach. Mostly weekends." }),
            el("p", { class: "figure", style: "margin:14px 0 0", text: money(n("private_hourly_price_cents", 10000)) }),
            el("p", { class: "figure-label", text: "an hour" }),
            el("p", { class: "meta", style: "margin-top:14px", text: "Sessions are offered where they join an existing block of work. It means fewer times on the board than a diary full of empty hours would show — and a coach who arrives fresh rather than after an hour in the car for a single hour of work." }),
            el("a", { class: "button primary block", href: "/private-training/", text: "See what is open" }),
          ]),
        ]),

        el("div", { class: "card", style: "margin-top:24px" }, [
          el("h3", { text: "If you need to miss a session" }),
          el("p", { class: "meta", text: `Cancel at least ${n("free_cancel_hours", 24)} hours ahead and the session comes straight back as a credit you can spend on another week. Inside that window the coach is already committed, so the session stands — and we say so before you book, not after.` }),
        ]),
      ]),
    ]),
  );
}
