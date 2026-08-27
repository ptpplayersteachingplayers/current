<?php
/**
 * Turns a paid order into the sessions it bought.
 *
 * Runs on ptp_order_paid at priority 10 — before PTP_Connect writes the trainer
 * earnings ledger at 20, which needs these booking rows to exist.
 *
 * A training line is realised from the server-held booking intent, so the slot
 * that gets booked is the one the parent was quoted for, not one the browser
 * names at the last moment.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Booking_Fulfilment
{
    public function register_hooks(): void
    {
        add_action('ptp_order_paid', [$this, 'fulfil'], 10, 1);
    }

    public function fulfil(int $order_id): void
    {
        global $wpdb;

        $order = $wpdb->get_row(
            $wpdb->prepare('SELECT * FROM ' . PTP_Schema::table('orders') . ' WHERE id = %d', $order_id)
        );

        if ($order === null) {
            return;
        }

        $items = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM ' . PTP_Schema::table('order_items') . ' WHERE order_id = %d',
                $order_id
            )
        ) ?: [];

        $actor = PTP_Actor::from_user(
            (int) $wpdb->get_var(
                $wpdb->prepare(
                    'SELECT user_id FROM ' . PTP_Schema::table('parents') . ' WHERE id = %d',
                    (int) $order->parent_id
                )
            )
        );

        foreach ($items as $item) {
            if ($item->item_type === 'training') {
                $booking_id = PTP_Booking_Intent::realise($actor, $order_id);

                if ($booking_id === null) {
                    /**
                     * The slot went while the parent was paying. The money is
                     * taken and the order stands, so this needs a human: staff
                     * rebook or refund. Never fail silently.
                     */
                    do_action('ptp_order_needs_attention', $order_id, 'training slot no longer available');
                }

                continue;
            }

            if (in_array($item->item_type, ['camp', 'clinic'], true)) {
                $this->create_enrolment($actor, $order_id, $item);
            }
        }
    }

    /** Camps and clinics book against the published start date. */
    private function create_enrolment(PTP_Actor $actor, int $order_id, object $item): void
    {
        $starts_at = (string) get_post_meta((int) $item->item_id, '_ptp_starts_at', true);

        if ($starts_at === '') {
            return;
        }

        try {
            $booking_id = ptp_core()->bookings()->create($actor, [
                'order_id'     => $order_id,
                'player_id'    => (int) ($item->player_id ?? 0),
                'booking_type' => (string) $item->item_type,
                'starts_at'    => $starts_at . ' 09:00:00',
                'location'     => (string) get_post_meta((int) $item->item_id, '_ptp_location', true),
            ]);

            ptp_core()->bookings()->mark_confirmed($booking_id);
        } catch (PTP_Repository_Exception $e) {
            do_action('ptp_order_needs_attention', $order_id, $e->getMessage());
        }
    }
}
