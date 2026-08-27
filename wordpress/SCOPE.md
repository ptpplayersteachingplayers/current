# Core scope — what the platform is, before anything is added back

The instruction is to scrape the platform down to its core before building on
it. This document is the line. Anything not on the KEEP list does not get ported
into the new plugins, regardless of whether the old code still exists.

The value of a scrape-down is entirely in holding the line afterwards. The old
platform did not start at 350,000 lines; it got there one reasonable-sounding
addition at a time.

---

## The core

The business sells three things and needs to run them. That is the whole scope.

| # | Capability | Why it is core |
|---|---|---|
| 1 | Browse and buy a **camp** | Primary revenue |
| 2 | Browse and book a **trainer** | Primary revenue |
| 3 | Browse and book a **clinic** | Primary revenue |
| 4 | **Take payment** once, correctly | Without this, 1–3 are brochures |
| 5 | **Parent** sees what they booked | Cuts support load |
| 6 | **Trainer** sees their schedule | Trainers cannot work without it |
| 7 | **Staff** run orders, schedule, customers, trainers | The business runs on this |
| 8 | **Transactional email** — receipt, confirmation, reminder | Legally and operationally required |
| 9 | **Landing pages** for ads | Fills 1–3 |

That is what the four new plugins implement, in 5,096 lines.

---

## Cut — approved

Roughly **114,000 lines** across these categories.

| Category | Files | Lines |
|---|---|---|
| Mentorship, memberships, referrals, gift cards, viral/social | 47 | ~25,800 |
| Duplicate checkout and cart implementations (14 of 15) | 19 | 29,336 |
| Patch / fix / repair / bulletproof / backfill files | 32 | 21,539 |
| Version-suffixed duplicates (v2, v71, v99, v200, v305…) | 20 | 25,039 |
| `agent-N` bolt-ons | 10 | 10,449 |
| Dead and deprecated files | 8 | 2,939 |

The patch, duplicate and version-suffixed categories are not features at all —
they are workarounds for bugs in code that is itself being deleted. They leave
with it.

---

## Cut — non-core features

Built at some point, not required to sell a camp. None are ported.

| Feature | Lines | Note |
|---|---|---|
| SEO pages and location content | 5,640 | Keep the plain post-type permalinks; drop the generator |
| Cross-sell engine | 3,261 | |
| Growth / popups / pixels | 2,139 | Ad pixels move to PTP Marketing as a few lines |
| AI assistant and AI training plans | 1,791 | |
| Mobile optimisation shims | 1,715 | The new CSS is mobile-first; these existed to patch the old CSS |
| Reviews | 1,709 | See "worth a second look" |
| Quality control / trainer ranking | 1,603 | |
| Messaging | 1,522 | Parents and trainers currently use SMS anyway |
| Analytics dashboards | 1,354 | Stripe and GA already report this |
| Rebook / recurring | 1,249 | |
| Training plans | 1,172 | |
| Photo upload | 956 | Media library covers it |
| Google reviews widget | 874 | |
| Trainer insights | 910 | |
| Subscriptions | 789 | Nothing is sold on subscription today |
| Announcements | 772 | |
| SPA dashboard | 770 | A second dashboard for the same data |
| PWA / offline / manifest | 691 | |
| Platform protection | 632 | |
| n8n automation endpoints | 490 | |
| Export | 433 | |
| Maps | 388 | |
| Payroll | 350 | Trainer payouts are covered; this is staff payroll |
| FAQ | 269 | Page content, not code |
| Series seeder, ops mover | 505 | One-off migration scripts |

---

## Worth a second look before they go

Four of the cuts touch revenue directly. They are still cut — but cut
deliberately, not by accident. Each is small to rebuild later on the new
architecture if the numbers say it earned its place.

- **Abandoned cart recovery** (1,914 lines). This category genuinely recovers
  revenue. Cut for now because it depends on the old cart; rebuild against
  `ptp_orders` where `status = 'pending'`, which is a much smaller job than the
  original.
- **Reviews** (1,709 lines). Social proof on trainer profiles converts. Cut the
  implementation, keep the idea — a `reviews` table and a star rating on the
  profile is perhaps 200 lines.
- **SEO location pages** (5,640 lines). If these rank and bring traffic, check
  Search Console before deleting. The generated pages can stay live as static
  content without the generator.
- **Cross-sell** (3,261 lines). "Add a second week" at checkout is worth
  something. The new checkout can offer it in a few dozen lines when wanted.

Check analytics on these four before the code is gone, because afterwards you
will not be able to.

---

## The rule going forward

A feature earns a place in the platform when it is one of:

1. Something a customer pays for
2. Something without which staff cannot run the day
3. A legal or payment-processing requirement

Everything else is a candidate, not a commitment. If something does not fit the
nine capabilities at the top of this document, it needs a reason in writing
before it is built — that is the discipline that keeps this from becoming the
thing it replaced.

Practical guards, since intent alone did not hold last time:

- **One checkout.** A second payment path is never the answer to a checkout bug.
- **No file named** `-fix`, `-v2`, `-repair`, `-bulletproof` **or** `-hardening`.
  Fix the original file. That naming convention was the visible symptom of the
  real problem, which was fear of touching working code.
- **Core owns the tables.** A feature plugin that needs its own table is a sign
  the feature belongs in core, or does not belong at all.
- **A page is a page.** Two shortcodes for one screen means one is wrong.
