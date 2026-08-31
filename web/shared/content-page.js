// The one template every content page renders through.
import { el, empty, mount } from "/shared/ui.js";
import { PAGES } from "/shared/content.js";

export async function start(root) {
  const page = PAGES[location.pathname];

  if (!page) {
    mount(root, el("div", { class: "wrap section" }, [
      empty("That page has moved.", "Try the menu, or start from the camp finder."),
      el("a", { class: "button primary", href: "/find-a-camp/", text: "Find a camp" }),
    ]));
    return;
  }

  document.title = `${page.title} — PTP`;

  mount(root,
    el("section", { class: "hero" }, [
      el("div", { class: "wrap" }, [
        page.eyebrow ? el("span", { class: "eyebrow", text: page.eyebrow }) : null,
        el("h1", { text: page.title }),
        page.lede ? el("p", { class: "lede", text: page.lede }) : null,
      ]),
    ]),
    el("div", { class: "hero-rule" }),

    page.stats
      ? el("section", {}, [el("div", { class: "wrap" }, [
          el("div", { class: "stat-strip" }, page.stats.map(([value, label]) =>
            el("div", { class: "stat" }, [
              el("p", { class: "figure", text: value }),
              el("p", { class: "figure-label", text: label }),
            ]))),
        ])])
      : null,

    el("section", { class: "section" }, [
      el("div", { class: "wrap" }, [
        ...(page.sections ?? []).map(([heading, body]) =>
          el("div", { class: "card" }, [
            el("h3", { text: heading }),
            el("p", { class: "meta", text: body }),
          ])),

        ...(page.faqs ?? []).map(([question, answer]) =>
          el("div", { class: "card" }, [
            el("h3", { text: question }),
            el("p", { class: "meta", text: answer }),
          ])),

        page.quotes
          ? el("div", { class: "grid grid-2" }, page.quotes.map(([quote, who]) =>
              el("blockquote", { class: "card", style: "margin:0" }, [
                el("p", { class: "quote", text: `“${quote}”` }),
                el("p", { class: "meta", style: "margin:0", text: who }),
              ])))
          : null,

        page.note ? el("p", { class: "notice mt-5", text: page.note }) : null,

        page.cta
          ? el("a", { class: "button primary mt-5",
                      href: page.cta[1], text: page.cta[0] })
          : null,
      ]),
    ]),
  );
}
