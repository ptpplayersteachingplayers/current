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
const TIMEOUT = 8000;

// Stripe's own script is not reachable from here, so the tests serve a stand-in
// that records what the page asked it to do. The point is to exercise the real
// mountStripe() path — the client secret it is handed, the return_url it
// confirms with — not to test Stripe.
const STRIPE_STUB = `
  window.__STRIPE_CALLS__ = [];
  window.Stripe = (publishableKey) => {
    window.__STRIPE_CALLS__.push(["Stripe", publishableKey]);
    return {
      elements: (options) => {
        window.__STRIPE_CALLS__.push(["elements", options.clientSecret]);
        return {
          create: () => ({
            mount: (node) => {
              window.__STRIPE_CALLS__.push(["mount"]);
              node.textContent = "[ Stripe payment form ]";
            },
          }),
        };
      },
      confirmPayment: async ({ confirmParams }) => {
        window.__STRIPE_CALLS__.push(["confirmPayment", confirmParams.return_url]);
        return {};
      },
    };
  };
`;


let pass = 0;
let fail = 0;

// A page that does not load is a failing assertion, not a crash. The suite
// used to die on the first navigation timeout, printing no summary and
// silently skipping everything after it — which is how a whole restructure
// went green-looking while three routes were 404.
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
async function open(path, fixturesName, { signedIn = true, routes = [] } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(TIMEOUT);

  const problems = [];
  page.on("pageerror", (error) => problems.push(String(error.message)));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()}`));

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
      // structuredClone cannot copy a function, and the rpc handlers in a
      // fixture are functions. Clone the data, carry the handlers across.
      const source = fixtures[window.__PTP_FIXTURES__.fixturesName];
      const chosen = {
        ...structuredClone({ session: source.session ?? null, tables: source.tables }),
        rpc: source.rpc,
      };
      if (!window.__PTP_FIXTURES__.signedIn) chosen.session = null;
      window.__PTP_FIXTURE_DATA__ = chosen;
      window.__PTP_TEST_CLIENT__ = fakeSupabase(chosen);
    })();
  `);

  // Stripe's script is fetched from js.stripe.com by the booking page. There
  // is no internet here, so it is served from the test instead — which means
  // the page's real loading path is what runs, not a bypass of it.
  await page.route("https://js.stripe.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: STRIPE_STUB }));

  // No internet here, and a font request that hangs stops the page firing
  // load. Served empty: the fallback stacks in the stylesheet are what the
  // tests measure against anyway.
  await page.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.route("https://fonts.gstatic.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "font/woff2", body: "" }));

  // Registered before the first navigation, so the page's own first fetch is
  // answered rather than failing and being retried after a reload.
  for (const [pattern, handler] of routes) await page.route(pattern, handler);

  await page.goto(`${base}${path}`, { waitUntil: "load" });
  await page.waitForFunction("window.__PTP_TEST_CLIENT__ !== undefined", null, { timeout: TIMEOUT }).catch(() => {});

  // Wait for the app to have painted something, whatever that something is —
  // a heading, a card, or the sign-in form. Every assertion below then starts
  // from a page that has finished its first render.
  await page
    .waitForSelector("#app h1, #app .card, #app .signin", { timeout: 15_000 })
    .catch(() => {});

  return { page, problems };
}

console.log("PARENT PORTAL");

{
  const { page, problems } = await open("/my-ptp/parent/", "parentFixtures");
  await page.waitForSelector("h1");
  const body = await page.textContent("body");

  await check("the page renders without a single console error", () =>
    problems.length === 0 ? true : problems.join(" | "));

  await check("the next session is the soonest one, not the first row", async () => {
    // The fixture lists the further booking first. What the hero shows must
    // match the first card under Coming up, which is the soonest.
    const hero = await page.textContent(".card-inverse h3");
    const first = await page.textContent("h2:text('Coming up') + div .card .meta");
    return hero.includes(first.trim()) ? true : `hero said "${hero}", the list said "${first}"`;
  });

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

  await check("the home tab leads with what is next, not with a ledger", () =>
    !body.includes("Season package") ? true : "the payment history is on the home tab");

  await page.close();
}

{
  const { page } = await open("/my-ptp/parent/", "parentFixtures");
  await page.waitForSelector("h1");

  await check("a session inside the free-cancellation window is flagged before the tap", async () => {
    const notices = await page.$$eval(".notice", (nodes) => nodes.map((n) => n.textContent));
    return notices.some((n) => n.includes("not refundable"))
      ? true
      : "the session five hours away was not flagged";
  });

  await check("cancelling asks first, and says what will happen", async () => {
    // The last card is the booking forty hours out — refundable.
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
  const { page } = await open("/my-ptp/parent/", "parentFixtures", { signedIn: false });
  await page.waitForSelector(".signin");

  await check("a signed-out visitor gets a sign-in form and no family data", async () => {
    const body = await page.textContent("body");
    return !body.includes("Tayo") ? true : "a signed-out page leaked a name";
  });

  await page.close();
}

{
  // Four tabs in the bottom bar, and every one of them has to go somewhere.
  // Three of them used to be anchors to nothing.
  const { page } = await open("/my-ptp/parent/", "parentFixtures");
  await page.waitForSelector("#app h1");

  await check("the schedule tab lists everything booked", async () => {
    await page.click(".portal-nav a:text('Schedule')");
    await page.waitForFunction(() => document.querySelector("#app h1")?.textContent === "Schedule",
      null, { timeout: TIMEOUT });
    const text = await page.textContent("#app");
    return text.includes("Coming up") && text.includes("Sessions so far")
      ? true : "the schedule was empty";
  });

  await check("the messages tab shows the thread and a way to reply", async () => {
    await page.click(".portal-nav a:text('Messages')");
    await page.waitForFunction(() => document.querySelector("#app h1")?.textContent === "Messages",
      null, { timeout: TIMEOUT });
    const box = await page.$("#app textarea");
    return box !== null ? true : "no way to reply";
  });

  await check("the account tab holds the payments and the consent", async () => {
    await page.click(".portal-nav a:text('Account')");
    await page.waitForFunction(() => document.querySelector("#app h1")?.textContent === "Account",
      null, { timeout: TIMEOUT });
    const text = await page.textContent("#app");
    return text.includes("$560") && text.includes("Reply STOP")
      ? true : "payments or consent were missing";
  });

  await check("…and the tab you are on is the one marked", async () => {
    const current = await page.$$eval('.portal-nav a[aria-current="page"]', (n) => n.map((a) => a.textContent));
    return JSON.stringify(current) === JSON.stringify(["Account"])
      ? true : `marked: ${JSON.stringify(current)}`;
  });

  await check("the tab survives a reload, so it can be linked to", async () => {
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#app h1");
    const heading = await page.textContent("#app h1");
    return heading === "Account" ? true : `it reloaded on ${heading}`;
  });

  await page.close();
}

console.log("");
console.log("TRAINER PORTAL");

{
  const { page, problems } = await open("/my-ptp/trainer/", "trainerFixtures");
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
  const { page } = await open("/my-ptp/trainer/", "trainerFixtures");
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

{
  const { page } = await open("/my-ptp/trainer/", "trainerFixtures");
  await page.waitForSelector("#app h1");

  await check("the trainer's schedule tab shows the month as blocks", async () => {
    await page.click(".portal-nav a:text('Schedule')");
    await page.waitForFunction(() => document.querySelector("#app h1")?.textContent === "Schedule",
      null, { timeout: TIMEOUT });
    const text = await page.textContent("#app");
    return text.includes("hour block") || text.includes("Nothing booked")
      ? true : "the schedule showed neither blocks nor an empty state";
  });

  await check("the pay tab shows what is owed and what is paid", async () => {
    await page.click(".portal-nav a:text('Pay')");
    await page.waitForFunction(() => document.querySelector("#app h1")?.textContent === "Pay",
      null, { timeout: TIMEOUT });
    const text = await page.textContent("#app");
    return text.includes("awaiting payout") && text.includes("paid for its length")
      ? true : "the pay promise or the total was missing";
  });

  await check("the messages tab routes a field problem to the office", async () => {
    await page.click(".portal-nav a:text('Messages')");
    await page.waitForFunction(() => document.querySelector("#app h1")?.textContent === "Messages",
      null, { timeout: TIMEOUT });
    const text = await page.textContent("#app");
    return text.includes("Locked gate") ? true : "no route for a field problem";
  });

  await page.close();
}

console.log("");
console.log("ADMIN");

{
  const { page, problems } = await open("/my-ptp/admin/", "adminFixtures");
  await page.waitForSelector("#app h2, #app h1", { timeout: TIMEOUT });
  const body = await page.textContent("#app");

  await check("the admin console renders without a console error", () =>
    problems.length === 0 ? true : problems.join(" | "));

  await check("it leads with what needs a person", () =>
    body.includes("Needs a person") && body.includes("reported an injury")
      ? true : "the queue was not first");

  await check("…and an overdue one is marked as such", async () => {
    const marked = await page.$$eval(".card-overdue", (n) => n.length);
    return marked === 1 ? true : `${marked} rows marked overdue`;
  });

  await check("a group one family short is surfaced", () =>
    body.includes("1 to start") ? true : "the nearly-running group was missing");

  await check("a camp that is not selling is surfaced with its fill rate", () =>
    body.includes("20%") ? true : "no fill rate shown");

  await check("a field nobody has confirmed is called out", () =>
    body.includes("Westgate Park") ? true : "unverified fields were not shown");

  await check("staff are not sold to: no marketing footer or Find a Camp bar", async () => {
    const footer = await page.$(".site-footer");
    const bar = await page.$(".action-bar");
    return footer === null && bar === null
      ? true
      : `${footer ? "footer " : ""}${bar ? "action bar" : ""} on the admin console`;
  });

  await check("the pause switch says what it will actually do before it does it", async () => {
    await page.click("button:text('Pause all automation')");
    await page.waitForSelector(".sheet", { timeout: TIMEOUT });
    const sheet = await page.textContent(".sheet");
    await page.click(".sheet button:text('Never mind')");
    return sheet.includes("no agent replies") && sheet.includes("Bookings and payments carry on")
      ? true : `the sheet said: ${sheet.slice(0, 140)}`;
  });

  await check("closing an escalation asks what was done", async () => {
    await page.click("button:text('Resolve')");
    await page.waitForSelector(".sheet", { timeout: TIMEOUT });
    const hasNote = await page.$(".sheet input[type=text]");
    const hasResume = await page.$(".sheet input[type=checkbox]");
    await page.click(".sheet button:text('Never mind')");
    return hasNote && hasResume ? true : "no note or no choice about the assistant";
  });

  await page.close();
}

{
  const { page } = await open("/my-ptp/admin/", "adminFixtures");
  await page.waitForSelector("#app");

  await check("the pay tab totals what is owed", async () => {
    await page.click(".tab:text('Pay')");
    await page.waitForFunction(() => document.querySelector("#app h1")?.textContent === "Pay",
      null, { timeout: TIMEOUT });
    const text = await page.textContent("#app");
    return text.includes("$160") && text.includes("$800") ? true : "the totals were wrong or missing";
  });

  await check("…flags a trainer with no Stripe account", async () => {
    const text = await page.textContent("#app");
    return text.includes("No Stripe account connected") ? true : "the missing account was not flagged";
  });

  await check("…and recording a payment says plainly that no money moves", async () => {
    await page.click("button:text('Mark $160 paid')");
    await page.waitForSelector(".sheet", { timeout: TIMEOUT });
    const sheet = await page.textContent(".sheet");
    await page.click(".sheet button:text('Never mind')");
    return sheet.includes("does not move any money") ? true : `it said: ${sheet.slice(0, 120)}`;
  });

  await check("the camps tab shows fill and revenue together", async () => {
    await page.click(".tab:text('Camps')");
    await page.waitForFunction(() => document.querySelector("#app h1")?.textContent === "Camps",
      null, { timeout: TIMEOUT });
    const text = await page.textContent("#app");
    return text.includes("6/60") && text.includes("$2,370") ? true : `it showed: ${text.slice(0, 200)}`;
  });

  await page.close();
}

console.log("");
console.log("BOOKING PAGE");

// The catalogue arrives from an edge function over fetch, so it is stubbed at
// the network. Note what this can and cannot prove: it exercises how the page
// reads the response, not whether /catalog can produce it. An audit found the
// endpoint querying a column that does not exist, and this stub could not
// catch it because it encoded the same wrong name. The column names below are
// now the ones in 0003, and the shape is checked against the schema in
// verify.sh rather than asserted here.
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
      group_meeting_times: [{ weekday: 1, starts_time: "17:30:00", duration_minutes: 60 },
                            { weekday: 3, starts_time: "17:30:00", duration_minutes: 60 }],
    },
    {
      id: "g2", name: "Tue/Thu U12 Advanced", status: "full",
      min_age: 11, max_age: 13, min_players: 4, max_players: 6, dropin_price_cents: 4000,
      occupancy: { paid: 6, held: 0, total: 6, capacity: 6 },
      eligible: false,
      locations: { name: "Northside Turf" }, trainers: { display_name: "Marcus Bell" },
      group_meeting_times: [{ weekday: 2, starts_time: "18:00:00", duration_minutes: 60 }],
    },
  ],
};

const catalogRoute = ["**/functions/v1/catalog*", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CATALOG) })];

