// =============================================================================
// A camp, and registering for it
// =============================================================================
// One template, every camp. The old site had a hand-built page per camp, which
// is how it ended up still selling weeks that had already happened.
//
// The registration is a single screen with a running summary rather than a
// wizard. A parent filling in an emergency contact on a phone should be able
// to see the price and the week they are buying without going backwards.
// =============================================================================

import { boot } from "/shared/boot.js";
import { campEligibility, campSummary } from "/shared/derive.js";
import { money } from "/shared/format.js";
import { checkoutKey, clearCheckoutKey } from "/shared/api.js";
import { signInView } from "/shared/signin.js";
import { badge, busy, el, empty, errorBox, field, mount, spinner, toast } from "/shared/ui.js";

const AGREEMENTS = [
  ["waiver_agreed", "I have read and agree to the liability waiver."],
  ["media_release_agreed", "I agree to the media release — photographs and video from camp may be used by PTP."],
  ["conduct_agreed", "I have read the code of conduct and will go through it with my child."],
  ["refund_policy_agreed", "I understand the refund policy."],
  ["medical_auth_agreed", "I authorise PTP staff to obtain emergency medical treatment if it is needed."],
];

export async function start(root) {
  const slug = new URLSearchParams(location.search).get("c");

  if (!slug) {
    mount(root, el("div", { class: "wrap section" }, [
      empty("No camp selected.", "Start from the camp finder."),
      el("a", { class: "button primary", href: "/find-a-camp/", text: "Find a camp" }),
    ]));
    return;
  }

  mount(root, el("div", { class: "wrap section" }, [spinner("Loading the camp…")]));

  const api = await boot();

  let data;
  try {
    data = await api.camp(slug);
  } catch {
    mount(root, el("div", { class: "wrap section" }, [
      empty("We could not find that camp.", "It may have finished, or the link may be out of date."),
      el("a", { class: "button primary", href: "/find-a-camp/", text: "See what is running" }),
    ]));
    return;
  }

  const camp = campSummary({ ...data.camp, occupancy: data.occupancy });
  document.title = `${camp.name} — PTP`;

  mount(root,
    hero(camp),
    el("div", { class: "hero-rule" }),
    facts(camp),
    about(camp, data),
    el("div", { id: "register" }),
  );

  await renderRegistration(api, camp, data);
}

function hero(camp) {
  return el("section", { class: "hero" }, [
    el("div", { class: "wrap" }, [
      el("span", { class: "eyebrow", text: `${camp.city}, ${camp.state} · Summer ${camp.season_year}` }),
      el("h1", { text: camp.name }),
      el("p", { class: "lede", text: `${camp.date_range} · ${camp.daily_hours} · Ages ${camp.min_age}–${camp.max_age}` }),
      el("div", { class: "hero-actions" }, [
        el("a", { class: "button primary", href: "#register",
                  text: camp.action === "waitlist" ? "Join the waitlist"
                      : camp.action === "interest" ? "Get early access" : "Register" }),
      ]),
    ]),
  ]);
}

function facts(camp) {
  const stats = [
    [camp.spots_left === null ? "—" : String(camp.spots_left), "places left"],
    [camp.from_price_cents ? money(camp.from_price_cents) : "—", "from"],
    [`${camp.min_age}–${camp.max_age}`, "ages"],
    ["8:1", "maximum ratio"],
  ];

  return el("section", {}, [
    el("div", { class: "wrap" }, [
      el("div", { class: "stat-strip" }, stats.map(([value, label]) =>
        el("div", { class: "stat" }, [
          el("p", { class: "figure", text: value }),
          el("p", { class: "figure-label", text: label }),
        ]))),
    ]),
  ]);
}

