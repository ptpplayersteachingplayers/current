<?php
/**
 * Trainer payout split tests.
 *
 * The fee split decides what a trainer is owed. An error here is money moving
 * incorrectly in a direction nobody notices until a trainer complains.
 */

require_once __DIR__ . '/bootstrap.php';

echo "\nPAYOUTS — is the trainer's share computed correctly?\n";

$connect = new PTP_Connect();

// Default platform fee is 25%.
T::eq($connect->fee_bps(1), 2500, 'the default platform fee is 25%');

$split = $connect->split(10000, 1);
T::eq($split['gross_cents'], 10000, 'gross is preserved');
T::eq($split['fee_cents'], 2500, 'platform takes $25.00 of $100.00');
T::eq($split['net_cents'], 7500, 'trainer nets $75.00');
T::eq($split['fee_cents'] + $split['net_cents'], $split['gross_cents'], 'fee + net always equals gross — no cents lost');

// ---- rounding never loses or invents a cent ---------------------------------
foreach ([1, 7, 33, 99, 101, 3333, 5251, 99999] as $gross) {
    $s = $connect->split($gross, 1);
    T::eq(
        $s['fee_cents'] + $s['net_cents'],
        $gross,
        "fee + net reconciles exactly for a \${$gross}c charge"
    );
    T::ok($s['net_cents'] >= 0 && $s['fee_cents'] >= 0, "neither side goes negative at \${$gross}c");
}

// ---- configured fee is honoured and clamped ---------------------------------
$GLOBALS['__options']['ptp_platform_fee_bps'] = 1000;
T::eq($connect->split(10000, 1)['net_cents'], 9000, 'a configured 10% fee leaves the trainer 90%');

$GLOBALS['__options']['ptp_platform_fee_bps'] = 0;
T::eq($connect->split(10000, 1)['net_cents'], 10000, 'a zero fee pays the trainer everything');

// A misconfiguration must not invert the split or pay out more than was taken.
$GLOBALS['__options']['ptp_platform_fee_bps'] = 50000;
$s = $connect->split(10000, 1);
T::eq($s['fee_cents'], 10000, 'a fee above 100% is clamped to the whole charge');
T::eq($s['net_cents'], 0, 'the trainer nets zero rather than a negative amount');

$GLOBALS['__options']['ptp_platform_fee_bps'] = -5000;
T::eq($connect->split(10000, 1)['fee_cents'], 0, 'a negative fee is clamped to zero, not a bonus payout');

// ---- a negative gross cannot create money -----------------------------------
$GLOBALS['__options']['ptp_platform_fee_bps'] = 2500;
$s = $connect->split(-10000, 1);
T::eq($s['gross_cents'], 0, 'a negative gross is floored at zero');
T::eq($s['net_cents'], 0, 'a negative gross pays out nothing');

exit(T::summary());
