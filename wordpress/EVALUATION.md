# Evaluation — is this worth keeping?

An honest assessment of the four new plugins before you commit to them, written
after building them and then trying to break them.

**Verdict: the core is sound and the security properties hold under test. It is
roughly 60% of a working platform, and the remaining 40% is known and listed.**

---

## What was actually verified

64 assertions across 5 suites, run with `php tests/run.php`. These are not
smoke tests — each one is written as the attack it defends against, using the
exact shapes found in the audit of the old codebase.

| Suite | Asserts | What it proves |
|---|---|---|
| `test-pricing` | 16 | A customer cannot influence what they are charged |
| `test-authorisation` | 21 | One account cannot act as another |
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

### A quote edited in the object cache is trusted on re-read

Quotes are cached server-side as transients and re-read by id at payment. If
your object cache (Redis, Memcached) is writable by an attacker, a total can be
rewritten there. This is a real limitation, marked `NOTE:` in the test suite
rather than hidden.

It is a meaningfully smaller hole than the old design — it requires
infrastructure access rather than a browser — but it is not nothing. If you want
it closed, sign the quote with an HMAC over its contents and verify on re-read.
That is about 20 lines. **My recommendation: do it before launch**, since it is
cheap and this is the one place a total can still be altered.

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
- Whether the checkout JS correctly drives Stripe.js — **the Stripe Elements
  mount is not written yet**, only the intent-creation handshake

Before this is worth keeping, it needs one hour on a staging site: activate the
four plugins, confirm the tables build, put a camp in the database, and take one
real test-mode payment end to end. If that works, the architecture is proven. If
`dbDelta` rejects the schema, that is an hour's fix, not a rethink.

---

## What is built vs. what is not

| | Files | Lines |
|---|---|---|
| Implemented | 54 | 4,880 |
| Scaffolded (data wired, markup pending) | 12 | 243 |

**Working:** core (schema, guard, actor, pricing, quote, discounts, Stripe,
mail, 5 repositories), checkout page and its JS handshake, parent dashboard,
camps listing, thank-you, admin Today / Orders / Trainers / Settings, marketing
landing + Facebook webhook + attribution, both stylesheets, the token file.

**Scaffolded** — the data layer is wired and the page renders, but the markup is
a placeholder: camp detail, trainers, trainer detail, clinics, cart, login,
register, trainer application, trainer dashboard; admin Schedule, Customers,
Discounts.

**Not started at all:**

- Stripe Elements mount in the browser (the checkout cannot yet take a card)
- Trainer availability and the booking calendar — the single biggest gap
- The data migration from the old tables
- Camp/clinic admin editing beyond the WordPress post editor
- Reminder emails (only the receipt exists)
- Any front-end JS beyond checkout (the dashboard cancel button has no handler)

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
2. HMAC-sign the quote (~20 lines).
3. Stripe Elements mount in `ptp-checkout.js`.
4. Trainer availability and booking calendar.
5. Port the 12 scaffolded templates.
6. Write and rehearse the data migration against a database copy.

Items 1 and 2 are hours. Items 3–6 are the real remaining build.

---

## Running the tests

```bash
cd wordpress && php tests/run.php
```

No dependencies, no database, no WordPress install. Every suite runs in its own
process so a fatal in one cannot mask another, and so method statics do not leak
between suites.