{
  const { page, problems } = await open("/group-training/", "parentFixtures", { routes: [catalogRoute] });
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
console.log("BOOKING A PACKAGE, END TO END");

// Stripe's own script is not loaded here, so it is replaced with something
// that records what the page asked it to do. The point is to exercise the real
// mountStripe() path — the client secret it is handed, the return_url it
// confirms with — not to test Stripe.
{
  // What /checkout returns: an amount the server decided, and a client secret.
  // Note what is NOT in the request — the page never sends a price.
  const checkoutRequests = [];
  const checkoutRoute = ["**/functions/v1/checkout", (route) => {
    checkoutRequests.push(JSON.parse(route.request().postData() ?? "{}"));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        intent_id: "ci1",
        amount_cents: 56000,
        currency: "usd",
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        client_secret: "pi_test_123_secret_abc",
        publishable_key: "pk_test_stub",
      }),
    });
  }];

  const { page, problems } = await open("/group-training/", "parentFixtures", {
    routes: [catalogRoute, checkoutRoute],
  });
  await page.waitForSelector("h1");
  await page.selectOption("select", { index: 1 });
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some((b) => b.textContent === "Book the season" && !b.disabled),
    null, { timeout: TIMEOUT },
  );

  await page.click("button:text('Book the season')");
  await page.waitForSelector("#payment-element", { timeout: TIMEOUT });
  const summary = await page.textContent("body");

  await check("the checkout asks for a group and a child, and never a price", () => {
    const [request] = checkoutRequests;
    if (!request) return "no checkout request was made";
    const keys = Object.keys(request).sort().join(",");
    return keys === "idempotency_key,kind,player_id,target_id"
      ? true
      : `the request carried: ${keys}`;
  });

  await check("…with an idempotency key, so a double tap is one purchase", () =>
    checkoutRequests[0].idempotency_key?.length > 10 ? true : "no idempotency key");

  await check("the amount shown is the one the server priced", () =>
    summary.includes("$560") ? true : "the server's amount was not shown");

  await check("the hold is shown counting down, from the server's own expiry", () =>
    /held for 1[0-4]:\d\d while you pay/.test(summary) ? true : "no live hold countdown");


  await check("Stripe is handed the client secret and nothing else", async () => {
    const calls = await page.evaluate(() => window.__STRIPE_CALLS__);
    const elements = calls.find((c) => c[0] === "elements");
    return elements?.[1] === "pi_test_123_secret_abc" ? true : `elements got ${JSON.stringify(elements)}`;
  });

  await check("the payment form is mounted into the page", () =>
    summary.includes("[ Stripe payment form ]") ? true : "the form did not mount");

  await check("paying sends the parent back to their account", async () => {
    await page.click("button:text('Pay $560')");
    await page.waitForFunction(
      () => window.__STRIPE_CALLS__.some((c) => c[0] === "confirmPayment"),
      null, { timeout: TIMEOUT },
    );
    const calls = await page.evaluate(() => window.__STRIPE_CALLS__);
    const confirm = calls.find((c) => c[0] === "confirmPayment");
    return confirm[1].endsWith("/my-ptp/parent/") ? true : `return_url was ${confirm[1]}`;
  });

