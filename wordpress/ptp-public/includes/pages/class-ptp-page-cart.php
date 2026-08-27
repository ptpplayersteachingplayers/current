<?php
/**
 * Cart.
 *
 * The cart is a list of item references held client-side and re-priced by the
 * server on every change. It deliberately stores no prices: the figures shown
 * always come back from PTP_Pricing.
 *
 * Note the old cart template shipped a debug panel gated with
 * `current_user_can(...) || isset($_GET['debug'])` — an inverted operator that
 * exposed session and Stripe configuration to any visitor appending ?debug.
 * There is no debug surface here; diagnostics live in the admin plugin.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Page_Cart extends PTP_Page
{
    protected function template(): string
    {
        return 'cart';
    }

    protected function data(array $atts): array
    {
        return [
            'checkout_url' => PTP_Public_Links::checkout(),
            'camps_url'    => PTP_Public_Links::camps(),
        ];
    }
}
