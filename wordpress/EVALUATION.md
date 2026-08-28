# Evaluation — is this worth keeping?

An honest assessment of the four new plugins before you commit to them, written
after building them and then trying to break them.

**Verdict: the core is sound and the security properties hold under test. With
the training side, signed quotes, the Elements mount, refunds and reminders
added, it is roughly 85% of a working platform — and what is missing is known
and listed. The gating item is no longer code: it is one hour on a staging
site.**

---

## What was actually verified

147 assertions across 8 suites, run with `php tests/run.php`. These are not
smoke tests — each one is written as the attack it defends against, using the
exact shapes found in the audit of the old codebase.

| Suite | Asserts | What it proves |
|---|---|---|
| `test-cancellation` | 32 | A refund and a payout reversal never disagree costly |
| `test-payouts` | 28 | A trainer is paid the amount assigned, whatever the price |
| `test-authorisation` | 21 | One account cannot act as another |
| `test-slots` | 20 | Availability turns into the right bookable times |
| `test-pricing` | 19 | A customer cannot influence what they are charged |
| `test-stripe-webhook` | 13 | A forged payment notification cannot get through |
| `test-discounts` | 11 | A code cannot be abused or exhausted |
| `test-actor-cache` | 3 | Identity does not go stale mid-request |

The tests stub WordPress rather than requiring an install, so they run in CI in
under a second. That is deliberate: the logic worth testing here is arithmetic
and authorisation, neither of which needs a database.

### The attacks that were tried and failed

- Posting `price`, `unit_cents`, `amount`, `total`, `early_bird_amount`
  alongside a cart item — **ignored**, the item is priced from the database.
- Negative, zero, absurd and non-numeric quantities — **clamped**.
- Redeeming another account's quote — **refused**.
- Forging or replaying a quote id — **refused**.
- A fixed discount larger than the cart, and a percentage above 100 — **capped**
  at the subtotal; a total can never go negative.
- Validating a limited code repeatedly to exhaust it — **zero writes occur**.
- A webhook with no signature, the wrong secret, a tampered body, an hour-old
  timestamp, or five shapes of malformed header — **all rejected**.
- A webhook signed correctly while no secret is configured — **rejected**
  (fails closed).
- Walking player ids to reach another family's child — **refused**.
- A trainer acting on a parent-owned record — **refused**.
- A total, discount or owner rewritten in the object cache — **refused**, the
  signature no longer verifies.
- Booking a time the trainer is closed, an off-boundary start, or a slot already
  taken — **refused**.
- A discounted or premium-priced session changing what a trainer earns — **it
  does not**; pay is the assigned amount either way.

---

## Two real bugs the tests found

Both were in code I had written and reviewed, and neither was visible by
reading. This is the main argument for keeping the test suite.

**1. `absint(-5)` is `5`.** A customer posting `qty: -5` was billed for **five**
camp places. It overcharges rather than undercharges, so it was not a theft
route — but it is a chargeback and a support call. There was also no upper
bound, so `qty: 999999` was accepted. Fixed with an explicit clamp to 1–50.

**2. The actor cache went stale mid-request.** `PTP_Guard::current_actor()`
memoised into a method-level static shared across every Guard instance for the
whole request. Registration calls `wp_set_current_user()` immediately after
creating an account, so a just-registered customer could still resolve as a
guest. Fixed by keying the cache on user id.

---

## Known weaknesses — read before deciding

### ~~A quote edited in the object cache is trusted on re-read~~ — closed

Quotes are now signed with an HMAC over their own contents, keyed on the
install's `AUTH_SALT`, and verified on every re-read. A total, discount or owner
rewritten in the object cache fails verification and fires `ptp_quote_tampered`
rather than being charged. Covered by four assertions in `test-pricing`.

### `PTP_Actor` reaches into the global container

`PTP_Actor::from_user()` calls `ptp_core()` to resolve repositories, which makes
it awkward to test in isolation and couples the model to the container. It
works, and the test harness stubs around it. Worth cleaning up when convenient;
not worth blocking on.

### Nothing has run inside WordPress yet

This is the largest caveat. Everything above is verified logic. **Not one line
has executed against a real WordPress install, a real database, or the real
Stripe API.** Specifically unproven:

- `dbDelta()` accepting the schema as written (it is notoriously fussy about
  formatting)
- The autoloader resolving classes under a real plugin load order
- The Stripe API calls, which have been written against the documented shapes
  but never sent
- Whether the checkout JS correctly drives Stripe.js. The Elements mount is now
  written — it creates the intent, mounts the payment element, re-prices
  immediately before confirming, and confirms with `redirect: 'if_required'` —
  but it has never run against a real Stripe account.

Before this is worth keeping, it needs one hour on a staging site: activate the
four plugins, confirm the tables build, put a camp in the database, and take one
real test-mode payment end to end. If that works, the architecture is proven. If
`dbDelta` rejects the schema, that is an hour's fix, not a rethink.

---

## What is built vs. what is not

| | Files | Lines |
|---|---|---|
| Implemented | 65 | ~7,600 |
| Scaffolded (data wired, markup pending) | 11 | ~220 |

**Working:** core (schema, guard, actor, pricing, signed quotes, discounts,
Stripe, Connect payouts, slots, booking intent, mail, REST API, 6 repositories),
checkout with the Elements mount, the booking page, parent and trainer portals,
camps listing, thank-you, admin Today / Orders / Trainers / Settings, marketing
landing + Facebook webhook + attribution, both stylesheets, the token file, and
the mobile app's training client, hooks and booking screen.

**Scaffolded** — the data layer is wired and the page renders, but the markup is
a placeholder: camp detail, trainers, trainer detail, clinics, cart, login,
register, trainer application; admin Schedule, Customers, Discounts.

**Not started at all:**

- Trainer availability and the booking calendar — **now built**, see TRAINING.md
- The data migration from the old tables
- Camp/clinic admin editing beyond the WordPress post editor
- Reminder emails (only the receipt exists)
- Rescheduling in one step (cancel-and-rebook works, but loses the slot between)
- Trainer-side cancellation — a trainer who cannot make it must contact staff

---

## Honest read on the three options

**Keep it.** The expensive part — deciding the architecture and proving the
payment path cannot be manipulated — is done and tested. The remaining work is
mechanical: port markup into wired templates. The two bugs found were found
*because* the structure is small enough to test.

**Discard it.** Legitimate only if the old platform is closer to working than it
appears and the audit findings can be patched individually. They number seven
critical issues across three checkout paths, so I do not believe that, but it is
your call and your revenue.

**Hybrid — my recommendation.** Keep the new core and run it alongside the old
platform. Point new camps at the new checkout, leave existing flows alone, and
compare Stripe amounts for a week. That gives real evidence rather than my
assessment, and the rollback is deactivating three plugins.

---

## What I would want before calling this production-ready

1. One end-to-end test-mode payment on staging — proves the whole chain.
2. ~~HMAC-sign the quote~~ — done.
3. ~~Stripe Elements mount~~ — done, untested against live Stripe.
4. ~~Trainer availability and booking calendar~~ — done.
5. Port the remaining scaffolded templates.
6. Write and rehearse the data migration against a database copy.

Item 1 is the one that matters now: everything else is verified logic waiting on
a real environment to prove it.

---

## Running the tests

```bash
cd wordpress && php tests/run.php
```

No dependencies, no database, no WordPress install. Every suite runs in its own
process so a fatal in one cannot mask another, and so method statics do not leak
between suites.
