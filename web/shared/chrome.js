// =============================================================================
// Site chrome
// =============================================================================
// One header, one drawer, one footer, one sticky action bar — built here and
// used by every page, so a link added to the navigation appears everywhere at
// once. The old site had the menu hand-written into each template, which is
// why half its pages still linked to programmes that had finished.
//
// The mobile bar carries exactly two actions. A sticky bar with five buttons
// is a second navigation, and a parent standing in a car park needs one thing
// to tap, not five.
// =============================================================================

import { el } from "./ui.js";

export const NAVIGATION = [
  {
    label: "Camps",
    href: "/camps/",
    items: [
      ["Find a Camp", "/find-a-camp/"],
      ["Pennsylvania Camps", "/camps/pennsylvania/"],
      ["New Jersey Camps", "/camps/new-jersey/"],
      ["Camp Locations", "/camps/"],
      ["Camp Experience", "/camps/experience/"],
      ["Camp FAQs", "/camps/faqs/"],
      ["Bring PTP to Your Community", "/bring-ptp-to-your-community/"],
    ],
  },
  {
    label: "Training",
    href: "/training/",
    items: [
      ["Group Training", "/group-training/"],
      ["Private Training", "/private-training/"],
      ["Clinics and Events", "/clinics/"],
      ["How Training Works", "/training/"],
      ["Training FAQs", "/training/faqs/"],
    ],
  },
  {
    label: "Coaches",
    href: "/coaches/",
    items: [
      ["Meet the Coaches", "/coaches/"],
      ["Book With a Coach", "/private-training/"],
      ["Apply to Coach", "/apply-to-coach/"],
    ],
  },
  {
    label: "About",
    href: "/about/",
    items: [
      ["Why PTP", "/about/"],
      ["Our Story", "/about/story/"],
      ["Parent Reviews", "/about/reviews/"],
      ["2026 Summer Recap", "/about/2026-recap/"],
      ["Contact", "/contact/"],
      ["Policies", "/policies/"],
    ],
  },
  {
    label: "My PTP",
    href: "/my-ptp/",
    items: [
      ["Parent Login", "/my-ptp/parent/"],
      ["Trainer Login", "/my-ptp/trainer/"],
    ],
  },
];

const FOOTER = [
  ["Camps", [
    ["Find a Camp", "/find-a-camp/"],
    ["Pennsylvania", "/camps/pennsylvania/"],
    ["New Jersey", "/camps/new-jersey/"],
    ["Camp FAQs", "/camps/faqs/"],
  ]],
  ["Training", [
    ["Group Training", "/group-training/"],
    ["Private Training", "/private-training/"],
    ["Clinics and Events", "/clinics/"],
    ["How Training Works", "/training/"],
  ]],
  ["PTP", [
    ["Why PTP", "/about/"],
    ["Meet the Coaches", "/coaches/"],
    ["Apply to Coach", "/apply-to-coach/"],
    ["Bring PTP to Your Community", "/bring-ptp-to-your-community/"],
  ]],
  ["Account", [
    ["Parent Login", "/my-ptp/parent/"],
    ["Trainer Login", "/my-ptp/trainer/"],
    ["Contact", "/contact/"],
    ["Policies", "/policies/"],
  ]],
];

function currentPath() {
  return typeof location === "undefined" ? "/" : location.pathname;
}

// A section is current when the page is inside it — /camps/pennsylvania/ marks
// Camps, not nothing.
function isCurrent(section) {
  const path = currentPath();
  if (section.href === "/" ) return path === "/";
  return path.startsWith(section.href) || section.items.some(([, href]) => path === href);
}

export function header() {
  const drawer = buildDrawer();

  const toggle = el("button", {
    class: "menu-toggle",
    type: "button",
    "aria-expanded": "false",
    "aria-controls": "ptp-drawer",
    text: "Menu",
  });

  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!open));
    toggle.textContent = open ? "Menu" : "Close";
    drawer.hidden = open;
    document.body.style.overflow = open ? "" : "hidden";
  });

  const nav = el("nav", { class: "nav", "aria-label": "Main" },
    NAVIGATION.map((section) => navItem(section)));

  const bar = el("header", { class: "site-header" }, [
    el("div", { class: "wrap" }, [
      // The logo is the way home. A separate Home link beside it is a link
      // nobody uses taking space from one they do.
      el("a", { class: "wordmark", href: "/", "aria-label": "PTP — home", text: "PTP" }),
      nav,
      el("a", { class: "header-cta", href: "/find-a-camp/", text: "Find a Camp" }),
      toggle,
    ]),
  ]);

  return [bar, drawer];
}

