// =============================================================================
// Homepage
// =============================================================================
// Twelve sections in the order a parent decides in: what is this, which of the
// three things do I want, is there one near me, why you, show me one, and then
// the proof.
//
// Every number on this page is one PTP can stand behind. There is no College
// Series section because that programme did not run, and a proof point that
// turns out not to be true costs more than the section was worth.
// =============================================================================

import { boot } from "/shared/boot.js";
import { groupCard } from "/shared/derive.js";
import { money } from "/shared/format.js";
import { badge, el, empty, errorBox, field, mount, spinner, toast } from "/shared/ui.js";

const PROGRAMS = [
  {
    name: "Summer Camps",
    points: ["Five-day programs", "Full-day and half-day options", "Ages 6–14",
             "College and professional player coaches"],
    cta: ["Find a Camp", "/find-a-camp/"],
    primary: true,
  },
  {
    name: "Group Training",
    points: ["Eight-week seasons", "Two sessions each week", "Sixteen total sessions",
             "Maximum six players", "Matched by age and level"],
    cta: ["Find My Group", "/group-training/"],
  },
  {
    name: "Private Training",
    points: ["Individual player development", "Weekend training blocks", "$100 per session"],
    cta: ["Book Private Training", "/private-training/"],
  },
];

const WHY = [
  ["Coached by players still in the game",
   "Every session is run by a current college or professional player. Not a parent volunteer, and not a coach who last played in 1998."],
  ["Small enough that your child gets the ball",
   "Camps run at 8:1 or better. Training groups cap at six. The difference is measured in touches, and it is enormous."],
  ["Matched by age and level, not by whoever signed up",
   "A group is only offered to a player it actually fits. It is why the sessions are hard enough to be worth attending."],
  ["You are told the truth about availability",
   "If a week is nearly full, the page says so. If a group needs one more family to run, it says that too."],
];

const REVIEWS = [
  ["He came home exhausted and asked when the next one was. That has never happened with a camp before.",
   "Parent, Norristown, summer 2026"],
  ["The coaches actually knew his name by Tuesday. At his last camp I am not sure anyone did all week.",
   "Parent, Cherry Hill, summer 2026"],
  ["We signed up for one week and stayed for three.",
   "Parent, Doylestown, summer 2026"],
];

export async function start(root) {
  mount(root,
    hero(),
    el("div", { class: "hero-rule" }),
    programs(),
    finderSection(),
    why(),
    el("div", { id: "featured-camps" }, [spinner("Loading 2027 camps…")]),
    trainingSection(),
    el("div", { id: "featured-coaches" }),
    reviews(),
    impact(),
    community(),
    earlyAccess(),
  );

  // The catalogue is loaded after the page has painted. A parent on a phone in
  // a car park sees the hero and the three programmes immediately, whether or
  // not the API is having a good day.
  let api;
  try {
    api = await boot();
  } catch {
    mount(document.querySelector("#featured-camps"), campsUnavailable());
    return;
  }

  await Promise.all([featuredCamps(api), featuredCoaches(api)]);
}

function hero() {
  return el("section", { class: "hero" }, [
    el("div", { class: "wrap" }, [
      el("span", { class: "eyebrow", text: "Pennsylvania · New Jersey · Ages 6–14" }),
      el("h1", { text: "Train with college athletes who are still in the game" }),
      el("p", { class: "lede", text: "Summer camps, small-group training and private sessions for players ages 6–14." }),
      el("div", { class: "hero-actions" }, [
        el("a", { class: "button primary", href: "/find-a-camp/", text: "Find a 2027 camp" }),
        el("a", { class: "button ghost", href: "/training/", text: "Explore training" }),
      ]),
    ]),
  ]);
}

function programs() {
  return el("section", { class: "section" }, [
    el("div", { class: "wrap" }, [
      el("div", { class: "section-head" }, [
        el("span", { class: "eyebrow", text: "Three ways to train" }),
        el("h2", { text: "Choose your program" }),
      ]),
      // Three parallel choices, so they read as a set: same shape, same
      // weight, one of them marked. A filled block beside two open rows makes
      // them look like different kinds of thing.
      el("div", { class: "grid grid-3" }, PROGRAMS.map((program) =>
        el("div", { class: program.primary ? "tile tile-lead" : "tile" }, [
          el("h3", { text: program.name }),
          el("ul", {}, program.points.map((point) => el("li", { text: point }))),
          el("a", {
            class: program.primary ? "button primary block" : "button block",
            href: program.cta[1],
            text: program.cta[0],
          }),
        ]))),
    ]),
  ]);
}

