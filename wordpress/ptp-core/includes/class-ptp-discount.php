<?php
/**
 * A single discount code.
 *
 * Its own file so PTP_Discount resolves independently of the PTP_Discounts
 * lookup that usually constructs it.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Discount
{
    private object $row;

    public function __construct(object $row)
    {
        $this->row = $row;
    }

    public function id(): int
    {
        return (int) $this->row->id;
    }

    public function code(): string
    {
        return (string) $this->row->code;
    }

    public function label(): string
    {
        return (string) $this->row->label;
    }

    /** Redeemable checks the live redemption count, the window, and the floor. */
    public function is_redeemable_by(PTP_Actor $actor, int $subtotal_cents): bool
    {
        if ($subtotal_cents < (int) $this->row->min_subtotal_cents) {
            return false;
        }

        $now = current_time('mysql', true);

        if (!empty($this->row->starts_at) && $now < $this->row->starts_at) {
            return false;
        }

        if (!empty($this->row->ends_at) && $now > $this->row->ends_at) {
            return false;
        }

        $limit = (int) $this->row->usage_limit;

        return $limit === 0 || $this->redemption_count() < $limit;
    }

    /** Value computed here from the stored kind, never taken from a request. */
    public function value_for(int $subtotal_cents): int
    {
        $value = (int) $this->row->value;

        if ($this->row->kind === 'percent') {
            return (int) round($subtotal_cents * min(100, $value) / 100);
        }

        return min($value, $subtotal_cents);
    }

    private function redemption_count(): int
    {
        global $wpdb;

        return (int) $wpdb->get_var(
            $wpdb->prepare(
                'SELECT COUNT(*) FROM ' . PTP_Schema::table('discount_redemptions') . ' WHERE discount_id = %d',
                $this->id()
            )
        );
    }
}