await check("…and an expired hold says the place went back, and nothing was charged", async () => {
    await page.evaluate(() => {
      // Wind the clock past the expiry the server gave us.
      const original = Date.now;
      Date.now = () => original() + 16 * 60_000;
    });
    await page.waitForFunction(
      () => document.body.textContent.includes("gone back on the board"),
      null, { timeout: TIMEOUT },
    );
    const text = await page.textContent(".notice");
    return text.includes("Nothing was charged") ? true : `it said: ${text}`;
  });

  await check("the whole flow raised no console errors", () =>
    problems.length === 0 ? true : problems.join(" | "));

  await page.close();
}

{
  // What the parent sees in the seconds after paying, before the webhook has
  // created the booking.
  const { page } = await open("/my-ptp/parent/", "midCheckoutFixtures");
  await page.waitForSelector("h1");
  const body = await page.textContent("body");

  await check("a paid-but-unsettled checkout says so, at the top", () =>
    body.includes("Payment received") ? true : "nothing acknowledged the payment");

  await check("…and tells them plainly not to pay twice", () =>
    body.includes("do not need to pay again") ? true : "no reassurance was given");

  await check("…and the amount is the amount they were charged", () =>
    body.includes("$560 paid") ? true : "the amount was not repeated back");

  await page.close();
}

