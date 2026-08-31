<?php
/**
 * Bookable slot generation.
 *
 * ---------------------------------------------------------------------------
 * Turns a trainer's recurring weekly availability into concrete, bookable
 * slots for a date range, minus anything already booked and anything blocked
 * by a one-off exception.
 *
 * Two rules govern everything here:
 *
 *   1. Slots are computed, never stored. A stored slot table drifts out of
 *      sync with bookings the moment anything writes a booking without going
 *      through it. Availability rules and bookings are the only stored truth.
 *
 *   2. Availability is public information, but a slot is only *bookable* if it
 *      is still free at the moment of payment. The list this class returns is
 *      a display aid; is_bookable() is re-checked server-side before a booking
 *      is written, because two parents can load the same page at once.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Slots
{
    /** How far ahead a parent may book. */
    public const HORIZON_DAYS = 45;

    /** A slot starting sooner than this is hidden — trainers need warning. */
    public const MIN_NOTICE_HOURS = 12;

    /**
     * Bookable slots for one trainer across a date range.
     *
     * @return array<int, array{starts_at: string, ends_at: string, location: string, minutes: int}>
     */
    public function for_trainer(int $trainer_id, ?string $from = null, ?string $to = null): array
    {
        $from = $this->clamp_from($from);
        $to   = $this->clamp_to($to, $from);

        $rules      = $this->rules($trainer_id);
        $exceptions = $this->exceptions($trainer_id, $from, $to);
        $taken      = $this->taken($trainer_id, $from, $to);

        if ($rules === [] && $exceptions === []) {
            return [];
        }

        $slots   = [];
        $cursor  = new DateTimeImmutable($from);
        $end     = new DateTimeImmutable($to);
        $earliest = $this->earliest_start();

        while ($cursor <= $end) {
            $date    = $cursor->format('Y-m-d');
            $weekday = (int) $cursor->format('w');

            foreach ($this->blocks_for_day($date, $weekday, $rules, $exceptions) as $block) {
                foreach ($this->split($date, $block) as $slot) {
                    if ($slot['starts_at'] < $earliest) {
                        continue;
                    }

                    if (isset($taken[$slot['starts_at']])) {
                        continue;
                    }

                    // A slot another parent is mid-checkout on is not offered.
                    if (get_transient(PTP_Booking_Intent::hold_key($trainer_id, $slot['starts_at'])) !== false) {
                        continue;
                    }

                    $slots[] = $slot;
                }
            }

            $cursor = $cursor->modify('+1 day');
        }

        usort($slots, static fn(array $a, array $b) => strcmp($a['starts_at'], $b['starts_at']));

        return $slots;
    }

    /**
     * Is this exact slot still bookable right now?
     *
     * Called immediately before a booking is written. Re-derives the slot from
     * the rules rather than trusting that the browser was shown a real one, so
     * a hand-crafted request cannot book 3am on a day the trainer is closed.
     */
    public function is_bookable(int $trainer_id, string $starts_at): bool
    {
        $date = substr($starts_at, 0, 10);

        foreach ($this->for_trainer($trainer_id, $date, $date) as $slot) {
            if ($slot['starts_at'] === $starts_at) {
                return true;
            }
        }

        return false;
    }

    /** The slot's length in minutes, or null when it is not a real slot. */
    public function minutes_for(int $trainer_id, string $starts_at): ?int
    {
        $date = substr($starts_at, 0, 10);

        foreach ($this->for_trainer($trainer_id, $date, $date) as $slot) {
            if ($slot['starts_at'] === $starts_at) {
                return $slot['minutes'];
            }
        }

        return null;
    }

    /**
     * Group slots by calendar date, which is how every UI wants them.
     *
     * @return array<string, array<int, array{starts_at: string, ends_at: string, location: string, minutes: int}>>
     */
    public function grouped_by_date(int $trainer_id, ?string $from = null, ?string $to = null): array
    {
        $grouped = [];

        foreach ($this->for_trainer($trainer_id, $from, $to) as $slot) {
            $grouped[substr($slot['starts_at'], 0, 10)][] = $slot;
        }

        return $grouped;
    }

    // -- internals ------------------------------------------------------------

    /**
     * Availability blocks applying to one date.
     *
     * An 'open' exception adds a block on a day the weekly rules do not cover.
     * A 'block' exception removes the whole day — deliberately coarse, because
     * partial-day blocking is better expressed by editing the weekly rule.
     *
     * @return array<int, array{starts_time: string, ends_time: string, location: string, slot_minutes: int}>
     */
    private function blocks_for_day(string $date, int $weekday, array $rules, array $exceptions): array
    {
        foreach ($exceptions[$date] ?? [] as $exception) {
            if ($exception->kind === 'block') {
                return [];
            }
        }

        $blocks = [];

        foreach ($rules as $rule) {
            if ((int) $rule->weekday === $weekday) {
                $blocks[] = [
                    'starts_time'  => (string) $rule->starts_time,
                    'ends_time'    => (string) $rule->ends_time,
                    'location'     => (string) $rule->location,
                    'slot_minutes' => max(15, (int) $rule->slot_minutes),
                ];
            }
        }

        foreach ($exceptions[$date] ?? [] as $exception) {
            if ($exception->kind === 'open' && $exception->starts_time && $exception->ends_time) {
                $blocks[] = [
                    'starts_time'  => (string) $exception->starts_time,
                    'ends_time'    => (string) $exception->ends_time,
                    'location'     => (string) $exception->location,
                    'slot_minutes' => 60,
                ];
            }
        }

        return $blocks;
    }

    /**
     * Divide one availability block into fixed-length slots.
     *
     * A trailing remainder shorter than a full slot is discarded rather than
     * sold as a short session.
     *
     * @return array<int, array{starts_at: string, ends_at: string, location: string, minutes: int}>
     */
    private function split(string $date, array $block): array
    {
        try {
            $start = new DateTimeImmutable($date . ' ' . $block['starts_time']);
            $end   = new DateTimeImmutable($date . ' ' . $block['ends_time']);
        } catch (Exception $e) {
            return [];
        }

        if ($end <= $start) {
            return [];
        }

        $minutes = $block['slot_minutes'];
        $slots   = [];
        $cursor  = $start;

        while ($cursor < $end) {
            $slot_end = $cursor->modify('+' . $minutes . ' minutes');

            if ($slot_end > $end) {
                break;
            }

            $slots[] = [
                'starts_at' => $cursor->format('Y-m-d H:i:s'),
                'ends_at'   => $slot_end->format('Y-m-d H:i:s'),
                'location'  => $block['location'],
                'minutes'   => $minutes,
            ];

            $cursor = $slot_end;
        }

        return $slots;
    }

    /** @return array<int, object> */
    private function rules(int $trainer_id): array
    {
        global $wpdb;

        return $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM ' . PTP_Schema::table('availability') . ' WHERE trainer_id = %d AND active = 1',
                $trainer_id
            )
        ) ?: [];
    }

    /** @return array<string, array<int, object>> keyed by date */
    private function exceptions(int $trainer_id, string $from, string $to): array
    {
        global $wpdb;

        $rows = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM ' . PTP_Schema::table('availability_exceptions')
                . ' WHERE trainer_id = %d AND on_date BETWEEN %s AND %s',
                $trainer_id,
                $from,
                $to
            )
        ) ?: [];

        $keyed = [];

        foreach ($rows as $row) {
            $keyed[(string) $row->on_date][] = $row;
        }

        return $keyed;
    }

    /**
     * Start times already spoken for.
     *
     * Pending bookings count as taken: a slot held during someone's checkout
     * should not be offered to a second parent, and an abandoned checkout
     * frees up when the pending order expires.
     *
     * @return array<string, true>
     */
    private function taken(int $trainer_id, string $from, string $to): array
    {
        global $wpdb;

        $rows = $wpdb->get_col(
            $wpdb->prepare(
                'SELECT starts_at FROM ' . PTP_Schema::table('bookings')
                . ' WHERE trainer_id = %d AND status != %s AND starts_at BETWEEN %s AND %s',
                $trainer_id,
                'cancelled',
                $from . ' 00:00:00',
                $to . ' 23:59:59'
            )
        ) ?: [];

        $taken = [];

        foreach ($rows as $starts_at) {
            $taken[(string) $starts_at] = true;
        }

        return $taken;
    }

    private function earliest_start(): string
    {
        return (new DateTimeImmutable('+' . self::MIN_NOTICE_HOURS . ' hours'))->format('Y-m-d H:i:s');
    }

    /**
     * The last date anyone may book. Measured from today, not from the
     * requested start — otherwise asking for a window that begins in 2027
     * moves the horizon along with it, which is how a request 400 days out
     * used to come back bookable.
     */
    private function horizon_end(): string
    {
        return (new DateTimeImmutable('today'))
            ->modify('+' . self::HORIZON_DAYS . ' days')
            ->format('Y-m-d');
    }

    private function clamp_from(?string $from): string
    {
        $today = (new DateTimeImmutable('today'))->format('Y-m-d');

        if ($from === null || !$this->is_date($from) || $from < $today) {
            return $today;
        }

        return $from;
    }

    /**
     * Note what this deliberately does not do: it never pulls $to up to meet a
     * $from that sits past the horizon. That leaves the window inverted, and
     * for_trainer()'s loop then yields nothing — which is the correct answer
     * for "what can I book in fourteen months", rather than the horizon day's
     * slots handed back under a date nobody asked for.
     */
    private function clamp_to(?string $to, string $from): string
    {
        $max = $this->horizon_end();

        if ($to === null || !$this->is_date($to) || $to > $max) {
            return $max;
        }

        return $to < $from ? $from : $to;
    }

    private function is_date(string $value): bool
    {
        return (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $value);
    }
}
