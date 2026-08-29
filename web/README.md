# Portals

Three screens, no build step, no framework. Static files that can be served
from anywhere — Supabase Storage, a bucket, the existing WordPress host.

```
book/       the public booking page
parent/     the family's account
trainer/    the day, the register, the hours
shared/     format, derive, api, ui, styles, sign-in
config.js   the public values, and only the public values
tests/      Node for the logic, Chromium for the screens
```

## The rule this code follows

**The pages hold no business rules.** Every price, capacity decision,
eligibility answer and refund is the server's. Where a page appears to know a
rule, it is repeating one it was told:

- the package price arrives from `/catalog`, which reads `system_settings`
- the cancellation warning uses `free_cancel_hours`, fetched at boot
- the times are rendered in `display_timezone`, not the browser's zone
- `canCancel()` predicts, so the page can warn before the tap. `cancel_booking()`
  decides. If they ever disagree, the server is right and the page is a bug.

Grep for a hardcoded price or capacity in here and you should find none.

## Why plain JavaScript

These load on a phone at the side of a pitch, on one bar. The whole of
`shared/` is smaller than a framework's runtime, and the trainer's register
saves one player per tap rather than one form at the end — a half-marked
register on a dying battery is still half-saved.

## Configuration

`config.js` carries the Supabase URL, the anon key and the Stripe publishable
key. All three are public by design: the anon key has no authority of its own,
every row it can reach is decided by RLS, and the publishable key can only
confirm a PaymentIntent someone already created.

The service role key, the Stripe secret and the job secret are not here and
must never be. If one ever appears in this directory, rotate it — this file
ships to every browser that loads the site.

## Tests

```bash
node web/tests/derive.test.mjs     # 61 assertions, pure logic
node web/tests/browser.test.mjs    # 36 assertions, real Chromium
```

The browser tests serve the actual pages and load them in Chromium with a
stubbed Supabase client, then assert on what a person would see: that the next
session is the soonest one and not the first row returned, that a cancelled
player is off the register, that a mark already saved comes back pressed, that
the trainer's pay covers the gap between two sessions because that is the
promise the block rule makes.

Two of those assertions are about the physical thing rather than the logic —
that nothing is tappable below 44px, and that no page overflows a 390px phone
sideways. The second one caught a real bug: a status badge long enough to read
"One more family and this group starts" pushed the booking page to 906px wide.
The badge is now three words and the sentence has its own line.

## Not verified

The payment step. Stripe Elements is mounted from a `client_secret` that only
a real `/checkout` can produce, so the last screen of the booking flow has
never run. Everything up to it has.