console.log("");
console.log("NAVIGATION");

// Every destination the header, drawer and footer promise. A nav link to a
// page that does not exist is the defect this whole suite exists to catch, and
// it is the one a human reviewer never clicks all of.
{
  const { page } = await open("/", "parentFixtures", { routes: [catalogRoute] });
  await page.waitForSelector("h1");

  const links = await page.$$eval("a[href^='/']", (nodes) =>
    [...new Set(nodes.map((n) => n.getAttribute("href")))]);

  await check("the navigation offers every section the brief specifies", () => {
    const required = ["/find-a-camp/", "/camps/pennsylvania/", "/camps/new-jersey/",
                      "/camps/", "/camps/experience/", "/camps/faqs/",
                      "/bring-ptp-to-your-community/", "/group-training/", "/private-training/",
                      "/clinics/", "/training/", "/training/faqs/", "/coaches/",
                      "/apply-to-coach/", "/about/", "/about/story/", "/about/reviews/",
                      "/about/2026-recap/", "/contact/", "/policies/",
                      "/my-ptp/parent/", "/my-ptp/trainer/"];
    const missing = required.filter((href) => !links.includes(href));
    return missing.length === 0 ? true : `not linked: ${missing.join(", ")}`;
  });

  await check("…and every one of them is a page that exists", async () => {
    const broken = [];
    for (const href of links) {
      const response = await page.request.get(`${base}${href}`);
      if (!response.ok()) broken.push(`${href} → ${response.status()}`);
    }
    return broken.length === 0 ? true : broken.join(", ");
  });

  await check("the logo goes home, and there is no separate Home link", () => {
    const wordmark = links.includes("/");
    const home = links.filter((h) => h === "/home" || h === "/index.html");
    return wordmark && home.length === 0 ? true : "a Home link crept in";
  });

  await page.close();
}

