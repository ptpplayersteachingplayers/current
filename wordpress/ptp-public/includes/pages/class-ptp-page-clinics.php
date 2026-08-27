<?php
/**
 * Group clinic listing and registration.
 *
 * Folds in the old standalone Group Clinics plugin's public surface. Clinics
 * are priced and booked through the same quote and order path as everything
 * else, rather than the separate Stripe integration they used to carry.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Page_Clinics extends PTP_Page
{
    protected function template(): string
    {
        return 'clinics';
    }

    protected function data(array $atts): array
    {
        $atts = shortcode_atts(['limit' => 20], $atts, 'ptp_clinics');

        return ['clinics' => PTP_Clinics_Catalogue::upcoming(absint($atts['limit']))];
    }
}
