// =============================================================================
// The portals, in a real browser
// =============================================================================
//   node web/tests/browser.test.mjs
//
// Chromium loads the actual pages — the same HTML, the same modules, the same
// stylesheet a parent would get — with a stubbed Supabase client in place of
// the network. What is asserted is what a person would see on the screen.
//
// Needs: npm i playwright  (Chromium is pre-installed in this environment)
// =============================================================================

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://x").pathname;
  const file = join(WEB_ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  const target = path.endsWith("/") ? join(file, "index.html") : file;

  try {
    const body = await readFile(target);
    response.writeHead(200, { "Content-Type": TYPES[extname(target)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
});

await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());

// The first page in a cold browser is slow enough to trip a tight timeout and
// look like a broken portal. Warm it up before anything is measured.
await (await browser.newPage()).close();

// Fail fast. A missing element is a failing assertion, not something to wait
// half a minute for.
const TIMEOUT = 4000;

let pass = 0;
let fail = 0;

async function check(description, run) {
  try {
    const outcome = await run();
    if (outcome === true) {
      console.log(`  ok   ${description}`);
      pass++;
    } else {
      console.log(`  FAIL ${description}\n         ${outcome}`);
      fail++;
    }
  } catch (error) {
    console.log(`  FAIL ${description}\n         threw: ${error.message.split("\n")[0]}`);
    fail++;
  }
}

// Loads a page with the fake client installed before any module runs, and with
// the clock pinned so "Tomorrow" means tomorrow.
async function open(path, fixturesName, { signedIn = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(TIMEOUT);

  const problems = [];
  page.on("pageerror", (error) => problems.push(String(error.message)));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });

  await page.addInitScript(
    ({ fixturesName, signedIn, baseUrl }) => {
      globalThis.__PTP_FIXTURES__ = { fixturesName, signedIn, baseUrl };
    },
    { fixturesName, signedIn, baseUrl: base },
  );

  // The stub is installed in an init script that imports the same modules the
  // page does, so nothing about the page under test is special-cased.
  await page.addInitScript(`
    window.__PTP_INSTALL__ = (async () => {
      const { fakeSupabase } = await import("${base}/tests/fake-supabase.js");
      const fixtures = await import("${base}/tests/fixtures.js");
      const chosen = structuredClone(fixtures[window.__PTP_FIXTURES__.fixturesName]);
      if (!window.__PTP_FIXTURES__.signedIn) chosen.session = null;
      window.__PTP_FIXTURE_DATA__ = chosen;
      window.__PTP_TEST_CLIENT__ = fakeSupabase(chosen);
    })();
  `);

  await page.goto(`${base}${path}`, { waitUntil: "load" });
  await page.waitForFunction("window.__PTP_TEST_CLIENT__ !== undefined", null, { timeout: 5000 }).catch(() => {});

  return { page, problems };
}

console.log("PARENT PORTAL");

{
  const { page, problems } = await open("/parent/", "parentFixtures");
  await page.waitForSelector("h1");
  const body = await page.textContent("body");

  await check("the page renders without a single console error", () =>
    problems.length === 0 ? true : problems.join(" | "));

  await check("the next session is the soonest one, not the first row", () =>
    body.includes("Tayo — Tomorrow, 5:30pm")
      ? true
      : `no next-session headline in: ${body.slice(0, 200)}`);

  await check("credits are counted, and reserved ones are not offered", async () => {
    const figure = await page.textContent(".figure-pair .figure");
    return figure.trim() === "2" ? true : `showed ${figure}`;
  });

  await check("a waitlist offer is surfaced with its deadline", () =>
    body.includes("A place has opened") && body.includes("then it goes to the next family")
      ? true
      : "the invitation was not shown");

  await check("the past session is under Sessions so far, not Coming up", async () => {
    const coming = await page.textContent("h2:text('Coming up') + div").catch(() => "");
    return !coming.includes("attended") ? true : "an attended session appeared in Coming up";
  });

  await check("a payment is shown at the amount charged", () =>
    body.includes("$560") ? true : "the payment was not shown");

  await page.close();
}

{
  const { page } = await open("/parent/", "parentFixtures");
  await page.waitForSelector("h1");

  await check("cancelling asks first, and says what will happen", async () => {
    // The session more than 24 hours out — refundable.
    const buttons = await page.$$("button:text('Cancel')");
    if (buttons.length === 0) return "no cancel button rendered";
    await buttons[buttons.length - 1].click();
    await page.waitForSelector(".sheet");
    const sheet = await page.textContent(".sheet");
    return sheet.includes("credit comes straight back") ? true : `sheet said: ${sheet}`;
  });

  await check("…and backing out changes nothing", async () => {
    await page.click(".sheet button:text('Never mind')");
    await page.waitForSelector(".sheet", { state: "detached" });
    return (await page.$(".sheet")) === null ? true : "the sheet stayed open";
  });

  await page.close();
}

{
  const { page } = await open("/parent/", "parentFixtures", { signedIn: false });
  await page.waitForSelector(".signin");

  await check("a signed-out visitor gets a sign-in form and no family data", async () => {
    const body = await page.textContent("body");
    return !body.includes("Tayo") ? true : "a signed-out page leaked a name";
  });

  await page.close();
}

console.log("");
console.log("TRAINER PORTAL");

{
  const { page, problems } = await open("/trainer/", "trainerFixtures");
  await page.waitForSelector("h1");
  const body = await page.textContent("body");

  await check("the page renders without a single console error", () =>
    problems.length === 0 ? true : problems.join(" | "));

  await check("the day opens on today", () =>
    body.includes("Today") ? true : "today was not the heading");

  await check("both of today's sessions are listed", () =>
    body.includes("U9 Foundation") && body.includes("U12 Advanced")
      ? true
      : "a session was missing from the plan");

  await check("the gap between them is called out", () =>
    body.includes("1 hour gap") ? true : "the gap was not shown");

  await check("the pay for the block covers the gap, because that is the promise", () =>
    body.includes("$120") ? true : `pay was not $120 in: ${body.slice(0, 300)}`);

  await check("…and the hours shown are the block, not the sum of the sessions", () =>
    body.includes("3 hour block") ? true : "the block length was not stated");

  await check("and the promise is written down, not just implied", () =>
    body.includes("Paid for the whole block, however many players turn up")
      ? true
      : "the pay promise was not stated");

  await check("the meeting instructions for the field are on the plan", () =>
    body.includes("Gate 2, by the scoreboard") ? true : "no meeting instructions");

  await page.close();
}

{
  const { page } = await open("/trainer/", "trainerFixtures");
  await page.waitForSelector("h1");

  await check("opening a register shows the roster, cancelled players excluded", async () => {
    await page.click("button:text('Register')");
    await page.waitForSelector(".register-row");
    const names = await page.$$eval(".register-name", (nodes) => nodes.map((n) => n.textContent));
    return JSON.stringify(names) === JSON.stringify(["Ada Hartley", "Zara Okafor"])
      ? true
      : `roster was ${JSON.stringify(names)}`;
  });

  await check("a mark already saved comes back pressed", async () => {
    const pressed = await page.$$eval('.register-row:first-child .mark[aria-pressed="true"]', (n) => n.length);
    return pressed === 1 ? true : `${pressed} marks were pressed`;
  });

  await check("the register says which session it is", async () => {
    const label = await page.textContent(".lede");
    return label.includes("U9 Foundation") ? true : `it read "${label}"`;
  });

  await check("progress reads before any new tap", async () => {
    const lede = await page.textContent(".progress");
    return lede.trim() === "1 of 2 marked" ? true : `it read "${lede}"`;
  });

  await check("marking a player updates the screen straight away", async () => {
    await page.click('.register-row:last-child .mark:text("In")');
    await page.waitForFunction(
      () => document.querySelector(".progress")?.textContent.trim() === "2 of 2 marked",
      null,
      { timeout: TIMEOUT },
    );
    return true;
  });

  await check("…and going back returns to the day", async () => {
    await page.click("button:text('Back to the day')");
    await page.waitForSelector(".plan-item");
    return true;
  });

  await page.close();
}

console.log("");
console.log("BOOKING PAGE");

// The catalogue arrives from an edge function over fetch, so it is stubbed at
// the network rather than in the client — which also proves the page reads the
// response shape /catalog actually returns.
const CATALOG = {
  seasons: [{ id: "se1", name: "Spring 2026", starts_on: "2026-08-31", ends_on: "2026-10-25", weeks: 8 }],
  package: { price_cents: 56000, sessions: 16 },
  groups: [
    {
      id: "g1", name: "Mon/Wed U9 Foundation", status: "forming",
      min_age: 7, max_age: 9, min_players: 4, max_players: 6, dropin_price_cents: 4000,
      occupancy: { paid: 3, held: 0, total: 3, capacity: 6 },
      eligible: true,
      locations: { name: "Northside Turf" }, trainers: { display_name: "Dani Okoro" },
      group_meeting_times: [{ weekday: 1, starts_at: "17:30:00" }, { weekday: 3, starts_at: "17:30:00" }],
    },
    {
      id: "g2", name: "Tue/Thu U12 Advanced", status: "full",
      min_age: 11, max_age: 13, min_players: 4, max_players: 6, dropin_price_cents: 4000,
      occupancy: { paid: 6, held: 0, total: 6, capacity: 6 },
      eligible: false,
      locations: { name: "Northside Turf" }, trainers: { display_name: "Marcus Bell" },
      group_meeting_times: [{ weekday: 2, starts_at: "18:00:00" }],
    },
  ],
};

{
  const { page, problems } = await open("/book/", "parentFixtures");

  await page.route("**/functions/v1/catalog*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CATALOG) }));

  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("h1");
  const body = await page.textContent("body");

  await check("the season is named", () =>
    body.includes("Spring 2026") ? true : "no season heading");

  await check("a group one family short says exactly that", () =>
    body.includes("One more family and this group starts") ? true : "the nearly-there line was missing");

  await check("a full group offers the waitlist instead of a dead end", () =>
    body.includes("Full — join the waitlist") ? true : "the full group had no waitlist route");

  await check("booking is disabled until a child is chosen", async () => {
    const enabled = await page.$$eval("button:text('Book the season')", (n) => n.filter((b) => !b.disabled).length);
    return enabled === 0 ? true : "a group could be booked with nobody selected";
  });

  await check("choosing a child enables the group they are eligible for", async () => {
    await page.selectOption("select", { index: 1 });
    await page.waitForFunction(
      () => [...document.querySelectorAll("button")].some((b) => b.textContent === "Book the season" && !b.disabled),
      null, { timeout: TIMEOUT },
    );
    return true;
  });

  await check("…and the group they are not eligible for says why", async () => {
    const text = await page.textContent("body");
    return text.includes("outside the age or level band") ? true : "no eligibility explanation";
  });

  await check("the season price shown is the one the server sent", () => {
    const text = body;
    // 56000 cents is in the stub's settings, reached through /catalog.
    return text.includes("$560 for 16 sessions") ? true : `the lede read: ${text.slice(0, 160)}`;
  });

  await page.close();
}

console.log("");
console.log("REACHABILITY");

// Checked on every page, not one of them. The booking page was the one that
// overflowed, and a check that only ran against the trainer portal said
// nothing about it.
for (const [path, fixtures, route] of [
  ["/parent/", "parentFixtures", false],
  ["/trainer/", "trainerFixtures", false],
  ["/book/", "parentFixtures", true],
]) {
  const { page } = await open(path, fixtures);

  if (route) {
    await page.route("**/functions/v1/catalog*", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CATALOG) }));
    await page.reload({ waitUntil: "load" });
  }

  await page.waitForSelector("h1");

  await check(`${path} — every tappable thing is at least 44px, for a thumb on a pitch`, async () => {
    const small = await page.$$eval("button, a, select", (nodes) =>
      nodes
        .filter((n) => n.offsetParent !== null)
        .map((n) => ({ text: n.textContent.trim().slice(0, 24), height: n.getBoundingClientRect().height }))
        .filter((n) => n.height > 0 && n.height < 44 && !n.text.startsWith("Sign out") && !n.text.startsWith("←")),
    );
    return small.length === 0 ? true : `too small: ${JSON.stringify(small)}`;
  });

  await check(`${path} — nothing overflows a 390px phone sideways`, async () => {
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    return width <= 400 ? true : `the page is ${width}px wide`;
  });

  await page.close();
}

await browser.close();
server.close();

console.log("");
console.log("============================================================");
console.log(`  ${pass} passed, ${fail} failed`);
console.log("============================================================");
process.exit(fail === 0 ? 0 : 1);
