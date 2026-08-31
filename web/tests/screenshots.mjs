// =============================================================================
// Screenshots
// =============================================================================
//   node web/tests/screenshots.mjs [output directory]
//
// The same pages, the same stubs and the same fixtures the browser tests use,
// captured at 400px so a change can be looked at rather than only asserted on.
// =============================================================================

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const T = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css" };
const s = createServer(async (rq, rs) => {
  const p = new URL(rq.url, "http://x").pathname;
  const f = join(ROOT, normalize(p));
  const t = p.endsWith("/") ? join(f, "index.html") : f;
  let body=null; try { body = await readFile(t); } catch {}
  if (body) { rs.writeHead(200, {"Content-Type": T[extname(t)] ?? "text/plain"}); rs.end(body); }
  else { rs.writeHead(404); rs.end("nf"); }
});
await new Promise(r => s.listen(0, r));
const base = `http://127.0.0.1:${s.address().port}`;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// Stripe is not reachable from here, so the payment step is served a stand-in
// that mounts a placeholder where the card form goes. Everything around it —
// the amount, the hold notice, the button — is the real page.
const STRIPE_STUB = `
  window.Stripe = () => ({
    elements: () => ({ create: () => ({ mount: (node) => {
      node.textContent = "Card details go here — Stripe's own form, in Stripe's own iframe.";
      node.style.cssText = "border:1px dashed #cfcac0;border-radius:10px;padding:22px;color:#6b6862;font-size:14px;margin-bottom:14px;text-align:center";
    } }) }),
    confirmPayment: async () => ({}),
  });
`;

const CATALOG = {
  seasons: [{ id:"se1", name:"Spring 2026", starts_on:"2026-08-31", ends_on:"2026-10-25", weeks:8 }],
  package: { price_cents: 56000, sessions: 16 },
  groups: [
    { id:"g1", name:"Mon/Wed U9 Foundation", status:"forming", min_age:7, max_age:9, min_players:4, max_players:6,
      dropin_price_cents:4000, occupancy:{paid:3,held:0,total:3,capacity:6}, eligible:true,
      locations:{name:"Northside Turf"}, trainers:{display_name:"Dani Okoro"},
      group_meeting_times:[{weekday:1,starts_at:"17:30:00"},{weekday:3,starts_at:"17:30:00"}] },
    { id:"g2", name:"Tue/Thu U12 Advanced", status:"full", min_age:11, max_age:13, min_players:4, max_players:6,
      dropin_price_cents:4000, occupancy:{paid:6,held:0,total:6,capacity:6}, eligible:false,
      locations:{name:"Northside Turf"}, trainers:{display_name:"Marcus Bell"},
      group_meeting_times:[{weekday:2,starts_at:"18:00:00"}] },
    { id:"g3", name:"Tue/Thu U14 Advanced", status:"confirmed", min_age:13, max_age:15, min_players:4, max_players:6,
      dropin_price_cents:4000, occupancy:{paid:5,held:0,total:5,capacity:6}, eligible:false,
      locations:{name:"Riverside Park"}, trainers:{display_name:"Marcus Bell"},
      group_meeting_times:[{weekday:2,starts_at:"19:00:00"},{weekday:4,starts_at:"19:00:00"}] },
  ],
};

const CHECKOUT_RESPONSE = {
  intent_id: "ci1", amount_cents: 56000, currency: "usd",
  expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  client_secret: "pi_demo_secret", publishable_key: "pk_demo",
};

async function shot(path, fixtures, file, { route=false, checkout=false, after=null, height=1400 } = {}) {
  const page = await b.newPage({ viewport: { width: 400, height }, deviceScaleFactor: 2 });
  await page.addInitScript(`
    window.__PTP_INSTALL__ = (async () => {
      const { fakeSupabase } = await import("${base}/tests/fake-supabase.js");
      const fx = await import("${base}/tests/fixtures.js");
      window.__PTP_TEST_CLIENT__ = fakeSupabase(structuredClone(fx.${fixtures}));
    })();
  `);
  await page.route("https://js.stripe.com/**", r =>
    r.fulfill({ status:200, contentType:"text/javascript", body: STRIPE_STUB }));
  await page.route("https://fonts.googleapis.com/**", r =>
    r.fulfill({ status:200, contentType:"text/css", body:"" }));
  await page.route("https://fonts.gstatic.com/**", r =>
    r.fulfill({ status:200, contentType:"font/woff2", body:"" }));
  if (route) await page.route("**/functions/v1/catalog*", r =>
    r.fulfill({ status:200, contentType:"application/json", body: JSON.stringify(CATALOG) }));
  if (checkout) await page.route("**/functions/v1/checkout", r =>
    r.fulfill({ status:200, contentType:"application/json", body: JSON.stringify(CHECKOUT_RESPONSE) }));
  await page.goto(`${base}${path}`, { waitUntil: "load" });
  await page.waitForSelector("h1");
  if (after) await after(page);
  await page.screenshot({ path: file, fullPage: true });
  await page.close();
  console.log("wrote", file);
}

const OUT = process.argv[2] ?? "/tmp";
await shot("/my-ptp/parent/", "demoFixtures", `${OUT}/ptp-parent.png`);
await shot("/my-ptp/trainer/", "trainerFixtures", `${OUT}/ptp-trainer.png`);
await shot("/my-ptp/trainer/", "trainerFixtures", `${OUT}/ptp-register.png`, {
  after: async p => { await p.click("button:text('Register')"); await p.waitForSelector(".register-row"); },
});
await shot("/group-training/", "demoFixtures", `${OUT}/ptp-book.png`, {
  route: true,
  after: async p => { await p.selectOption("select", { index: 1 }); await p.waitForTimeout(300); },
});

// --- booking a package, one screen at a time --------------------------------

await shot("/group-training/", "demoFixtures", `${OUT}/flow-1-browse.png`, {
  route: true,
  after: async p => { await p.selectOption("select", { index: 1 }); await p.waitForTimeout(250); },
});

await shot("/group-training/", "demoFixtures", `${OUT}/flow-2-pay.png`, {
  route: true, checkout: true,
  after: async p => {
    await p.selectOption("select", { index: 1 });
    await p.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(b => b.textContent === "Book the season" && !b.disabled));
    await p.click("button:text('Book the season')");
    await p.waitForSelector("#payment-element");
    await p.waitForTimeout(250);
  },
});

await shot("/my-ptp/parent/", "demoMidCheckoutFixtures", `${OUT}/flow-3-confirming.png`);
await shot("/my-ptp/parent/", "demoFixtures", `${OUT}/flow-4-booked.png`);

await b.close(); s.close();