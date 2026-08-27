<?php
/**
 * Discount validation tests.
 *
 * The audit found a public endpoint that incremented a code's usage counter on
 * every validation call, letting anyone exhaust a limited code without buying,
 * and a percent discount that could be driven past 100%. These assert both are
 * closed.
 */

require_once __DIR__ . '/bootstrap.php';

echo "\nDISCOUNTS — can a code be abused?\n";

$GLOBALS['__current_user'] = 7;
$actor = PTP_Actor::from_user(7);

function discount(array $overrides = []): PTP_Discount {
    return new PTP_Discount((object) array_merge([
        'id' => 1, 'code' => 'SAVE20', 'label' => '20% off', 'kind' => 'percent',
        'value' => 20, 'min_subtotal_cents' => 0, 'usage_limit' => 0,
        'usage_count' => 0, 'starts_at' => null, 'ends_at' => null, 'active' => 1,
    ], $overrides));
}

// ---- value maths ------------------------------------------------------------
T::eq(discount()->value_for(10000), 2000, '20% of $100.00 is $20.00');
T::eq(discount(['kind' => 'fixed', 'value' => 5000])->value_for(10000), 5000, 'a fixed $50 code takes $50');

// ---- ATTACK: discount larger than the cart ----------------------------------
T::eq(discount(['kind' => 'fixed', 'value' => 999999])->value_for(10000), 10000,
    'a fixed discount larger than the cart is capped at the subtotal, not negative');
T::eq(discount(['kind' => 'percent', 'value' => 300])->value_for(10000), 10000,
    'a percent above 100 is clamped to 100%');

// ---- eligibility ------------------------------------------------------------
T::ok(!discount(['min_subtotal_cents' => 20000])->is_redeemable_by($actor, 10000),
    'a code below its minimum spend is refused');
T::ok(discount(['min_subtotal_cents' => 5000])->is_redeemable_by($actor, 10000),
    'a code above its minimum spend is accepted');
T::ok(!discount(['ends_at' => gmdate('Y-m-d H:i:s', time() - 86400)])->is_redeemable_by($actor, 10000),
    'an expired code is refused');
T::ok(!discount(['starts_at' => gmdate('Y-m-d H:i:s', time() + 86400)])->is_redeemable_by($actor, 10000),
    'a code that has not started is refused');

// ---- validation must not mutate ---------------------------------------------
$before = count($GLOBALS['wpdb']->queries);
$d = discount(['usage_limit' => 1]);
$d->is_redeemable_by($actor, 10000);
$d->is_redeemable_by($actor, 10000);
$d->is_redeemable_by($actor, 10000);
$writes = array_filter(
    array_slice($GLOBALS['wpdb']->queries, $before),
    fn($q) => preg_match('/^\s*(INSERT|UPDATE|DELETE)/i', $q)
);
T::eq(count($writes), 0, 'validating a code three times performs zero writes (cannot be exhausted)');

// ---- total never goes below zero via pricing --------------------------------
add_filter('ptp_price_resolver_camp', fn() => fn(int $id) => ['label' => 'Camp', 'unit_cents' => 5000]);
$GLOBALS['__next_row'] = null;  // PTP_Discounts::find returns null -> no discount
$pricing = new PTP_Pricing();
$q = $pricing->quote([['type' => 'camp', 'id' => 1, 'qty' => 1]], 'NOSUCHCODE', $actor);
T::eq($q->total_cents(), 5000, 'an unknown discount code is ignored rather than erroring');
T::ok($q->total_cents() >= 0, 'a total is never negative');

exit(T::summary());
