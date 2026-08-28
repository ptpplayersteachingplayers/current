# PTP WordPress platform

Four plugins, split along one axis: **front-end pages vs back-end pages**, with
all shared state in a core that renders nothing.

```
wordpress/
├── ptp-core/        data, services, security — no UI at all
├── ptp-public/      customer-facing pages
├── ptp-admin/       staff screens
└── ptp-marketing/   landing pages, lead capture, attribution
```

Documents, in the order you need them:

- **[TRAINING.md](TRAINING.md)** — the training side: booking flow, availability,
  Stripe money map, both portals, and the mobile app's endpoints.
- **[EVALUATION.md](EVALUATION.md)** — honest assessment: what is tested, what
  is missing, two real bugs the tests caught, and whether this is worth keeping.
- **[SCOPE.md](SCOPE.md)** — what the platform is and what it is not. Read
  first; it is the line the rebuild holds.
- **[MIGRATION.md](MIGRATION.md)** — the map from the previous five-plugin
  codebase: shortcode and admin-screen consolidation, and the port order.
- **[DECOMMISSION.md](DECOMMISSION.md)** — removal plan for the cut product
  lines, including the tables that must be migrated rather than dropped.

## Install

Activate in this order — consumers hook `ptp_core_ready`, so core must be
active first:

1. PTP Core
2. PTP Public, PTP Admin, PTP Marketing (any order)

Deactivate in reverse.

## Configuration

Payment credentials are read from constants first and fall back to options.
Put production keys in `wp-config.php` so they stay out of the database and out
of version control:

```php
define('PTP_STRIPE_PUBLISHABLE_KEY', 'pk_live_…');
define('PTP_STRIPE_SECRET_KEY',      'sk_live_…');
define('PTP_STRIPE_WEBHOOK_SECRET',  'whsec_…');
```

When a constant is set, the Settings screen shows the field as managed rather
than rendering the value.

Point the Stripe webhook at:

```
POST /wp-json/ptp/v1/stripe/webhook
```

Subscribe to `payment_intent.succeeded`. The endpoint fails closed — with no
signing secret configured, every request is rejected.

## Architecture rules

These are the constraints that keep the platform from drifting back into the
state the rebuild was undertaken to fix. They are worth enforcing in review.

**Core owns all state.** No feature plugin issues `CREATE TABLE` or touches
`$wpdb` directly. Database access goes through a repository.

**Only `PTP_Pricing` produces an amount.** It accepts item references —
`{type, id, qty}` — and has no parameter through which a caller can express a
price, discount or total. To make a new product type purchasable, register a
price resolver that reads from the database:

```php
add_filter('ptp_price_resolver_camp', fn() => fn(int $id) => [
    'label'      => get_the_title($id),
    'unit_cents' => (int) get_post_meta($id, '_ptp_price_cents', true),
]);
```

**Only the Stripe webhook marks an order paid.** No front-end callback can set
payment state, and the webhook reconciles `amount_received` against the quoted
total before fulfilling.

**A nonce is not authorisation.** Every handler opens with a `PTP_Guard` call,
which resolves the actor from the session. Record ids from the request are
never treated as proof of identity; repositories scope reads in SQL.

**One design token file.** `ptp-core/assets/css/ptp-tokens.css` holds every
brand value. Stylesheets declare it as a dependency and use the tokens. A raw
hex code outside that file is a bug.

## Adding a front-end page

1. Add a class in `ptp-public/includes/pages/` extending `PTP_Page`.
2. Implement `template()` and `data()`. Register AJAX handlers in `register()`.
3. Add it to `PTP_Public::PAGES`.
4. Add the template in `ptp-public/templates/`.

Templates receive `$data` and escape on output. Pages never echo directly.

## Adding an admin screen

1. Add a class in `ptp-admin/includes/screens/` extending `PTP_Screen`.
2. Implement `title()` and `body()`. Mutating actions are `do_<action>()`
   methods, dispatched via `action_url()` and nonce-verified automatically.
3. Add it to `PTP_Admin::SCREENS`.

## Verifying a change

```bash
php tests/run.php                                  # 147 assertions, no deps
find . -name '*.php' -exec php -l {} \;            # syntax
```

The test suite stubs WordPress, so it needs no database and no install. It
covers the code that decides what a customer is charged or paid: pricing,
quotes, discounts, webhook signatures, actor authorisation, slot generation and
trainer payouts, and the cancellation policy. Add to it whenever you touch any
of those.

There is no build step; assets are plain CSS and dependency-free JavaScript.
