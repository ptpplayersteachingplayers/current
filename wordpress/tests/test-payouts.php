<?php
/**
 * Trainer payout tests — fixed amount per trainer.
 *
 * Trainers are paid an amount staff assign to them, NOT a percentage of what
 * the parent paid. These assert that the two figures stay independent: a
 * discount, a price rise, or a promotion must never silently change what a
 * trainer earns.
 */

require_once __DIR__ . '/bootstrap.php';

echo "\nPAYOUTS — is the trainer paid the amount they were assigned?\n";

$connect = new PTP_Connect();

/** Seed the trainer row PTP_Connect reads the rate from. */
function trainer_rate(int $payoutCents, string $basis = 'session'): void {
    $GLOBALS['__next_row'] = [
        'id' => 5,
        'payout_cents' => $payoutCents,
        'payout_basis' => $basis,
        'stripe_account_id' => '',
    ];
}

// ---- a flat per-session amount ----------------------------------------------
trainer_rate(4000);                                  // trainer earns $40/session
$split = $connect->split(10000, 5, 60);              // parent paid $100

T::eq($split['payout_cents'], 4000, 'the trainer earns exactly the $40 assigned');
T::eq($split['platform_cents'], 6000, 'the platform keeps the $60 remainder');
T::eq($split['gross_cents'], 10000, 'gross is preserved');
T::ok(!$split['shortfall'], 'a normal session is not flagged as a shortfall');
T::eq(
    $split['payout_cents'] + $split['platform_cents'],
    $split['gross_cents'],
    'payout + platform always reconciles to gross — no cents invented or lost'
);

// ---- THE KEY PROPERTY: pay does not follow the price ------------------------
trainer_rate(4000);
$discounted = $connect->split(5000, 5, 60);   // same session sold at half price
T::eq($discounted['payout_cents'], 4000, 'a discounted session pays the trainer the SAME $40');
T::eq($discounted['platform_cents'], 1000, 'the platform absorbs the discount, not the trainer');

trainer_rate(4000);
$premium = $connect->split(20000, 5, 60);     // same session sold at double
T::eq($premium['payout_cents'], 4000, 'a premium-priced session still pays the trainer $40');
T::eq($premium['platform_cents'], 16000, 'the platform keeps the upside');

// ---- session basis ignores length -------------------------------------------
trainer_rate(4000, 'session');
T::eq($connect->split(10000, 5, 30)['payout_cents'], 4000, 'per-session pay is flat for a 30 min session');
trainer_rate(4000, 'session');
T::eq($connect->split(10000, 5, 90)['payout_cents'], 4000, 'per-session pay is flat for a 90 min session');

// ---- hourly basis pro-rates --------------------------------------------------
trainer_rate(6000, 'hour');                   // $60/hr
trainer_rate(6000, 'hour');
T::eq($connect->split(10000, 5, 60)['payout_cents'], 6000, 'hourly basis pays $60 for 60 min');
trainer_rate(6000, 'hour');
T::eq($connect->split(10000, 5, 30)['payout_cents'], 3000, 'hourly basis pays $30 for 30 min');
trainer_rate(6000, 'hour');
T::eq($connect->split(10000, 5, 90)['payout_cents'], 9000, 'hourly basis pays $90 for 90 min');
trainer_rate(6000, 'hour');
T::eq($connect->split(10000, 5, 45)['payout_cents'], 4500, 'hourly basis pays $45 for 45 min');

// ---- rounding on awkward pro-rations ----------------------------------------
trainer_rate(3333, 'hour');
$odd = $connect->split(10000, 5, 50);
T::eq($odd['payout_cents'], 2778, 'an awkward hourly rate pro-rates to a whole number of cents');
T::eq(
    $odd['payout_cents'] + $odd['platform_cents'],
    $odd['gross_cents'],
    'the reconciliation holds even after rounding'
);

// ---- a payout larger than the charge is flagged, not silently absorbed ------
trainer_rate(12000);
$loss = $connect->split(10000, 5, 60);
T::eq($loss['payout_cents'], 12000, 'the trainer is still owed what they were promised');
T::eq($loss['platform_cents'], 0, 'the platform share floors at zero rather than going negative');
T::ok($loss['shortfall'], 'the session is flagged as costing more than it earned');

// ---- an unset rate pays nothing and is detectable ---------------------------
trainer_rate(0);
$unset = $connect->split(10000, 5, 60);
T::eq($unset['payout_cents'], 0, 'a trainer with no rate assigned earns nothing until staff set one');
T::eq($unset['platform_cents'], 10000, 'with no rate set the platform holds the whole amount');

// ---- an unknown trainer cannot be paid --------------------------------------
$GLOBALS['__next_row'] = null;
T::eq($connect->payout_for(999, 60), 0, 'an unknown trainer id yields no payout');

// ---- negative and absurd inputs ---------------------------------------------
trainer_rate(-5000);
T::eq($connect->payout_for(5, 60), 0, 'a negative stored rate is floored at zero, not a reverse transfer');

trainer_rate(4000);
$negGross = $connect->split(-10000, 5, 60);
T::eq($negGross['gross_cents'], 0, 'a negative gross is floored at zero');
T::ok($negGross['shortfall'], 'a zero-gross session with a payout is flagged');

trainer_rate(6000, 'hour');
T::eq($connect->payout_for(5, -30), 0, 'a negative session length cannot invert the pro-ration');

// ---- an unknown basis is rejected on write ----------------------------------
T::throws(
    fn() => $connect->set_payout_rate(5, 4000, 'per-fortnight'),
    PTP_Repository_Exception::class,
    'an unrecognised payout basis is refused rather than stored'
);

exit(T::summary());