function about(camp, data) {
  const list = (heading, items) =>
    (items ?? []).length === 0 ? null : el("div", { class: "card" }, [
      el("h3", { text: heading }),
      el("ul", {},
        items.map((item) => el("li", { text: item }))),
    ]);

  return el("section", { class: "section" }, [
    el("div", { class: "wrap" }, [
      el("p", { class: "lede", text: camp.description }),

      el("div", { class: "grid grid-2" }, [
        list("What is included", camp.whats_included),
        list("What to bring", camp.what_to_bring),
      ]),

      (camp.daily_schedule ?? []).length > 0
        ? el("div", { class: "mt-5" }, [
            el("h3", { text: "A day at camp" }),
            el("div", { class: "table-scroll" }, [
              el("table", {}, [
                el("tbody", {}, camp.daily_schedule.map((slot) =>
                  el("tr", {}, [
                    el("th", { scope: "row", style: "width:24%", text: slot.time }),
                    el("td", { text: slot.what }),
                  ]))),
              ]),
            ]),
          ])
        : null,

      data.staffing.length > 0
        ? el("div", { class: "mt-5" }, [
            el("h3", { text: "Who is coaching" }),
            el("div", { class: "grid grid-3" }, data.staffing.map((s) =>
              el("div", { class: "card" }, [
                el("h3", { text: s.trainers?.display_name ?? "" }),
                el("p", { class: "meta", text: s.role === "director" ? "Camp director" : "Coach" }),
                el("p", { class: "meta", text: s.trainers?.bio ?? "" }),
              ]))),
          ])
        : null,

      el("div", { class: "grid grid-2 mt-5" }, [
        camp.weather_plan ? el("div", { class: "card" }, [
          el("h3", { text: "If the weather turns" }),
          el("p", { class: "meta", text: camp.weather_plan }),
        ]) : null,
        camp.refund_policy ? el("div", { class: "card" }, [
          el("h3", { text: "Refunds" }),
          el("p", { class: "meta", text: camp.refund_policy }),
        ]) : null,
      ]),

      (camp.faqs ?? []).length > 0
        ? el("div", { class: "mt-5" }, [
            el("h3", { text: "Questions parents ask" }),
            ...camp.faqs.map((faq) =>
              el("div", { class: "card" }, [
                el("h3", { text: faq.q }),
                el("p", { class: "meta", text: faq.a }),
              ])),
          ])
        : null,

      el("div", { class: "card mt-5" }, [
        el("h3", { text: "Where" }),
        el("p", { class: "meta", text: camp.field_name }),
        el("p", { class: "meta", text: camp.address_line }),
      ]),
    ]),
  ]);
}

// =============================================================================
// Registration
// =============================================================================

async function renderRegistration(api, camp, data) {
  const host = document.querySelector("#register");
  const user = await api.auth.current();

  if (!user) {
    mount(host, el("section", { class: "section inverse" }, [
      el("div", { class: "wrap" }, [
        el("h2", { text: "Register" }),
        el("p", { class: "lede", text: "Sign in and your details carry across every camp and every season." }),
        signInView(api, { heading: "Your PTP account", note: "One account for the whole family." }),
      ]),
    ]));
    return;
  }

  const players = await api.household().catch(() => []);

  if (players.length === 0) {
    mount(host, el("section", { class: "section" }, [
      el("div", { class: "wrap" }, [
        el("h2", { text: "Register" }),
        empty("No players on your account yet.", "Add a child in your account and come back."),
        el("a", { class: "button primary", href: "/my-ptp/parent/", text: "Go to your account" }),
      ]),
    ]));
    return;
  }

  mount(host, el("section", { class: "section" }, [
    el("div", { class: "wrap" }, [
      el("h2", { text: camp.action === "waitlist" ? "Join the waitlist" : "Register" }),
      el("div", { id: "register-form" }),
    ]),
  ]));

  drawForm(api, camp, data, players);
}

