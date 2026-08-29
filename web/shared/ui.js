// =============================================================================
// Rendering, without a framework
// =============================================================================
// Three screens, no build step, and pages that must load on a phone with one
// bar of signal at the side of a pitch. A framework would be more code
// downloaded than the whole of these portals.
// =============================================================================

export function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);

  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;

    if (name === "class") node.className = value;
    else if (name === "text") node.textContent = value;
    else if (name === "html") throw new Error("Build nodes rather than assigning HTML");
    else if (name.startsWith("on")) node.addEventListener(name.slice(2).toLowerCase(), value);
    else if (name === "dataset") Object.assign(node.dataset, value);
    else node.setAttribute(name, value === true ? "" : value);
  }

  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" || typeof child === "number" ? String(child) : child);
  }

  return node;
}

export function mount(target, ...nodes) {
  const host = typeof target === "string" ? document.querySelector(target) : target;
  host.replaceChildren(...nodes.flat().filter(Boolean));
  return host;
}

export function empty(message, detail = null) {
  return el("div", { class: "empty" }, [
    el("p", { class: "empty-message", text: message }),
    detail && el("p", { class: "empty-detail", text: detail }),
  ]);
}

export function spinner(message = "Loading…") {
  return el("div", { class: "loading", role: "status" }, [
    el("span", { class: "spinner", "aria-hidden": "true" }),
    el("span", { text: message }),
  ]);
}

// Errors are shown, not swallowed. A parent who taps Cancel and sees nothing
// happen will tap it again.
export function errorBox(error, { onRetry = null } = {}) {
  return el("div", { class: "error", role: "alert" }, [
    el("p", { text: error?.message ?? String(error) }),
    onRetry && el("button", { class: "link", text: "Try again", onclick: onRetry }),
  ]);
}

export function badge(text, tone = "neutral") {
  return el("span", { class: `badge badge-${tone}`, text });
}

export function field(label, input) {
  const id = `f${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  return el("label", { class: "field", for: id }, [el("span", { text: label }), input]);
}

// Disables the button for the length of the call, so a double tap is one
// request. The database is idempotent underneath; this is so the interface
// does not look broken while it proves it.
export function busy(button, work) {
  return async (event) => {
    if (button.disabled) return;

    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Working…";

    try {
      await work(event);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  };
}

export function toast(message, tone = "info") {
  const node = el("div", { class: `toast toast-${tone}`, role: "status", text: message });
  document.body.append(node);
  setTimeout(() => node.classList.add("toast-out"), 4000);
  setTimeout(() => node.remove(), 4600);
  return node;
}

export function confirmDialog({ title, body, confirmLabel = "Confirm", cancelLabel = "Never mind" }) {
  return new Promise((resolve) => {
    const dialog = el("div", { class: "sheet-backdrop" });

    const close = (answer) => {
      dialog.remove();
      resolve(answer);
    };

    dialog.append(
      el("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, [
        el("h2", { text: title }),
        ...[].concat(body).map((line) => (typeof line === "string" ? el("p", { text: line }) : line)),
        el("div", { class: "sheet-actions" }, [
          el("button", { class: "button ghost", text: cancelLabel, onclick: () => close(false) }),
          el("button", { class: "button", text: confirmLabel, onclick: () => close(true) }),
        ]),
      ]),
    );

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close(false);
    });

    document.body.append(dialog);
    dialog.querySelector("button").focus();
  });
}