function finderSection() {
  const zip = el("input", { type: "text", inputmode: "numeric", pattern: "[0-9]{5}",
                            maxlength: "5", placeholder: "19401", "aria-label": "ZIP code" });

  const form = el("form", { class: "tile" }, [
    el("h3", { text: "Find a camp near you" }),
    el("p", { class: "meta", text: "Enter a ZIP code and we will show you what is within driving distance." }),
    field("ZIP code", zip),
    el("button", { class: "button primary block", type: "submit", text: "Search camps" }),
  ]);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = zip.value.trim();
    if (!/^\d{5}$/.test(value)) {
      toast("That does not look like a ZIP code.", "error");
      return;
    }
    location.href = `/find-a-camp/?zip=${value}`;
  });

  return el("section", { class: "section" }, [el("div", { class: "wrap" }, [form])]);
}

function why() {
  return el("section", { class: "section" }, [
    el("div", { class: "wrap" }, [
      el("div", { class: "section-head" }, [
        el("span", { class: "eyebrow", text: "Why PTP" }),
        el("h2", { text: "What is different about it" }),
      ]),
      el("div", { class: "grid grid-2" }, WHY.map(([heading, body]) =>
        el("div", {}, [el("h3", { text: heading }), el("p", { class: "meta", text: body })]))),
    ]),
  ]);
}

async function featuredCamps(api) {
  const host = document.querySelector("#featured-camps");

  let camps;
  try {
    ({ camps } = await api.camps({ limit: 3 }));
  } catch {
    mount(host, campsUnavailable());
    return;
  }

  mount(host, el("section", { class: "section" }, [
    el("div", { class: "wrap" }, [
      el("div", { class: "section-head" }, [
        el("span", { class: "eyebrow", text: "Summer 2027" }),
        el("h2", { text: "Featured camps" }),
      ]),
      (camps ?? []).length === 0
        ? empty("2027 camps open shortly.", "Join the early-access list below and you will hear first.")
        : el("div", { class: "grid grid-3" }, camps.slice(0, 3).map(campCard)),
      el("a", { class: "button block", href: "/find-a-camp/", class: "mt-5", text: "See every camp" }),
    ]),
  ]));
}

export function campCard(camp) {
  const left = camp.spots_left;

  return el("article", { class: "tile" }, [
    el("div", { class: "card-row" }, [
      el("div", {}, [
        el("h3", { text: camp.city }),
        el("p", { class: "meta", text: camp.field_name }),
      ]),
      badge(campBadge(camp), campTone(camp)),
    ]),
    el("p", { class: "meta mt-3", text: camp.date_range }),
    el("p", { class: "meta", text: `${camp.daily_hours} · Ages ${camp.min_age}–${camp.max_age}` }),
    el("p", { class: "price-line",
              text: camp.from_price_cents ? `From ${money(camp.from_price_cents)}` : "" }),
    el("a", { class: "button block", href: `/camp/?c=${camp.slug}`, text: "Details" }),
  ]);
}

export function campBadge(camp) {
  if (camp.status === "full" || camp.status === "waitlist") return "Waitlist";
  if (camp.status === "limited") return `${camp.spots_left} left`;
  if (camp.status === "early_access") return "Early access";
  return "Open";
}

export function campTone(camp) {
  if (camp.status === "full" || camp.status === "waitlist") return "full";
  if (camp.status === "limited") return "nearly";
  return "open";
}

function campsUnavailable() {
  return el("section", { class: "section" }, [
    el("div", { class: "wrap" }, [
      empty("Camp listings are not loading just now.",
            "Ring us and we will book you in over the phone."),
    ]),
  ]);
}

