<?php
/**
 * Actor resolution and ownership tests.
 *
 * The audit's largest finding class was IDOR: handlers that verified a nonce and
 * then acted on a record id from the request. These assert that identity comes
 * from the session and that ownership is actually enforced.
 */

require_once __DIR__ . '/bootstrap.php';

echo "\nAUTHORISATION — can one account act as another?\n";

$core = ptp_core();
$core->parents->map  = [7 => 100, 8 => 200];   // wp user 7 => parent 100
$core->trainers->map = [12 => 55];             // wp user 12 => trainer 55
$core->players->owned = [1 => 100, 2 => 200];  // player 1 belongs to parent 100

$guard = new PTP_Guard();

// ---- actor resolution --------------------------------------------------------
$GLOBALS['__current_user'] = 7;
$parent = PTP_Actor::from_user(7);
T::eq($parent->role(), PTP_Guard::ROLE_PARENT, 'a user with a parent record resolves as parent');
T::eq($parent->id(), 100, 'the parent actor carries the parent id, not the wp user id');

$GLOBALS['__current_user'] = 12;
$trainer = PTP_Actor::from_user(12);
T::eq($trainer->role(), PTP_Guard::ROLE_TRAINER, 'a user with a trainer record resolves as trainer');
T::eq($trainer->id(), 55, 'the trainer actor carries the trainer id');

$guest = PTP_Actor::from_user(0);
T::ok($guest->is_guest(), 'user id 0 is a guest');
T::eq($guest->id(), null, 'a guest has no domain id');
T::ok(!$guest->is(PTP_Guard::ROLE_PARENT), 'a guest does not satisfy the parent role');

$GLOBALS['__caps'] = [3 => ['manage_options' => true]];
$staff = PTP_Actor::from_user(3);
T::eq($staff->role(), PTP_Guard::ROLE_STAFF, 'an administrator resolves as staff');
T::ok($staff->is(PTP_Guard::ROLE_PARENT) && $staff->is(PTP_Guard::ROLE_TRAINER),
    'staff satisfy every role check (single-tenant back office)');

// ---- a user with no PTP record ----------------------------------------------
$stranger = PTP_Actor::from_user(999);
T::ok(!$stranger->is(PTP_Guard::ROLE_PARENT), 'a logged-in user with no parent record is not a parent');
T::eq($stranger->id(), null, 'a user with no PTP record has no domain id');

// ---- ownership ---------------------------------------------------------------
T::ok($guard->owns($parent, 100), 'a parent owns their own record');
T::ok(!$guard->owns($parent, 200), "a parent does not own another family's record");
T::ok(!$guard->owns($parent, null), 'a null owner is never owned');
T::ok($guard->owns($staff, 200), 'staff bypass ownership');

// ---- ATTACK: walk player ids -------------------------------------------------
T::ok($core->players->belongs_to(1, $parent), 'a parent may act on their own player');
T::ok(!$core->players->belongs_to(2, $parent), "a parent may NOT act on another family's player");
T::ok(!$core->players->belongs_to(4242, $parent), 'a player id that does not exist is refused');
T::ok($core->players->belongs_to(2, $staff), 'staff may act on any player');

// ---- ATTACK: trainer claiming to be a parent --------------------------------
T::ok(!$trainer->is(PTP_Guard::ROLE_PARENT), 'a trainer does not satisfy the parent role');
T::ok(!$core->players->belongs_to(1, $trainer), 'a trainer cannot act on a parent-owned player by id');

exit(T::summary());