{
  const { page } = await open("/", "parentFixtures", { routes: [catalogRoute] });
  await page.waitForSelector("h1");

  await check("the mobile drawer opens and closes", async () => {
    await page.click("button.menu-toggle");
    await page.waitForSelector(".drawer", { state: "visible", timeout: TIMEOUT });

    const groups = await page.$$eval(".drawer-group > button", (n) => n.map((b) => b.textContent.trim()));

    await page.click("button.menu-toggle");
    // state: hidden, not a [hidden] selector — a hidden element is not
    // "visible", so the default wait can never be satisfied by one.
    await page.waitForSelector(".drawer", { state: "hidden", timeout: TIMEOUT });

    return groups.length === 5 ? true : `the drawer listed ${JSON.stringify(groups)}`;
  });

  await check("the sticky bar carries two actions and no more", async () => {
    const actions = await page.$$eval(".action-bar a", (nodes) => nodes.map((n) => n.textContent));
    return actions.length === 2 && actions[0] === "Find a Camp" && actions[1] === "Book Training"
      ? true
      : `it carried: ${JSON.stringify(actions)}`;
  });

  await page.close();
}

console.log("");
console.log("THE DESIGN SYSTEM, MEASURED");

// These are the audit that produced the current spacing system, kept as
// assertions so its findings cannot quietly come back. The first version
// scored twenty-four enclosed boxes on the homepage, eleven different gap
// values with no scale, and 154-character lines.
async function measure(page) {
  return await page.evaluate(() => {
    const vis = [...document.querySelectorAll("main *")]
      .filter((n) => n.offsetParent !== null && n.getBoundingClientRect().height > 0);

    const CONTROL = new Set(["BUTTON", "INPUT", "SELECT", "TEXTAREA", "TABLE", "TH", "TD", "A"]);

    const enclosed = vis.filter((n) => {
      if (CONTROL.has(n.tagName)) return false;
      if (n.classList.contains("badge") || n.classList.contains("mark")) return false;
      if (n.classList.contains("tile")) return false;      // deliberate objects
      const c = getComputedStyle(n);
      return ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"]
        .every((k) => parseFloat(c[k]) >= 1);
    });

    const gaps = new Set();
    for (const parent of vis) {
      const kids = [...parent.children]
        .filter((k) => k.offsetParent !== null && k.getBoundingClientRect().height > 4);
      for (let i = 1; i < kids.length; i++) {
        // A tile's last child is pushed to the bottom by `margin-top: auto`, so
        // a row of tiles has its buttons on one line. The gap is whatever is
        // left over — a deliberate fill, not a chosen value, and measuring it
        // against the scale would be measuring the wrong thing. (getComputedStyle
        // resolves auto to pixels, so the tile is what identifies it.)
        if (parent.classList.contains("tile") && i === kids.length - 1) continue;

        const a = kids[i - 1].getBoundingClientRect();
        const z = kids[i].getBoundingClientRect();
        const g = Math.round(z.top - a.bottom);
        if (g > 0 && g < 200) gaps.add(g);
      }
    }

    const overlong = vis
      .filter((n) => n.tagName === "P" && n.textContent.trim().length > 90)
      .map((p) => Math.round(p.getBoundingClientRect().width / (parseFloat(getComputedStyle(p).fontSize) * 0.5)))
      .filter((chars) => chars > 80);

    const sizes = [...new Set(vis.map((n) => parseFloat(getComputedStyle(n).fontSize)))].sort((a, z) => a - z);

    return { enclosed: enclosed.length, gaps: [...gaps].sort((a, z) => a - z), overlong, sizes };
  });
}