function drawForm(api, camp, data, players) {
  const host = document.querySelector("#register-form");

  const player = el("select", {}, [
    el("option", { value: "", text: "Choose a player" }),
    ...players.map((p) => el("option", { value: p.id, text: `${p.first_name} ${p.last_name}` })),
  ]);

  const eligibility = el("div");
  const chosen = () => players.find((p) => p.id === player.value) ?? null;

  const dayOption = el("select", {},
    [
      camp.offers_full_day ? el("option", { value: "full_day", text: `Full day — ${money(camp.full_day_price_cents)}` }) : null,
      camp.offers_half_day ? el("option", { value: "half_day", text: `Half day — ${money(camp.half_day_price_cents)}` }) : null,
    ].filter(Boolean));

  const addonBoxes = data.addons.map((addon) => {
    const box = el("input", { type: "checkbox", value: addon.id });
    return {
      addon,
      box,
      node: el("label", { class: "checkbox" }, [
        box,
        el("span", {}, [
          el("strong", { text: `${addon.name} — ${money(addon.price_cents)}` }),
          el("span", { class: "meta", style: "display:block", text: addon.description }),
        ]),
      ]),
    };
  });

  const emergencyName = el("input", { type: "text", required: true, autocomplete: "name" });
  const emergencyPhone = el("input", { type: "tel", required: true, autocomplete: "tel" });
  const pickup = el("input", { type: "text", placeholder: "Anyone else who may collect them" });
  const allergies = el("input", { type: "text", placeholder: "None" });
  const medical = el("input", { type: "text", placeholder: "Anything the coaches should know" });
  const shirt = el("select", {}, ["YS", "YM", "YL", "AS", "AM", "AL"].map((size) =>
    el("option", { value: size, text: size })));

  const agreementBoxes = AGREEMENTS.map(([key, text]) => {
    const box = el("input", { type: "checkbox", required: true });
    return { key, box, node: el("label", { class: "checkbox" }, [box, el("span", { text })]) };
  });

  const total = el("p", { class: "figure" });
  const status = el("div");
  const submit = el("button", { class: "button primary block", type: "submit" });

  const recalculate = () => {
    const base = dayOption.value === "half_day" ? camp.half_day_price_cents : camp.full_day_price_cents;
    const extras = addonBoxes.filter((a) => a.box.checked).reduce((sum, a) => sum + a.addon.price_cents, 0);

    // Shown so a parent can check it, and recomputed by the server before a
    // card is ever charged. If the two disagree, the server's number wins and
    // the difference is escalated rather than quietly accepted.
    total.textContent = money(base + extras);
    submit.textContent = `Pay ${money(base + extras)}`;
  };

  const checkEligibility = () => {
    const p = chosen();
    if (!p) {
      mount(eligibility);
      submit.disabled = true;
      return;
    }

    const outcome = campEligibility(camp, p);
    mount(eligibility, outcome.eligible ? null : el("div", { class: "notice", text: outcome.reason }));
    submit.disabled = !outcome.eligible;
  };

  player.addEventListener("change", checkEligibility);
  dayOption.addEventListener("change", recalculate);
  for (const { box } of addonBoxes) box.addEventListener("change", recalculate);

  const form = el("form", {}, [
    el("div", { class: "card" }, [
      el("h3", { text: "Who is coming" }),
      field("Player", player),
      eligibility,
      field("Full or half day", dayOption),
    ]),

    addonBoxes.length > 0
      ? el("div", { class: "card" }, [
          el("h3", { text: "Extras" }),
          el("div", { class: "mt-3" }, addonBoxes.map((a) => a.node)),
        ])
      : null,

    el("div", { class: "card" }, [
      el("h3", { text: "On the day" }),
      el("div", { class: "field-row" }, [
        field("Emergency contact", emergencyName),
        field("Emergency phone", emergencyPhone),
      ]),
      field("Authorised for pick-up", pickup),
      el("div", { class: "field-row" }, [field("Allergies", allergies), field("Shirt size", shirt)]),
      field("Anything else the coaches should know", medical),
    ]),

    el("div", { class: "card" }, [
      el("h3", { text: "Agreements" }),
      el("p", { class: "meta", text: "All five are required. Each is recorded with the time you agreed." }),
      el("div", { class: "mt-3" }, agreementBoxes.map((a) => a.node)),
    ]),

    el("div", { class: "card card-inverse" }, [
      el("div", { class: "card-row" }, [
        el("div", {}, [el("h3", { text: "Total" }), el("p", { class: "meta", text: camp.date_range })]),
        total,
      ]),
    ]),

    status,
    el("div", { id: "payment-element" }),
    submit,
  ]);

  if (camp.action === "waitlist") {
    drawWaitlist(api, camp, players, host);
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    mount(status);
    submit.disabled = true;

    const details = {
      emergency_contact_name: emergencyName.value.trim(),
      emergency_contact_phone: emergencyPhone.value.trim(),
      authorized_pickup: pickup.value.trim(),
      allergies: allergies.value.trim(),
      medical_notes: medical.value.trim(),
      shirt_size: shirt.value,
    };
    for (const { key } of agreementBoxes) details[key] = "true";

    try {
      const checkout = await api.actions.startCampRegistration({
        campId: camp.id,
        playerId: player.value,
        dayOption: dayOption.value,
        addonIds: addonBoxes.filter((a) => a.box.checked).map((a) => a.addon.id),
        details,
        idempotencyKey: checkoutKey("camp", player.value, camp.id),
      });

      if (checkout.status === "already_paid") {
        clearCheckoutKey("camp", player.value, camp.id);
        mount(status, el("div", { class: "notice", text: "This one is already registered. It is in your account." }));
        return;
      }

      await mountStripe(checkout, { camp, playerId: player.value, status, submit });
    } catch (error) {
      mount(status, errorBox(error));
      submit.disabled = false;
    }
  });

  mount(host, form);
  recalculate();
  checkEligibility();
}

