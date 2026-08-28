<?php
/**
 * Cancellation policy tests.
 *
 * The policy decides two things at once — whether the parent gets money back
 * and whether the trainer keeps theirs. Getting the pair wrong in either
 * direction costs real money: refunding a parent while still paying the trainer
 * is a straight loss, and withholding trainer pay on a late cancellation is
 * taking money off someone who held the time.
 */

require_once __DIR__ . '/bootstrap.php';

echo "\nCANCELLATION — who gets what, and when?\n";

$policy = new PTP_Cancellation_Policy();

/** A session start that many hours from now, in MySQL format. */
function in_hours(float $hours): string {
    return gmdate('Y-m-d H:i:s', (int) (time() + $hours * 3600));
}

// ---- comfortably ahead of the cutoff ----------------------------------------
$d = $policy->decide(in_hours(72));
T::ok($d['refund'], 'cancelling three days ahead refunds the parent');
T::ok($d['reverse_payout'], 'and withholds the trainer payout for a session that will not happen');
T::eq($d['reason'], 'cancelled_in_time', 'reason is recorded as in-time');

// ---- exactly on the boundary -------------------------------------------------
$d = $policy->decide(in_hours(24.1));
T::ok($d['refund'], 'just over 24 hours still refunds');

$d = $policy->decide(in_hours(23.9));
T::ok(!$d['refund'], 'just under 24 hours does not refund');
T::ok(!$d['reverse_payout'], 'and the trainer KEEPS their payout — they held the slot');
T::eq($d['reason'], 'cancelled_late', 'reason is recorded as late');

// ---- inside the window -------------------------------------------------------
$d = $policy->decide(in_hours(2));
T::ok(!$d['refund'], 'two hours before, no refund');
T::ok(!$d['reverse_payout'], 'two hours before, the trainer is still paid');

// ---- already happened --------------------------------------------------------
$d = $policy->decide(in_hours(-1));
T::ok(!$d['refund'], 'a session that already started is not refundable');
T::ok(!$d['reverse_payout'], 'and the trainer is paid for delivering it');
T::eq($d['reason'], 'session_passed', 'reason is recorded as passed');

// ---- staff override ----------------------------------------------------------
$d = $policy->decide(in_hours(1), true);
T::ok($d['refund'], 'staff cancelling one hour out still refunds the customer');
T::ok($d['reverse_payout'], 'and withholds the payout — the session is not happening');
T::eq($d['reason'], 'staff_cancelled', 'reason distinguishes a staff cancellation');

$d = $policy->decide(in_hours(-100), true);
T::ok($d['refund'], 'staff can refund even a session in the past (a no-show on our side)');

// ---- malformed input is not the customer's fault -----------------------------
$d = $policy->decide('');
T::ok($d['refund'], 'an empty start date refunds rather than silently keeping the money');
T::eq($d['reason'], 'unknown_start', 'and is flagged for a human');

$d = $policy->decide('not-a-date');
T::ok($d['refund'], 'an unparseable start date also refunds');

// ---- the refund and the payout never disagree in the costly direction --------
foreach ([-5, 0.5, 12, 23.9, 24.1, 48, 500] as $hours) {
    $d = $policy->decide(in_hours($hours));
    T::ok(
        !($d['refund'] && !$d['reverse_payout']),
        sprintf('at %sh: never refund the parent while still paying the trainer', $hours)
    );
}

// ---- the configured window is honoured ---------------------------------------
$GLOBALS['__options']['ptp_free_cancel_hours'] = 48;
$policy = new PTP_Cancellation_Policy();
T::eq($policy->free_cancel_hours(), 48, 'a configured cancellation window is read');
T::ok(!$policy->decide(in_hours(36))['refund'], 'with a 48h window, 36 hours notice does not refund');
T::ok($policy->decide(in_hours(60))['refund'], 'with a 48h window, 60 hours notice does refund');

$GLOBALS['__options']['ptp_free_cancel_hours'] = -10;
$policy = new PTP_Cancellation_Policy();
T::eq($policy->free_cancel_hours(), 0, 'a negative window is clamped to zero, not treated as always-late');

// ---- the customer-facing wording matches the decision -----------------------
$GLOBALS['__options']['ptp_free_cancel_hours'] = 24;
$policy = new PTP_Cancellation_Policy();
T::ok(
    strpos($policy->describe(in_hours(72)), 'refunds you in full') !== false,
    'a refundable session is described as refundable before confirming'
);
T::ok(
    strpos($policy->describe(in_hours(2)), 'not refundable') !== false,
    'a non-refundable session says so before confirming, not after'
);

exit(T::summary());