function trainingSection() {
  return el("section", { class: "section inverse" }, [
    el("div", { class: "wrap" }, [
      el("div", { class: "section-head" }, [
        el("span", { class: "eyebrow", text: "September to June" }),
        el("h2", { text: "Year-round group and private training" }),
      ]),
      el("div", { class: "grid grid-2" }, [
        el("div", {}, [
          el("h3", { text: "Group training" }),
          el("p", { class: "lede", text: "Eight weeks, twice a week, sixteen sessions, six players at most. A group runs once four families are in — and the page tells you how close it is." }),
          el("a", { class: "button primary", href: "/group-training/", text: "Find my group" }),
        ]),
        el("div", {}, [
          el("h3", { text: "Private training" }),
          el("p", { class: "lede", text: "One player, one coach, mostly at weekends. Sessions are offered where they join an existing block, so your coach arrives fresh rather than after an hour in the car for a single hour of work." }),
          el("a", { class: "button primary", href: "/private-training/", text: "Book private training" }),
        ]),
      ]),
    ]),
  ]);
}

async function featuredCoaches(api) {
  const host = document.querySelector("#featured-coaches");

  let coaches = [];
  try {
    coaches = await api.trainers();
  } catch {
    return;                                  // the section simply does not appear
  }

  if (coaches.length === 0) return;

  mount(host, el("section", { class: "section" }, [
    el("div", { class: "wrap" }, [
      el("div", { class: "section-head" }, [
        el("span", { class: "eyebrow", text: "Who your child works with" }),
        el("h2", { text: "The coaches" }),
      ]),
      el("div", { class: "grid grid-3" }, coaches.slice(0, 3).map((coach) =>
        el("article", { class: "card" }, [
          el("h3", { text: coach.display_name }),
          el("p", { class: "meta", text: coach.bio }),
        ]))),
      el("a", { class: "button block", href: "/coaches/", class: "mt-5", text: "Meet the coaches" }),
    ]),
  ]));
}

function reviews() {
  return el("section", { class: "section" }, [
    el("div", { class: "wrap" }, [
      el("div", { class: "section-head" }, [
        el("span", { class: "eyebrow", text: "Summer 2026" }),
        el("h2", { text: "What parents said" }),
      ]),
      el("div", { class: "grid grid-3" }, REVIEWS.map(([quote, who]) =>
        el("blockquote", { class: "tile", style: "margin:0" }, [
          el("p", { class: "quote", text: `“${quote}”` }),
          el("p", { class: "meta", style: "margin:0", text: who }),
        ]))),
    ]),
  ]);
}

function impact() {
  // Four numbers, all of them verified. Nothing rounded up, nothing implied.
  const stats = [
    ["350+", "athletes coached in 2026"],
    ["8:1", "maximum camp ratio"],
    ["74", "players at the PTP × Colonial clinic"],
    ["2", "states, Pennsylvania and New Jersey"],
  ];

  return el("section", { class: "section" }, [
    el("div", { class: "wrap" }, [
      el("div", { class: "section-head" }, [
        el("span", { class: "eyebrow", text: "2026" }),
        el("h2", { text: "What last year looked like" }),
      ]),
      el("div", { class: "stat-strip" }, stats.map(([value, label]) =>
        el("div", { class: "stat" }, [
          el("p", { class: "figure", text: value }),
          el("p", { class: "figure-label", text: label }),
        ]))),
    ]),
  ]);
}

function community() {
  return el("section", { class: "section" }, [
    el("div", { class: "wrap" }, [
      el("div", { class: "card-inverse" }, [
        el("span", { class: "eyebrow", text: "For clubs and townships" }),
        el("h2", { text: "Bring PTP to your community" }),
        el("p", { class: "meta", text: "If you have a field and a group of players, we will bring the coaches. We ran the PTP × Colonial clinic for 74 players and 10 coaches on exactly that basis." }),
        el("a", { class: "button primary", href: "/bring-ptp-to-your-community/", text: "Start a conversation" }),
      ]),
    ]),
  ]);
}

function earlyAccess() {
  return el("section", { class: "section" }, [
    el("div", { class: "wrap" }, [
      el("div", { class: "section-head" }, [
        el("span", { class: "eyebrow", text: "2027" }),
        el("h2", { text: "Early access" }),
      ]),
      el("p", { class: "lede", text: "Tell us where you are and which weeks might work. You will hear before the camps go on general sale." }),
      el("a", { class: "button primary", href: "/find-a-camp/#early-access", text: "Join the early-access list" }),
    ]),
  ]);
}
