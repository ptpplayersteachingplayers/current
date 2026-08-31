// =============================================================================
// Every page, captured
// =============================================================================
//   node web/tests/site-shots.mjs [output directory]
//
// The public site and the three portals, each shot whole at phone width with
// the same stubs the tests use. For looking at the site as a set rather than
// one page at a time.
// =============================================================================

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = process.argv[2] ?? "/tmp/ptp-shots";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer(async (rq, rs) => {
  const p = new URL(rq.url, "http://x").pathname;
  const f = join(ROOT, normalize(p));
  const t = p.endsWith("/") ? join(f, "index.html") : f;
  try {
    const body = await readFile(t);
    rs.writeHead(200, { "Content-Type": TYPES[extname(t)] ?? "text/plain" });
    rs.end(body);
  } catch { rs.writeHead(404).end("nf"); }
});

await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
await mkdir(OUT, { recursive: true });

// The public pages read camps through PostgREST and the training catalogue
// through an edge function, so both are stubbed.
const CATALOG = {
  seasons: [{ id: "se1", name: "Spring 2027", starts_on: "2027-03-02", ends_on: "2027-04-27", weeks: 8 }],
  package: { price_cents: 56000, sessions: 16 },
  groups: [
    { id: "g1", name: "Mon/Wed U9 Foundation", status: "forming", min_age: 7, max_age: 9,
      min_players: 4, max_players: 6, dropin_price_cents: 4000,
      occupancy: { paid: 3, held: 0, total: 3, capacity: 6 }, eligible: true,
      locations: { name: "Norristown Turf" }, trainers: { display_name: "Dani Okoro" },
      group_meeting_times: [{ weekday: 1, starts_at: "17:30:00" }, { weekday: 3, starts_at: "17:30:00" }] },
    { id: "g2", name: "Tue/Thu U12 Advanced", status: "full", min_age: 11, max_age: 13,
      min_players: 4, max_players: 6, dropin_price_cents: 4000,
      occupancy: { paid: 6, held: 0, total: 6, capacity: 6 }, eligible: false,
      locations: { name: "Norristown Turf" }, trainers: { display_name: "Marcus Bell" },
      group_meeting_times: [{ weekday: 2, starts_at: "18:00:00" }] },
    { id: "g3", name: "Tue/Thu U14 Advanced", status: "confirmed", min_age: 13, max_age: 15,
      min_players: 4, max_players: 6, dropin_price_cents: 4000,
      occupancy: { paid: 5, held: 0, total: 5, capacity: 6 }, eligible: false,
      locations: { name: "Riverside Park" }, trainers: { display_name: "Sofia Ramos" },
      group_meeting_times: [{ weekday: 2, starts_at: "19:00:00" }, { weekday: 4, starts_at: "19:00:00" }] },
  ],
  slots: [
    { id: "s1", starts_at: "2027-03-04T22:00:00Z", minutes: 60, price_cents: 9500,
      trainers: { display_name: "Dani Okoro" }, locations: { name: "Norristown Turf" } },
    { id: "s2", starts_at: "2027-03-05T23:00:00Z", minutes: 60, price_cents: 9500,
      trainers: { display_name: "Sofia Ramos" }, locations: { name: "Riverside Park" } },
  ],
};

// The public pages, in the order the navigation presents them.
const PUBLIC = [
  ["/", "01-home"],
  ["/find-a-camp/", "02-find-a-camp"],
  ["/camps/", "03-camps"],
  ["/camps/pennsylvania/", "04-camps-pa"],
  ["/camps/new-jersey/", "05-camps-nj"],
  ["/camp/", "06-camp"],
  ["/camps/experience/", "07-camp-experience"],
  ["/camps/faqs/", "08-camp-faqs"],
  ["/training/", "09-training"],
  ["/group-training/", "10-group-training"],
  ["/private-training/", "11-private-training"],
  ["/private-training/pay/", "12-private-pay"],
  ["/training/faqs/", "13-training-faqs"],
  ["/clinics/", "14-clinics"],
  ["/coaches/", "15-coaches"],
  ["/about/", "16-about"],
  ["/about/story/", "17-story"],
  ["/about/reviews/", "18-reviews"],
  ["/about/2026-recap/", "19-recap"],
  ["/apply-to-coach/", "20-apply-to-coach"],
  ["/bring-ptp-to-your-community/", "21-bring-ptp"],
  ["/contact/", "22-contact"],
  ["/policies/", "23-policies"],
  ["/my-ptp/", "24-my-ptp"],
];

const PORTALS = [
  ["/my-ptp/parent/", "demoFixtures", "25-parent-portal"],
  ["/my-ptp/trainer/", "trainerFixtures", "26-trainer-portal"],
  ["/my-ptp/admin/", "adminFixtures", "27-admin-today"],
];

async function newPage(fixturesName, signedIn = true) {
  const page = await browser.newPage({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 2 });

  if (fixturesName) {
    await page.addInitScript(({ n, i, b }) => {
      globalThis.__PTP_FIXTURES__ = { fixturesName: n, signedIn: i, baseUrl: b };
    }, { n: fixturesName, i: signedIn, b: base });

    await page.addInitScript(`
      window.__PTP_INSTALL__ = (async () => {
        const { fakeSupabase } = await import("${base}/tests/fake-supabase.js");
        const fx = await import("${base}/tests/fixtures.js");
        const src = fx[window.__PTP_FIXTURES__.fixturesName];
        const chosen = { ...structuredClone({ session: src.session ?? null, tables: src.tables }), rpc: src.rpc };
        window.__PTP_FIXTURE_DATA__ = chosen;
        fx.resetCalls?.();
        window.__PTP_CALLS__ = fx.calls ?? [];
        window.__PTP_TEST_CLIENT__ = fakeSupabase(chosen);
      })();
    `);
  }

  // No internet here; a hanging font request stops the page firing load.
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.route("https://fonts.gstatic.com/**", (r) => r.fulfill({ status: 200, body: "" }));
  await page.route("https://js.stripe.com/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "window.Stripe=()=>({elements:()=>({create:()=>({mount:(n)=>{n.textContent='Stripe card form';}})}),confirmPayment:async()=>({})});" }));
  await page.route("**/functions/v1/catalog*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CATALOG) }));
  return page;
}

let n = 0;
for (const [path, name] of PUBLIC) {
  const page = await newPage("publicFixtures", false);
  try {
    await page.goto(base + path, { waitUntil: "load", timeout: 15000 });
    // Wait for real content, not a fixed delay: these pages fetch after load,
    // and a 350ms guess caught several of them mid-flight and shot the
    // offline state instead.
    await page.waitForFunction(
      () => !document.body.textContent.includes("WE CANNOT LOAD THIS"),
      null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    n++;
  } catch (error) {
    console.log(`  skipped ${path}: ${error.message.split("\n")[0]}`);
  }
  await page.close();
}

for (const [path, fixtures, name] of PORTALS) {
  const page = await newPage(fixtures);
  try {
    await page.goto(base + path, { waitUntil: "load", timeout: 15000 });
    await page.waitForSelector("#app h1, #app h2", { timeout: 8000 });
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    n++;
  } catch (error) {
    console.log(`  skipped ${path}: ${error.message.split("\n")[0]}`);
  }
  await page.close();
}

console.log(`${n} page(s) captured to ${OUT}`);
await browser.close();
server.close();
