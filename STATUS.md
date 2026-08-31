# Build report

Where the platform stands, phase by phase, in the format the brief asks for.
Everything marked **executed** has been run; everything marked **not run** has
not, and the reason is given rather than implied.

---

## Phase 1 — Audit and staging

**Built.** `supabase/docs/PHASE-0-AUDIT.md`: what is in the old WordPress
system, what can be reused, what is replaced, and the three risks that need a
live environment to settle.

**Not run.** The audit is of the code, not of production. There is no access
here to the live site, its database, its Stripe account or its Quo and HubSpot
connections. No production change has been made, and none can be from here.

**Still needs a live environment:** whether Stripe is in live or test mode and
which webhooks are registered; the row counts and duplicate rates in
`ptp_parents` / `ptp_players` / `ptp_trainers`; how many trainers already have a
Stripe Connect account. The audit recommends settling those before the first
migration runs against real data.

---

## Phase 2 — Public website shell

**Built.** `web/` — the navigation exactly as specified (five sections, their
dropdowns, the gold *Find a Camp* CTA, the mobile drawer, a sticky bar with two
actions and no more), the homepage in its twelve sections, and every content
page the navigation promises.

**Design system.** `web/shared/styles.css`. Gold `#FCB900`, black `#0A0A0A`,
white. Oswald for headings, navigation, buttons, labels and table headers,
uppercase at `0.05em`. Inter for body. `border-radius: 0` everywhere, 2px
borders, no shadows, no gradients, hover fills gold with black text. Mobile
first; nothing tappable under 44px, asserted in the browser.

**Proof points.** Only the verified ones: 350+ athletes in 2026, 8:1 maximum
ratio, 74 players and 10 coaches at PTP × Colonial, two states. There is no
College Series section.

---

## Phase 3 — Supabase foundation

**Built.** Twenty migrations. 50 tables, RLS on every one, ~300 functions,
triggers, seed data, an append-only audit log and role-based access for
parents, trainers, administrators and the service role.

**Executed.** 187 assertions against PostgreSQL 16, applied from scratch each
run.

---

## Phase 4 — The 2027 camp engine

**Built.** One camp record and one detail template. `camps`, `camp_sessions`,
`camp_staffing`, `camp_addons`, `camp_registrations`, `camp_holds`,
`camp_interest`, `camp_attendance`, plus `camps_near()` — the single query
behind the ZIP finder, the state pages and the city pages.

Registration is the same shape as the training checkout: a hold, a
server-decided price, Stripe, then a webhook. The paperwork — emergency
contact, pickup, allergies and five agreements — is checked *before* Stripe, so
no family is charged for a place that cannot then be confirmed, and each
agreement is stored with a timestamp rather than a tick.

Three publication guards, each of which the old site failed at least once: no
camp opens on an unapproved field, none without a certificate of insurance,
none at $0.

---

## Phase 5 — Group and private training

**Built.** Seasons, eligibility, capacity and activation, packages, credits,
waitlists, cancellations, makeups, attendance, trainer blocks and pay. The
parent and trainer portals. The booking, group and private pages.

**The back-to-back rule.** A private is only offered where it joins existing
work. A weekend block needs two genuinely consecutive paid sessions. A
confirmed block survives a cancellation — the remaining family is honoured and
the trainer is still paid. An override needs a reason, and it is recorded.

---

## Phase 6 — The agent and the integrations

**Built.** Identity matching, consent, conversation states, ten tools, the
escalation triggers, the follow-up scheduler, the CRM view, and edge functions
for inbound SMS, inbound email, the agent turn and the HubSpot push.

See `supabase/docs/THE-AGENT.md` for what it can and cannot do, and why the
"cannot" is a set of missing grants rather than a paragraph of instruction.

**Now a separate module.** `supabase/modules/agent` installs and uninstalls on
its own; the platform runs without it. The line: the platform keeps identity,
consent, conversations, messages and the escalation queue, because a parent
reads their thread and staff work the queue whether or not anything automated
exists. The module keeps the model's view of a family, what it may offer, the
escalation regex, the follow-up queue and HubSpot.

Two things make that a boundary rather than a folder. `0020_modules.sql` adds
`platform_modules`, `module_jobs` and `module_metrics`, and rewrites the job
dispatcher to look a job up and call it by name — a module registers its work
instead of a case arm being added to core. And `verify.sh` now runs the core
alone first (booking path works, `scheduled_followups` does not exist, the
weekly summary still returns a number), installs the module, and at the end
uninstalls it and checks the platform still sells a season while every
message, thread and consent record survives.