function navItem(section) {
  const list = el("ul", { class: "dropdown", hidden: true },
    section.items.map(([label, href]) => el("li", {}, [el("a", { href, text: label })])));

  const button = el("button", {
    class: "nav-link",
    type: "button",
    "aria-expanded": "false",
    "aria-haspopup": "true",
    text: section.label,
  });
  if (isCurrent(section)) button.setAttribute("aria-current", "page");

  const item = el("div", { class: "nav-item" }, [button, list]);

  const close = () => {
    button.setAttribute("aria-expanded", "false");
    list.hidden = true;
  };

  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") === "true";
    // Only one dropdown at a time.
    for (const other of document.querySelectorAll('.nav-link[aria-expanded="true"]')) {
      other.setAttribute("aria-expanded", "false");
      other.nextElementSibling.hidden = true;
    }
    if (!open) {
      button.setAttribute("aria-expanded", "true");
      list.hidden = false;
    }
  });

  item.addEventListener("mouseleave", close);
  item.addEventListener("focusout", (event) => {
    if (!item.contains(event.relatedTarget)) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  return item;
}

function buildDrawer() {
  return el("div", { class: "drawer", id: "ptp-drawer", hidden: true },
    NAVIGATION.map((section) => {
      const list = el("ul", { hidden: true },
        section.items.map(([label, href]) => el("li", {}, [el("a", { href, text: label })])));

      const button = el("button", { type: "button", "aria-expanded": "false" }, [
        el("span", { text: section.label }),
        el("span", { "aria-hidden": "true", text: "+" }),
      ]);

      button.addEventListener("click", () => {
        const open = button.getAttribute("aria-expanded") === "true";
        button.setAttribute("aria-expanded", String(!open));
        button.lastChild.textContent = open ? "+" : "–";
        list.hidden = open;
      });

      return el("div", { class: "drawer-group" }, [button, list]);
    }));
}

export function actionBar() {
  return el("div", { class: "action-bar" }, [
    el("a", { href: "/find-a-camp/", text: "Find a Camp" }),
    el("a", { href: "/group-training/", text: "Book Training" }),
  ]);
}

export function footer() {
  return el("footer", { class: "site-footer" }, [
    el("div", { class: "wrap" }, [
      el("div", { class: "grid grid-4" },
        FOOTER.map(([heading, links]) =>
          el("div", {}, [
            el("h4", { text: heading }),
            el("ul", {}, links.map(([label, href]) => el("li", {}, [el("a", { href, text: label })]))),
          ]))),
      // No link in this line. Contact is already in the Account column above,
      // at a size a thumb can hit; an inline repeat of it inside a sentence
      // cannot be, and a second link to the same page is not worth the miss.
      el("p", { class: "footer-note",
                text: "Players Teaching Players · Pennsylvania and New Jersey" }),
    ]),
  ]);
}

// Portal pages get the four-tab bottom bar instead of the marketing action bar.
// The four tabs, and the view each one shows. The href is a hash so the tab a
// parent is on survives a reload and can be linked to — and so that a tab
// which does nothing is impossible to ship: the portal reads the hash to
// decide what to render.
export const PORTAL_TABS = {
  parent: [["Home", "home"], ["Schedule", "schedule"], ["Messages", "messages"], ["Account", "account"]],
  trainer: [["Today", "home"], ["Schedule", "schedule"], ["Messages", "messages"], ["Pay", "pay"]],
};

export function portalNav(role) {
  const base = role === "trainer" ? "/my-ptp/trainer/" : "/my-ptp/parent/";
  const current = (location.hash || "#home").slice(1);

  const nav = el("nav", { class: "portal-nav", "aria-label": "Portal" },
    PORTAL_TABS[role === "trainer" ? "trainer" : "parent"].map(([label, key]) =>
      el("a", {
        href: `${base}#${key}`,
        text: label,
        ...(key === current || (key === "home" && !location.hash) ? { "aria-current": "page" } : {}),
      })));

  // Keep the marker on the tab you are actually looking at.
  addEventListener("hashchange", () => {
    const now = (location.hash || "#home").slice(1);
    for (const link of nav.querySelectorAll("a")) {
      const key = link.getAttribute("href").split("#")[1];
      if (key === now) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  });

  return nav;
}

// Called once per page. Everything above is assembled here so a page's own
// script is only ever about that page.
export function mountChrome({ variant = "site" } = {}) {
  const [bar, drawer] = header();
  document.body.prepend(bar, drawer);

  if (variant === "site") {
    document.body.append(footer(), actionBar());
    document.body.classList.add("has-action-bar");
  } else if (variant === "wrap") {
    // A page with its own navigation — the admin console. Header and gutter,
    // no bottom bar and no marketing footer: staff are not being sold to.
    document.body.classList.add("has-own-nav");
  } else {
    document.body.append(portalNav(variant));
    document.body.classList.add("has-portal-nav");
  }
}
