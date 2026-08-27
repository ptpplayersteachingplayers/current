<?php
/**
 * Single camp page.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Page_Camp_Detail extends PTP_Page
{
    protected function template(): string
    {
        return 'camp-detail';
    }

    protected function data(array $atts): array
    {
        $atts = shortcode_atts(['id' => 0], $atts, 'ptp_camp');
        $camp = PTP_Camps_Catalogue::find(absint($atts['id']));

        if ($camp === null) {
            throw new PTP_Repository_Exception(__('That camp is no longer listed.', 'ptp'));
        }

        return [
            'camp'      => $camp,
            'seats_left' => PTP_Camps_Catalogue::seats_remaining((int) $camp->id),
        ];
    }
}