// The scale from styles.css. A gap that is not one of these is an ad-hoc
// margin, which is what "no system" looks like from the outside.
const SCALE = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128];

for (const [path, label, routes] of [
  ["/", "homepage", [catalogRoute]],
  ["/policies/", "a page of prose", []],
  ["/find-a-camp/", "the finder", []],
]) {
  const { page } = await open(path, "parentFixtures", { routes });
  await page.waitForSelector("#app h1");

  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const m = await measure(page);

    await check(`${label} @ ${width}px — no prose is wrapped in a box`, () =>
      m.enclosed === 0 ? true : `${m.enclosed} enclosed containers`);

    await check(`${label} @ ${width}px — every gap is on the spacing scale`, () => {
      const off = m.gaps.filter((g) => !SCALE.includes(g));
      return off.length === 0 ? true : `off-scale gaps: ${off.join(", ")}`;
    });

    await check(`${label} @ ${width}px — nothing runs past 80 characters a line`, () =>
      m.overlong.length === 0 ? true : `line lengths: ${m.overlong.join(", ")}`);
  }

  await page.close();
}

console.log("");
console.log("WHEN WE CANNOT BE REACHED");

// The state a parent is most likely to hit and least likely to be designed
// for. The first version of this printed one unstyled sentence into an empty
// page: no gutter, no way back, no way to reach a person.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(TIMEOUT);

  // No Supabase client injected, and the CDN refused — exactly what a bad
  // connection looks like from the page's side.
  await page.route("https://esm.sh/**", (route) => route.abort());
  await page.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" }));

  await page.goto(`${base}/find-a-camp/`, { waitUntil: "load" });
  await page.waitForSelector("#app h1", { timeout: 15_000 });

  const body = await page.textContent("body");

  await check("a page that cannot load its data still renders a page", () =>
    body.includes("We cannot load this right now")
      ? true
      : `it showed: ${body.slice(0, 120)}`);

  await check("…that reassures rather than alarms", () =>
    body.includes("your place are all safe") ? true : "no reassurance");

  await check("…offers a way to try again and a way out", async () => {
    const actions = await page.$$eval("#app .button", (n) => n.map((b) => b.textContent.trim()));
    return actions.includes("Try again") && actions.includes("Back to the start")
      ? true
      : `it offered: ${JSON.stringify(actions)}`;
  });

  await check("…and a way to reach a person", () =>
    body.includes("book you in over the phone") ? true : "no human route offered");

  await check("…with the navigation still on the page", async () => {
    const nav = await page.$(".site-header");
    return nav !== null ? true : "the header went with it";
  });

  await check("…and nothing running off the side of the phone", async () => {
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    return width <= 400 ? true : `the page is ${width}px wide`;
  });

  await page.close();
}

console.log("");
console.log("REACHABILITY");

// Checked on every page, not one of them. The booking page was the one that
// overflowed, and a check that only ran against the trainer portal said
// nothing about it.
for (const [path, fixtures, route] of [
  ["/my-ptp/parent/", "parentFixtures", false],
  ["/my-ptp/trainer/", "trainerFixtures", false],
  ["/group-training/", "parentFixtures", true],
]) {
  const { page } = await open(path, fixtures, { routes: route ? [catalogRoute] : [] });
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