function drawWaitlist(api, camp, players, host) {
  const player = el("select", {}, [
    el("option", { value: "", text: "Choose a player" }),
    ...players.map((p) => el("option", { value: p.id, text: `${p.first_name} ${p.last_name}` })),
  ]);

  const join = el("button", { class: "button primary block", text: "Join the waitlist" });
  const status = el("div");

  join.addEventListener("click", busy(join, async () => {
    if (!player.value) {
      toast("Choose a player first.", "error");
      return;
    }

    try {
      await api.actions.joinCampWaitlist({ campId: camp.id, playerId: player.value });
      mount(status, el("div", { class: "notice", text: "You are on the list. If a place opens we message you, and you get 24 hours to take it before it passes to the next family." }));
    } catch (error) {
      mount(status, errorBox(error));
    }
  }));

  mount(host, el("div", { class: "card" }, [
    el("h3", { text: "This week is full" }),
    el("p", { class: "meta", text: "Places do come back. Join the list and you will be first to hear." }),
    field("Player", player),
    status,
    join,
  ]));
}

async function mountStripe(checkout, { camp, playerId, status, submit }) {
  const slot = document.querySelector("#payment-element");

  if (!globalThis.Stripe || !checkout.publishable_key) {
    mount(status, errorBox(new Error("The payment form could not load. Please refresh, or ring us and we will take it over the phone.")));
    return;
  }

  const stripe = globalThis.Stripe(checkout.publishable_key);
  const elements = stripe.elements({ clientSecret: checkout.client_secret });
  elements.create("payment").mount(slot);

  submit.textContent = `Pay ${money(checkout.amount_cents)}`;
  submit.disabled = false;

  mount(status, el("div", { class: "notice", text: "Your place is held for 15 minutes while you pay. If something goes wrong, nothing is charged and the place goes back." }));

  submit.addEventListener("click", async (event) => {
    event.preventDefault();
    submit.disabled = true;

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: new URL("/my-ptp/parent/", location.href).href },
    });

    if (error) {
      mount(status, errorBox(error));
      submit.disabled = false;
    } else {
      clearCheckoutKey("camp", playerId, camp.id);
    }
  }, { once: true });
}
