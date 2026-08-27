<?php
/**
 * Training as a purchasable item.
 *
 * Registers the `training` price resolver. A training line references a
 * TRAINER id, and its price is that trainer's stored hourly rate pro-rated to
 * the slot length — so the amount charged is derived from the database and the
 * clock, never from anything the browser sends.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Training_Catalogue
{
    /** Slot length used when the request does not name a real slot. */
    private const FALLBACK_MINUTES = 60;

    public function register(): void
    {
        add_filter('ptp_price_resolver_training', [$this, 'resolver']);
    }

    /**
     * The resolver receives only a trainer id — PTP_Pricing passes nothing
     * else. The requested slot is read from the session-scoped booking intent
     * rather than the price call, keeping the pricing contract narrow.
     */
    public function resolver($_ = null): callable
    {
        return function (int $trainer_id): ?array {
            global $wpdb;

            $trainer = $wpdb->get_row(
                $wpdb->prepare(
                    'SELECT id, display_name, hourly_cents, status FROM ' . PTP_Schema::table('trainers') . ' WHERE id = %d',
                    $trainer_id
                )
            );

            if ($trainer === null || $trainer->status !== 'active') {
                return null;
            }

            $hourly = (int) $trainer->hourly_cents;

            if ($hourly <= 0) {
                return null;
            }

            $minutes = PTP_Booking_Intent::minutes_for_trainer($trainer_id) ?? self::FALLBACK_MINUTES;

            return [
                'label'      => sprintf(
                    /* translators: 1: trainer name, 2: session length in minutes */
                    __('%1$s — %2$d min session', 'ptp'),
                    $trainer->display_name,
                    $minutes
                ),
                'unit_cents' => (int) round($hourly * $minutes / 60),
            ];
        };
    }
}
