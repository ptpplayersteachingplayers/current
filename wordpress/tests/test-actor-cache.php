<?php
/**
 * Regression test for actor caching.
 *
 * PTP_Guard::current_actor() memoises in a method-level static, which is shared
 * across every Guard instance for the whole request. If the logged-in user
 * changes mid-request — which registration does via wp_set_current_user — a
 * stale actor could be reused.
 */

require_once __DIR__ . '/bootstrap.php';

echo "\nACTOR CACHE — does identity go stale mid-request?\n";

$core = ptp_core();
$core->parents->map = [7 => 100, 8 => 200];

$guard = new PTP_Guard();

$GLOBALS['__current_user'] = 7;
$first = $guard->current_actor();
T::eq($first->id(), 100, 'first resolution returns parent 100');

// Simulate wp_set_current_user() switching the acting user mid-request.
$GLOBALS['__current_user'] = 8;
$second = $guard->current_actor();
T::eq($second->id(), 200, 'after the current user changes, the actor reflects the NEW user');

// And across a separate Guard instance, which shares the method static.
$other = (new PTP_Guard())->current_actor();
T::eq($other->id(), 200, 'a different Guard instance also sees the new user');

exit(T::summary());