---

## Phase 6b — Administration and reporting

**Built.** `0021_reports.sql`: payroll for a period, camp and group
utilisation, attendance, the morning operations view, the weekly summary, and
the two controls staff need — resolving an escalation and the automation pause
switch, both recorded in the audit log.

`/my-ptp/admin/` is the screen: what needs a person today, groups one family
from running, camps not selling, the machinery's failures, fields nobody has
confirmed, and payroll with a CSV export.

Every report asserts staff **inside the function**, not by hiding a button. An
administrator is an authenticated user, so the grant has to include
`authenticated` — which makes the guard in the body the only thing between a
parent and the payroll. Four of these functions were written without it and a
parent could read the whole payroll; the assertions now cover each one.

## Phase 7 — Testing

```
./test.sh
```

| | Assertions | Against |
|---|---|---|
| Database rules | 237 | PostgreSQL 16, built from the migrations each run |
| Stripe signature | 12 | the real source the edge function imports, under Node |
| Portal logic | 77 | pure functions with the clock injected |
| Portals rendered | 99 | real Chromium, real pages, stubbed backend |
| **Total** | **425** | |

`supabase/trace-booking.sh` runs one family's purchase end to end and prints
what changed at each step; its output is `supabase/docs/BOOKING-A-PACKAGE.md`.

---

## Known limitations

**No edge function has ever run.** There is no Deno runtime here and no Stripe,
Quo, HubSpot or model credentials. Twelve edge functions — eight platform,
four in the agent module — are design plus review. What they call is executed; they are not.

**The payment step is unproven.** Stripe Elements needs a `client_secret` only a
real `/checkout` can produce.

**The agent loop is unproven.** The tool contract, the escalation triggers, the
consent rules and the follow-up scheduler are all executed in SQL. The loop
around them — the model call, the tool round-trip, the retry behaviour — is not.

**Quo's signature scheme is assumed.** The webhook verifies an HMAC over
`${timestamp}.${body}`, which is Stripe's scheme. If Quo differs, that one
function changes; the verified implementation is shared and tested.

**Not built.** The WordPress API bridge; URL redirects from the old site; camp
registers in the trainer portal.

**The Expo app still points at WordPress.** It is a fourth client of the old
system, not a client of the new one.

**No photography.** The brief asks for real PTP images. There are none here, so
every page renders without them rather than with stock. Coach cards and camp
pages already read a `photo_url` and a gallery, and will show them the moment
they exist.

---

## Decisions that need you

1. **Where the public site lives.** The brief says WordPress is the public
   website. The pages in `web/` are static files that read live Supabase data,
   which WordPress cannot do without a bridge. Either serve `web/` as the site
   and keep WordPress only for legacy URLs behind redirects, or rebuild these
   as WordPress templates that call an authenticated API. The first is less
   work and fewer moving parts; the second keeps the CMS. **Nothing should go
   live until this is decided.**

2. **2027 camp prices.** Seeded at $395 full day and $275 half day as
   placeholders. Every camp carries its own price, so this is a number to set,
   not a change to make.

3. **Contact details.** The contact page has no phone number or email because
   nobody has given me one.

4. **The timezone rule for migrated data.** The old system stored wall-clock
   times with no zone. Getting this wrong shifts every historic session by an
   hour twice a year. It needs an explicit decision before any data moves.

5. **`late_cancel_issues_makeup`** is off. A late cancellation currently
   consumes the session. Turning it on converts it to a makeup instead.

6. **Trainer rates.** $40 per scheduled hour by default, $45 for one trainer in
   the demo data. Real rates are per trainer and yours to set.

7. **Which model the agent runs on**, and its confidence threshold — seeded at
   0.65, deliberately not low.

---

## The exact next step

Point this at a staging Supabase project and run the migrations. Then, in
order:

1. `supabase db push` against staging, then `./supabase/verify.sh` with
   `PGHOST` set to it — the same 237 assertions, against a real Supabase rather
   than a local Postgres, which will also prove the RLS grants behave as
   they do here. Then `supabase/modules/agent/install.sh install` if the agent
   is wanted on staging; the platform is deliberately fine without it.
2. Deploy the edge functions and run the checkout once with a Stripe test card.
   That is the first time any of this code will have executed.
3. Point Quo's webhook at `/quo-webhook` and text it. That is the second.

Until both have happened, nothing here should be described as working — only
as built and, where the table above says so, verified.
