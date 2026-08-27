<?php
/**
 * Camp listing.
 *
 * Camps are a public catalogue, so this page reads without an actor. Pricing
 * shown here is presentational only — the authoritative figure is computed at
 * checkout by PTP_Pricing.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Page_Camps extends PTP_Page
{
    protected function template(): string
    {
        return 'camps';
    }

    protected function data(array $atts): array
    {
        $atts = shortcode_atts(['limit' => 24, 'location' => ''], $atts, 'ptp_camps');

        return [
            'camps'    => PTP_Camps_Catalogue::upcoming(absint($atts['limit']), sanitize_text_field((string) $atts['location'])),
            'location' => sanitize_text_field((string) $atts['location']),
        ];
    }
}
