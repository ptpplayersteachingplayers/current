<?php
/**
 * Refunds and payout reversal.
 *
 * ---------------------------------------------------------------------------
 * Cancelling a booking used to take the slot back and leave the money where it
 * was: the parent stayed charged and the trainer stayed owed for a session that
 * never happened. This closes both ends of that.
 *
 * The order of operations matters and is deliberate:
 *
 *   1. reverse the trainer's pending payout FIRST
 *   2. then refund the parent
 *
 * If step 2 fails, we have withheld money we still hold — recoverable, and the
 * ledger row records why. Refunding first and then failing to reverse would
 * mean paying a trainer out of money already returned to the customer, which is
 * a real loss rather than a retry.
 *
 * A payout that has ALREADY been transferred is never clawed back automatically.
 * Reversing a completed transfer can overdraw a trainer's bank account, so it
 * is flagged for a human instead. In practice this is rare: payouts only move
 * after the session is delivered, and a delivered session is not being
 * cancelled.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Refunds
{
    /**
     * Cancel a booking and settle the money according to the policy.
     *
     * @param bool $by_staff staff cancellations always refund
     * @return array{refunded_cents: int, payout_reversed: bool, reason: string}
     */
    public function cancel_booking(int $booking_id, bool $by_staff = false, string $note = ''): array
    {
        global $wpdb;

        $booking = $wpdb->get_row(
            $wpdb->prepare('SELECT * FROM ' . PTP_Schema::table('bookings') . ' WHERE id = %d', $booking_id)
        );

        if ($booking === null) {
            throw new PTP_Repository_Exception(__('Booking not found.', 'ptp'));
        }

        $decision = (new PTP_Cancellation_Policy())->decide((string) $booking->starts_at, $by_staff);

        $reversed = false;

        // 1. Withhold the trainer's money before returning the parent's.
        if ($decision['reverse_payout']) {
            $reversed = $this->reverse_payout($booking_id, $decision['reason']);
        }

        // 2. Refund the parent.
        $refunded = 0;

        if ($decision['refund']) {
            $refunded = $this->refund_booking_share($booking, $note !== '' ? $note : $decision['reason']);
        }

        do_action('ptp_booking_cancelled_settled', $booking_id, $refunded, $reversed, $decision['reason']);

        return [
            'refunded_cents'  => $refunded,
            'payout_reversed' => $reversed,
            'reason'          => $decision['reason'],
        ];
    }

    /**
     * Refund this booking's share of its order.
     *
     * An order can carry several sessions, so cancelling one refunds only what
     * that session cost — not the whole order. The amount comes from the order
     * items, never from a caller.
     */
    private function refund_booking_share(object $booking, string $reason): int
    {
        global $wpdb;

        if (empty($booking->order_id)) {
            return 0;
        }

        $order = $wpdb->get_row(
            $wpdb->prepare(
                'SELECT * FROM ' . PTP_Schema::table('orders') . ' WHERE id = %d',
                (int) $booking->order_id
            )
        );

        if ($order === null || $order->status !== 'paid' || $order->stripe_payment_intent_id === '') {
            return 0;
        }

        $share = $this->booking_share_cents($order, $booking);

        // Never refund more than remains unrefunded on the order.
        $remaining = max(0, (int) $order->paid_cents - (int) $order->refunded_cents);
        $amount    = min($share, $remaining);

        if ($amount <= 0) {
            return 0;
        }

        try {
            ptp_core()->stripe()->create_refund(
                (string) $order->stripe_payment_intent_id,
                $amount,
                ['ptp_booking_id' => (string) $booking->id, 'ptp_reason' => $reason]
            );
        } catch (PTP_Stripe_Exception $e) {
            /**
             * The refund did not go through. The trainer's payout is already
             * withheld, so nothing has been overpaid — but a customer is owed
             * money and needs a human.
             */
            do_action('ptp_refund_failed', (int) $booking->id, $amount, $e->getMessage());

            throw new PTP_Repository_Exception(
                __('We could not process the refund automatically. Our team has been notified and will sort it out.', 'ptp')
            );
        }

        // Cumulative: a second cancellation on the same order adds to this.
        $wpdb->query(
            $wpdb->prepare(
                'UPDATE ' . PTP_Schema::table('orders')
                . ' SET refunded_cents = refunded_cents + %d WHERE id = %d',
                $amount,
                (int) $order->id
            )
        );

        do_action('ptp_order_refunded', (int) $order->id, $amount, $reason);

        return $amount;
    }

    /**
     * What this booking cost within its order.
     *
     * Uses the training line for a training booking; for camps and clinics the
     * item is matched by type. Falls back to the whole order total only when
     * the order has a single line, which is the common case.
     */
    private function booking_share_cents(object $order, object $booking): int
    {
        global $wpdb;

        $items = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM ' . PTP_Schema::table('order_items') . ' WHERE order_id = %d',
                (int) $order->id
            )
        ) ?: [];

        if (count($items) === 1) {
            // One line: the booking is the order. Refund what was actually paid,
            // which accounts for any discount applied at checkout.
            return (int) $order->paid_cents;
        }

        $matching = array_filter(
            $items,
            static fn(object $i) => $i->item_type === $booking->booking_type
        );

        if ($matching === []) {
            return 0;
        }

        $line = (int) reset($matching)->amount_cents;

        /**
         * Scale the line by what was actually paid against what was quoted, so
         * an order-level discount is shared proportionally rather than refunded
         * in full on one line.
         */
        $total = (int) $order->total_cents;

        if ($total <= 0) {
            return 0;
        }

        return (int) round($line * (int) $order->paid_cents / $total);
    }

    /**
     * Withhold a trainer's pending payout for a cancelled session.
     *
     * Only a row still 'pending' is reversed. A transfer that has already left
     * is flagged for a human rather than clawed back, because reversing it can
     * overdraw the trainer.
     */
    private function reverse_payout(int $booking_id, string $reason): bool
    {
        global $wpdb;

        $payout = $wpdb->get_row(
            $wpdb->prepare(
                'SELECT * FROM ' . PTP_Schema::table('payouts') . ' WHERE booking_id = %d',
                $booking_id
            )
        );

        if ($payout === null) {
            return false;
        }

        if ($payout->status === 'paid') {
            do_action('ptp_payout_already_sent', $booking_id, (int) $payout->net_cents);

            return false;
        }

        // Guarded transition so a double cancellation cannot double-count.
        $updated = $wpdb->query(
            $wpdb->prepare(
                'UPDATE ' . PTP_Schema::table('payouts')
                . ' SET status = %s, cancelled_reason = %s WHERE id = %d AND status = %s',
                'cancelled',
                substr($reason, 0, 190),
                (int) $payout->id,
                'pending'
            )
        );

        if ((int) $updated === 1) {
            do_action('ptp_payout_reversed', $booking_id, (int) $payout->net_cents, $reason);

            return true;
        }

        return false;
    }
}
