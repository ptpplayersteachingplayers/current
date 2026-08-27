<?php
/**
 * Discount code lookup.
 *
 * Validation here is strictly read-only. The audit found a public endpoint that
 * incremented a code's usage counter every time anyone checked it, letting an
 * attacker exhaust a limited-run code without ever buying anything. Usage is
 * counted from the discount_redemptions table, written only on payment.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Discounts
{
    public static function find(string $code): ?PTP_Discount
    {
        global $wpdb;

        $row = $wpdb->get_row(
            $wpdb->prepare(
                'SELECT * FROM ' . PTP_Schema::table('discounts') . ' WHERE code = %s AND active = 1',
                strtoupper(sanitize_text_field($code))
            )
        );

        return $row ? new PTP_Discount($row) : null;
    }
}
