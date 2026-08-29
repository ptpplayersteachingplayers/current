// =============================================================================
// My PTP
// =============================================================================
// The one door, and the thing behind it depends on who you are. A parent and a
// trainer signing in at the same address is the whole point: nobody has to
// remember which portal they belong to.
// =============================================================================

import { boot } from "/shared/boot.js";
import { signInView } from "/shared/signin.js";
import { el, mount, spinner } from "/shared/ui.js";

export async function start(root) {
  mount(root, el("div", { class: "wrap section" }, [spinner("Checking your account…")]));

  const api = await boot();
  const route = async () => {
    const user = await api.auth.current();

    if (!user) {
      mount(root, el("section", { class: "section" }, [
        el("div", { class: "wrap" }, [
          el("h1", { text: "My PTP" }),
          el("p", { class: "lede", text: "One account for camps, training, payments and messages." }),
          signInView(api, { heading: "Sign in", note: "Parents and coaches use the same sign-in." }),
          el("div", { class: "grid grid-2", style: "margin-top:24px" }, [
            el("a", { class: "button ghost", href: "/my-ptp/parent/", text: "Parent login" }),
            el("a", { class: "button ghost", href: "/my-ptp/trainer/", text: "Trainer login" }),
          ]),
        ]),
      ]));
      return;
    }

    // A trainer row for this sign-in means the trainer portal; everyone else
    // is a parent. Checked against the database rather than against a flag in
    // the browser, because the browser is not where roles live.
    let isTrainer = false;
    try {
      isTrainer = (await api.myTrainerProfile()) !== null;
    } catch { /* fall through to the parent portal */ }

    location.replace(isTrainer ? "/my-ptp/trainer/" : "/my-ptp/parent/");
  };

  api.auth.onChange(route);
  await route();
}
