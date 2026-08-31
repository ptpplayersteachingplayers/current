<?php
/**
 * Slot generation tests.
 *
 * Availability is the training product's core mechanic: get it wrong and you
 * either sell a session nobody can deliver, or hide sessions that are free.
 * These drive PTP_Slots against fixture availability rules.
 */

require_once __DIR__ . '/bootstrap.php';

echo "\nSLOTS — does availability turn into the right bookable times?\n";

$slots = new PTP_Slots();

/** Build a weekly rule row for a given weekday. */
function rule(int $weekday, string $from, string $to, int $minutes = 60, string $where = 'Riverside'): object {
    return (object) [
        'id' => 1, 'trainer_id' => 5, 'weekday' => $weekday,
        'starts_time' => $from, 'ends_time' => $to,
        'location' => $where, 'slot_minutes' => $minutes, 'active' => 1,
    ];
}

/** Seed the availability, exception and booking tables the slot engine reads. */
function seed(array $rules, array $exceptions = [], array $bookedStarts = []): void {
    $GLOBALS['__rows'] = [
        'availability_exceptions' => $exceptions,
        'availability'            => $rules,
    ];
    $GLOBALS['__cols'] = ['bookings' => $bookedStarts];
}

/**
 * Drive PTP_Slots for a single named weekday well inside the horizon, so the
 * 12-hour minimum-notice window can never clip the result.
 */
function slots_on(PTP_Slots $slots, array $rules, array $exceptions = []): array {
    $target = new DateTimeImmutable('+8 days');
    $date   = $target->format('Y-m-d');

    // Point every rule at the weekday the target date actually falls on.
    foreach ($rules as $r) { $r->weekday = (int) $target->format('w'); }

    seed($rules, $exceptions);

    return $slots->for_trainer(5, $date, $date);
}

// ---- basic division ---------------------------------------------------------
$result = slots_on($slots, [rule(2, '16:00:00', '20:00:00', 60)]);
T::eq(count($result), 4, 'a 4-hour window at 60 min yields 4 slots');
T::eq($result[0]['minutes'], 60, 'slot length is carried through');
T::eq($result[0]['location'], 'Riverside', 'location is carried through');

$result = slots_on($slots, [rule(2, '16:00:00', '20:00:00', 30)]);
T::eq(count($result), 8, 'the same window at 30 min yields 8 slots');

$result = slots_on($slots, [rule(2, '16:00:00', '17:30:00', 60)]);
T::eq(count($result), 1, 'a 90-minute window at 60 min yields 1 slot, not 1.5');

// ---- malformed windows produce nothing, never a crash -----------------------
T::eq(count(slots_on($slots, [rule(2, '20:00:00', '16:00:00')])), 0, 'an end before its start yields no slots');
T::eq(count(slots_on($slots, [rule(2, '16:00:00', '16:00:00')])), 0, 'a zero-length window yields no slots');
T::eq(count(slots_on($slots, [])), 0, 'a trainer with no availability yields no slots');

// ---- ordering ---------------------------------------------------------------
$result = slots_on($slots, [rule(2, '16:00:00', '18:00:00', 60)]);
T::ok(
    count($result) === 2 && $result[0]['starts_at'] < $result[1]['starts_at'],
    'slots come back in chronological order'
);

// ---- the horizon and notice window are enforced -----------------------------
// Seed every weekday, so this asserts the horizon rather than accidentally
// asserting that the far date is not a Tuesday. It passed for a year on that
// coincidence while the horizon was enforced only in the browser.
$every_day = [];
for ($w = 0; $w <= 6; $w++) { $every_day[] = rule($w, '16:00:00', '20:00:00'); }

$far = (new DateTimeImmutable('+400 days'))->format('Y-m-d');
seed($every_day);
T::eq(
    count($slots->for_trainer(5, $far, $far)),
    0,
    'a date beyond the 45-day horizon is clamped away'
);

// The day after the horizon is refused; the horizon itself is not. Without
// both, "clamped away" is satisfied by a function that returns nothing ever.
$just_past = (new DateTimeImmutable('+' . (PTP_Slots::HORIZON_DAYS + 1) . ' days'))->format('Y-m-d');
seed($every_day);
T::eq(count($slots->for_trainer(5, $just_past, $just_past)), 0, 'one day past the horizon yields nothing');

$on_horizon = (new DateTimeImmutable('+' . PTP_Slots::HORIZON_DAYS . ' days'))->format('Y-m-d');
seed($every_day);
T::ok(count($slots->for_trainer(5, $on_horizon, $on_horizon)) > 0, 'the horizon day itself is still bookable');

// is_bookable() is the guard run before a booking is written, so the horizon
// has to hold there too — that is the path a hand-crafted request takes.
seed($every_day);
T::eq($slots->is_bookable(5, $far . ' 16:00:00'), false, 'a booking beyond the horizon is refused server-side');

$yesterday = (new DateTimeImmutable('-1 day'))->format('Y-m-d');
seed([rule(2, '16:00:00', '20:00:00')]);
T::eq(
    count($slots->for_trainer(5, $yesterday, $yesterday)),
    0,
    'a date in the past yields nothing'
);

// ---- is_bookable rejects a time that is not a real slot ---------------------
$target = (new DateTimeImmutable('+8 days'));
$rules  = [rule((int) $target->format('w'), '16:00:00', '20:00:00', 60)];

seed($rules);
T::ok(
    !$slots->is_bookable(5, $target->format('Y-m-d') . ' 03:00:00'),
    'a 3am start on an evening-only day is not bookable'
);

seed($rules);
T::ok(
    !$slots->is_bookable(5, $target->format('Y-m-d') . ' 16:17:00'),
    'a start that is not on a slot boundary is not bookable'
);

seed($rules);
T::ok(
    $slots->is_bookable(5, $target->format('Y-m-d') . ' 16:00:00'),
    'a real slot boundary IS bookable'
);

seed($rules);
T::eq(
    $slots->minutes_for(5, $target->format('Y-m-d') . ' 16:00:00'),
    60,
    'minutes_for returns the slot length for a real slot'
);

seed($rules);
T::eq(
    $slots->minutes_for(5, $target->format('Y-m-d') . ' 03:00:00'),
    null,
    'minutes_for returns null for a fabricated time — pricing cannot proceed'
);

// ---- an existing booking removes its slot -----------------------------------
$target = new DateTimeImmutable('+8 days');
$rules  = [rule((int) $target->format('w'), '16:00:00', '20:00:00', 60)];
$booked = $target->format('Y-m-d') . ' 17:00:00';

seed($rules, [], [$booked]);
$result = $slots->for_trainer(5, $target->format('Y-m-d'), $target->format('Y-m-d'));

T::eq(count($result), 3, 'a booked slot is removed from the offered list');
T::ok(
    !in_array($booked, array_column($result, 'starts_at'), true),
    'the specific booked time is the one removed'
);

seed($rules, [], [$booked]);
T::ok(!$slots->is_bookable(5, $booked), 'an already-booked time is not bookable again (no double-booking)');

// ---- a blocked date clears the whole day ------------------------------------
$block = (object) [
    'id' => 1, 'trainer_id' => 5, 'on_date' => $target->format('Y-m-d'),
    'kind' => 'block', 'starts_time' => null, 'ends_time' => null,
    'location' => '', 'note' => 'Holiday',
];

seed($rules, [$block]);
T::eq(
    count($slots->for_trainer(5, $target->format('Y-m-d'), $target->format('Y-m-d'))),
    0,
    'a blocked date removes every slot that day'
);

exit(T::summary());
