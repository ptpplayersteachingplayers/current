<?php
/**
 * Orders.
 *
 * An order is created from a PTP_Quote and is never given an amount by a
 * caller. Transition to 'paid' happens only from the Stripe webhook after the
 * received amount has been reconciled against the quoted total.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Orders_Repository extends PTP_Repository
{
    protected function table_name(): string
    {
        return 'orders';
    }

    /**
     * Persist a pending order for a quote.
     *
     * Every monetary column is copied from the quote. There is no path for a
     * request value to reach these columns.
     */
    public function create_from_quote(PTP_Quote $quote, PTP_Actor $actor): int
    {
        if ($actor->id() === null) {
            throw new PTP_Repository_Exception(__('Your account is not set up yet.', 'ptp'));
        }

        $order_id = $this->insert_row(
            [
                'parent_id'      => (int) $actor->id(),
                'quote_id'       => $quote->id(),
                'status'         => 'pending',
                'subtotal_cents' => $quote->subtotal_cents(),
                'discount_cents' => $quote->discount_cents(),
                'total_cents'    => $quote->total_cents(),
                'discount_code'  => $quote->discount_code(),
                'created_at'     => $this->now(),
            ],
            ['%d', '%s', '%s', '%d', '%d', '%d', '%s', '%s']
        );

        $this->write_items($order_id, $quote);

        return $order_id;
    }

    public function find_by_quote(string $quote_id): ?PTP_Order
    {
        $row = $this->db()->get_row(
            $this->db()->prepare('SELECT * FROM ' . $this->table() . ' WHERE quote_id = %s', $quote_id)
        );

        return $row ? PTP_Order::from_row($row) : null;
    }

    public function find_for(PTP_Actor $actor, int $order_id): ?PTP_Order
    {
        if ($actor->is(PTP_Guard::ROLE_STAFF)) {
            $row = $this->find_row($order_id);
        } else {
            $row = $this->db()->get_row(
                $this->db()->prepare(
                    'SELECT * FROM ' . $this->table() . ' WHERE id = %d AND parent_id = %d',
                    $order_id,
                    (int) $actor->id()
                )
            );
        }

        return $row ? PTP_Order::from_row($row) : null;
    }

    /** @return array<int, object> */
    public function history_for(PTP_Actor $actor, int $limit = 50): array
    {
        if ($actor->id() === null) {
            return [];
        }

        return $this->db()->get_results(
            $this->db()->prepare(
                'SELECT * FROM ' . $this->table() . ' WHERE parent_id = %d AND status = %s ORDER BY created_at DESC LIMIT %d',
                (int) $actor->id(),
                'paid',
                $limit
            )
        ) ?: [];
    }

    /**
     * Mark paid. Called only from the verified Stripe webhook.
     *
     * The status guard in the WHERE clause makes this idempotent: a webhook
     * retry that arrives after the first has settled updates zero rows.
     */
    public function mark_paid(int $order_id, string $payment_intent_id, int $paid_cents): void
    {
        // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- conditional transition must be atomic
        $updated = $this->db()->query(
            $this->db()->prepare(
                'UPDATE ' . $this->table() . ' SET status = %s, paid_cents = %d, stripe_payment_intent_id = %s, paid_at = %s WHERE id = %d AND status != %s',
                'paid',
                $paid_cents,
                sanitize_text_field($payment_intent_id),
                $this->now(),
                $order_id,
                'paid'
            )
        );

        if ((int) $updated === 1) {
            $this->record_discount_redemption($order_id);
        }
    }

    /** Payment succeeded for less than the quoted total — never fulfil. */
    public function flag_underpaid(int $order_id, int $paid_cents): void
    {
        $this->update_row(
            $order_id,
            ['status' => 'underpaid', 'paid_cents' => $paid_cents],
            ['%s', '%d']
        );

        do_action('ptp_order_underpaid', $order_id, $paid_cents);
    }

    private function write_items(int $order_id, PTP_Quote $quote): void
    {
        $table = PTP_Schema::table('order_items');

        foreach ($quote->lines() as $line) {
            $this->db()->insert(
                $table,
                [
                    'order_id'     => $order_id,
                    'item_type'    => $line['type'],
                    'item_id'      => $line['id'],
                    'label'        => $line['label'],
                    'qty'          => $line['qty'],
                    'unit_cents'   => $line['unit_cents'],
                    'amount_cents' => $line['amount_cents'],
                ],
                ['%d', '%s', '%d', '%s', '%d', '%d', '%d']
            );
        }
    }

    /**
     * Record redemption as a row, not a counter bump.
     *
     * The unique index on (discount_id, order_id) means a duplicate webhook
     * cannot double-count, and validation never touches this table — so a code
     * cannot be exhausted by anyone repeatedly checking whether it is valid.
     */
    private function record_discount_redemption(int $order_id): void
    {
        $order = $this->find_row($order_id);

        if ($order === null || $order->discount_code === '') {
            return;
        }

        $discount = PTP_Discounts::find($order->discount_code);

        if ($discount === null) {
            return;
        }

        $this->db()->query(
            $this->db()->prepare(
                'INSERT IGNORE INTO ' . PTP_Schema::table('discount_redemptions') . ' (discount_id, order_id, redeemed_at) VALUES (%d, %d, %s)',
                $discount->id(),
                $order_id,
                $this->now()
            )
        );
    }
}
