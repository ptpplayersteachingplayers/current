// =============================================================================
// Generate the page shells
// =============================================================================
//   node web/build-pages.mjs
//
// Every public page is the same document with a different module. Generating
// them means the head, the fonts and the boot sequence cannot drift apart —
// and adding a page is one line here rather than forty lines of copy-paste.
// =============================================================================

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pageHtml } from "./shared/shell.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

const PAGES = [
  // path, title, description, module, portal variant, needs Stripe
  ["index.html", "PTP — Train With College Athletes Who Are Still In The Game",
   "Summer camps, small-group training and private sessions for players ages 6–14 across Pennsylvania and New Jersey.",
   "/home.js"],

  ["find-a-camp/index.html", "Find a 2027 Camp — PTP",
   "Search PTP summer camps by ZIP code, state, player age and full or half day.",
   "/find-a-camp/app.js"],

  ["camp/index.html", "Camp — PTP",
   "Camp details, dates, coaches and registration.",
   "/camp/app.js", null, true],

  ["camps/index.html", "Camp Locations — PTP",
   "Every PTP camp location across Pennsylvania and New Jersey.",
   "/camps/app.js"],

  ["camps/pennsylvania/index.html", "Pennsylvania Camps — PTP",
   "PTP summer camps in Pennsylvania.", "/camps/app.js"],

  ["camps/new-jersey/index.html", "New Jersey Camps — PTP",
   "PTP summer camps in New Jersey.", "/camps/app.js"],

  ["training/index.html", "How Training Works — PTP",
   "Year-round group and private training for players ages 6–14.",
   "/training/app.js"],

  ["group-training/index.html", "Group Training — PTP",
   "Eight-week seasons, two sessions a week, six players at most.",
   "/group-training/app.js", null, true],

  ["private-training/index.html", "Private Training — PTP",
   "One player, one coach, weekend blocks at $100 an hour.",
   "/private-training/app.js", null, true],

  ["coaches/index.html", "Meet the Coaches — PTP",
   "The current college and professional players who coach at PTP.",
   "/coaches/app.js"],

  ["my-ptp/index.html", "My PTP",
   "Sign in to your PTP account.", "/my-ptp/app.js"],

  ["my-ptp/parent/index.html", "Your PTP Account",
   "Sessions, camps, credits and payments for your family.",
   "/my-ptp/parent/app.js", "parent"],

  ["my-ptp/trainer/index.html", "PTP Trainer",
   "Your day, your registers and your hours.",
   "/my-ptp/trainer/app.js", "trainer"],

  ["bring-ptp-to-your-community/index.html", "Bring PTP to Your Community",
   "If you have a field and a group of players, we will bring the coaches.",
   "/bring-ptp-to-your-community/app.js"],

  ["private-training/pay/index.html", "Confirm your session — PTP",
   "Pay for a private training session.", "/private-training/pay/app.js", null, true],
];

// The pages that are words rather than software. One template, one content
// file — which is how a link in the navigation cannot promise a page that does
// not exist.
const CONTENT = [
  ["camps/experience/index.html", "The Camp Experience — PTP",
   "What a week at a PTP camp is actually like."],
  ["camps/faqs/index.html", "Camp FAQs — PTP",
   "What to bring, what happens if it rains, and what a refund looks like."],
  ["training/faqs/index.html", "Training FAQs — PTP",
   "How seasons, credits, cancellations and private blocks work."],
  ["clinics/index.html", "Clinics and Events — PTP",
   "One-off sessions for clubs, townships and schools."],
  ["apply-to-coach/index.html", "Apply to Coach — PTP",
   "Coaching work for current college and professional players."],
  ["about/index.html", "Why PTP",
   "Players teaching players: small groups, current players, straight answers."],
  ["about/story/index.html", "Our Story — PTP", "How PTP started."],
  ["about/reviews/index.html", "Parent Reviews — PTP", "What families said about summer 2026."],
  ["about/2026-recap/index.html", "2026 Summer Recap — PTP", "What last year looked like, in numbers."],
  ["contact/index.html", "Contact PTP", "Text us — it is the fastest way, and it is a person."],
  ["policies/index.html", "Policies — PTP",
   "Refunds, cancellations, weather, photographs, messages and your data."],
];

for (const [path, title, description] of CONTENT) {
  PAGES.push([path, title, description, "/shared/content-page.js"]);
}

for (const [path, title, description, module, portal, stripe] of PAGES) {
  let html = pageHtml({ title, description, module, portal });

  if (stripe) {
    html = html.replace(
      '<link rel="stylesheet" href="/shared/styles.css">',
      '<link rel="stylesheet" href="/shared/styles.css">\n  <script src="https://js.stripe.com/v3/"></script>',
    );
  }

  const target = join(ROOT, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, html);
  console.log("wrote", path);
}
