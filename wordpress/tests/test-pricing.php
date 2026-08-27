<?php
/**
 * Pricing and payment-integrity tests.
 *
 * These assert the property the whole rebuild rests on: a customer cannot
 * influence what they are charged. Each test is written as the attack it
 * defends against, using the exact shapes found in the security audit.
 */

require_once __DIR__ . '/bootstrap.php';

echo "\nPRICING — can a customer change what they pay?\n";

// A $525 camp and a $80 clinic, priced from "the database".
add_filter('ptp_price_resolver_camp', fn() => fn(int $id) => $id === 1 ? ['label' => 'Summer Camp', 'unit_cents' => 52500] : null);
add_filter('ptp_price_resolver_clinic', fn() => fn(int $id) => $id === 9 ? ['label' => 'Finishing Clinic', 'unit_cents' => 8000] : null);

$GLOBALS['__current_user'] = 7;
$GLOBALS['__caps'] = [];
$pricing = new PTP_Pricing();
$actor   = PTP_Actor::from_user(7);

// ---- baseline ---------------------------------------------------------------
$q = $pricing->quote([['type' => 'camp', 'id' => 1, 'qty' => 1]], null, $actor);
T::eq($q->total_cents(), 52500, 'a single camp prices at $525.00');

$q2 = $pricing->quote([['type' => 'camp', 'id' => 1, 'qty' => 2], ['type' => 'clinic', 'id' => 9, 'qty' => 1]], null, $actor);
T::eq($q2->total_cents(), 113000, 'two camps + a clinic price at $1,130.00');

// ---- ATTACK: post a price alongside the item (the v99 early-bird bug) --------
$attack = $pricing->quote([[
    'type' => 'camp', 'id' => 1, 'qty' => 1,
    'price' => 1, 'unit_cents' => 1, 'amount' => 1, 'total' => 1,
    'early_bird' => 1, 'early_bird_amount' => 52500,
]], null, $actor);
T::eq($attack->total_cents(), 52500, 'a posted price/early_bird alongside the item is ignored');

// ---- ATTACK: hostile quantities ---------------------------------------------
$neg = $pricing->quote([['type' => 'camp', 'id' => 1, 'qty' => -5]], null, $actor);
T::eq($neg->total_cents(), 52500, 'a negative quantity bills one place, not five');

$zero = $pricing->quote([['type' => 'camp', 'id' => 1, 'qty' => 0]], null, $actor);
T::eq($zero->total_cents(), 52500, 'a zero quantity bills one place, not nothing');

$huge = $pricing->quote([['type' => 'camp', 'id' => 1, 'qty' => 999999]], null, $actor);
T::eq($huge->total_cents(), 52500 * 50, 'an absurd quantity is capped at 50');

$junk = $pricing->quote([['type' => 'camp', 'id' => 1, 'qty' => 'lots']], null, $actor);
T::eq($junk->total_cents(), 52500, 'a non-numeric quantity bills one place');

// ---- ATTACK: unknown item type / unknown id ---------------------------------
T::throws(fn() => $pricing->quote([['type' => 'donation', 'id' => 1, 'qty' => 1]], null, $actor),
    PTP_Pricing_Exception::class, 'an unregistered item type cannot be priced');
T::throws(fn() => $pricing->quote([['type' => 'camp', 'id' => 4242, 'qty' => 1]], null, $actor),
    PTP_Pricing_Exception::class, 'a camp id that does not exist cannot be priced');
T::throws(fn() => $pricing->quote([], null, $actor),
    PTP_Pricing_Exception::class, 'an empty cart is refused rather than charged $0');

echo "\nQUOTES — can a quote be replayed, stolen, or edited?\n";

// ---- quote round-trips intact ----------------------------------------------
$fresh = $pricing->retrieve_quote($q->id(), $actor);
T::eq($fresh->total_cents(), 52500, 'a retrieved quote carries the same total');

// ---- ATTACK: redeem another account's quote ---------------------------------
$GLOBALS['__current_user'] = 99;
$other = PTP_Actor::from_user(99);
T::throws(fn() => $pricing->retrieve_quote($q->id(), $other),
    PTP_Pricing_Exception::class, "another user cannot retrieve someone else's quote");
$GLOBALS['__current_user'] = 7;

// ---- ATTACK: forge a quote id ----------------------------------------------
T::throws(fn() => $pricing->retrieve_quote('not-a-real-quote', $actor),
    PTP_Pricing_Exception::class, 'a forged quote id is refused');

// ---- ATTACK: edit the cached quote then redeem ------------------------------
// Simulates something with object-cache write access — a shared or compromised
// Redis, another plugin, a stray CLI script. The quote is signed over its own
// contents, so a rewritten total no longer verifies.
$tampered = $q->to_array();
$tampered['total_cents'] = 1;
$GLOBALS['__transients']['ptp_quote_' . $q->id()] = $tampered;
T::throws(
    fn() => $pricing->retrieve_quote($q->id(), $actor),
    PTP_Pricing_Exception::class,
    'a total rewritten in the object cache fails signature verification'
);

// Same for the discount and the owning user.
$tampered = $q->to_array();
$tampered['discount']['amount_cents'] = 99999;
$GLOBALS['__transients']['ptp_quote_' . $q->id()] = $tampered;
T::throws(
    fn() => $pricing->retrieve_quote($q->id(), $actor),
    PTP_Pricing_Exception::class,
    'a discount rewritten in the cache fails verification'
);

$tampered = $q->to_array();
unset($tampered['signature']);
$GLOBALS['__transients']['ptp_quote_' . $q->id()] = $tampered;
T::throws(
    fn() => $pricing->retrieve_quote($q->id(), $actor),
    PTP_Pricing_Exception::class,
    'a quote with its signature stripped is refused, not trusted'
);

// An untouched quote still verifies and round-trips.
$GLOBALS['__transients']['ptp_quote_' . $q->id()] = $q->to_array();
T::eq(
    $pricing->retrieve_quote($q->id(), $actor)->total_cents(),
    52500,
    'an untampered quote still verifies and returns its real total'
);

// ---- quote expiry -----------------------------------------------------------
$expired = $q->to_array();
$expired['expires_at'] = time() - 10;
$GLOBALS['__transients']['ptp_quote_' . $q->id()] = $expired;
T::throws(fn() => $pricing->retrieve_quote($q->id(), $actor),
    PTP_Pricing_Exception::class, 'an expired quote cannot be redeemed');

// ---- consumed quote cannot be reused ---------------------------------------
$q3 = $pricing->quote([['type' => 'camp', 'id' => 1, 'qty' => 1]], null, $actor);
$pricing->consume_quote($q3->id());
T::throws(fn() => $pricing->retrieve_quote($q3->id(), $actor),
    PTP_Pricing_Exception::class, 'a consumed quote cannot be redeemed twice');

exit(T::summary());
