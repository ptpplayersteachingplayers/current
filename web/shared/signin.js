// =============================================================================
// Sign in
// =============================================================================
// Shared by the parent and trainer portals. A magic link by default, because
// a parent who trains twice a week does not remember a password they set in
// September — with a password field for anyone who set one.
// =============================================================================

import { el, errorBox, field, mount, toast } from "./ui.js";

export function signInView(api, { heading, note }) {
  const email = el("input", { type: "email", autocomplete: "email", required: true, placeholder: "you@example.com" });
  const password = el("input", { type: "password", autocomplete: "current-password", placeholder: "Leave blank for a sign-in link" });
  const errors = el("div");

  const form = el("form", { class: "card" }, [
    el("h3", { text: heading }),
    note && el("p", { class: "meta", text: note }),
    errors,
    field("Email", email),
    field("Password", password),
    el("button", { class: "button block", type: "submit", text: "Continue" }),
  ]);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    mount(errors);

    const button = form.querySelector("button");
    button.disabled = true;

    try {
      if (password.value) {
        const { error } = await api.auth.signIn(email.value.trim(), password.value);
        if (error) throw error;
      } else {
        const { error } = await api.auth.sendMagicLink(email.value.trim());
        if (error) throw error;
        toast("Check your email — the link signs you straight in.");
      }
    } catch (error) {
      mount(errors, errorBox(error));
    } finally {
      button.disabled = false;
    }
  });

  return el("div", { class: "signin" }, [form]);
}
