<?php
/**
 * Stripe webhook signature tests.
 *
 * The webhook is the only thing in the platform that can mark an order paid, so
 * its signature check is the single most security-critical function here. These
 * exercise it directly via reflection.
 */

require_once __DIR__ . '/bootstrap.php';

echo "\nSTRIPE WEBHOOK — can a forged payment notification get through?\n";

$stripe = new PTP_Stripe();
$verify = (new ReflectionClass($stripe))->getMethod('verify_signature');
$verify->setAccessible(true);

$check = fn(string $payload, string $header) => $verify->invoke($stripe, $payload, $header);
$sign = function (string $payload, string $secret, ?int $ts = null): string {
    $ts = $ts ?? time();
    return 't=' . $ts . ',v1=' . hash_hmac('sha256', $ts . '.' . $payload, $secret);
};

$payload = '{"id":"evt_1","type":"payment_intent.succeeded"}';

// ---- fails closed with no secret --------------------------------------------
$GLOBALS['__options']['ptp_stripe_webhook_secret'] = '';
T::ok(!$check($payload, $sign($payload, 'whsec_test')),
    'with NO secret configured, even a validly signed request is rejected (fails closed)');

// ---- valid signature ---------------------------------------------------------
$GLOBALS['__options']['ptp_stripe_webhook_secret'] = 'whsec_test';
T::ok($check($payload, $sign($payload, 'whsec_test')), 'a correctly signed payload is accepted');

// ---- ATTACK: no signature header --------------------------------------------
T::ok(!$check($payload, ''), 'a request with no signature header is rejected');

// ---- ATTACK: wrong secret ----------------------------------------------------
T::ok(!$check($payload, $sign($payload, 'whsec_attacker')), 'a payload signed with the wrong secret is rejected');

// ---- ATTACK: tampered body, valid old signature -----------------------------
$sig = $sign($payload, 'whsec_test');
T::ok(!$check('{"id":"evt_1","type":"payment_intent.succeeded","amount":1}', $sig),
    'editing the body after signing invalidates the signature');

// ---- ATTACK: replay an old event --------------------------------------------
T::ok(!$check($payload, $sign($payload, 'whsec_test', time() - 3600)),
    'a correctly signed event from an hour ago is rejected as a replay');
T::ok($check($payload, $sign($payload, 'whsec_test', time() - 60)),
    'a correctly signed event from a minute ago is accepted');

// ---- ATTACK: malformed headers ----------------------------------------------
foreach ([
    'garbage'                    => 'unparseable header',
    't=,v1='                     => 'empty timestamp and signature',
    'v1=deadbeef'                => 'signature with no timestamp',
    't=' . time()                => 'timestamp with no signature',
    't=abc,v1=deadbeef'          => 'non-numeric timestamp',
] as $header => $desc) {
    T::ok(!$check($payload, $header), "rejected: $desc");
}

// ---- ATTACK: signature of the right shape but wrong value -------------------
T::ok(!$check($payload, 't=' . time() . ',v1=' . str_repeat('a', 64)),
    'a well-formed but incorrect signature is rejected');

exit(T::summary());
