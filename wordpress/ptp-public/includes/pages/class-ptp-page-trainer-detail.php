<?php
/**
 * Public trainer profile, served at /trainer/{slug}.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Page_Trainer_Detail extends PTP_Page
{
    protected function template(): string
    {
        return 'trainer-detail';
    }

    protected function data(array $atts): array
    {
        $atts = shortcode_atts(['slug' => ''], $atts, 'ptp_trainer');

        $slug = (string) $atts['slug'];
        if ($slug === '') {
            $slug = (string) get_query_var('ptp_trainer_slug');
        }

        $trainer = ptp_core()->trainers()->find_by_slug($slug);

        if ($trainer === null) {
            throw new PTP_Repository_Exception(__('That trainer profile is not available.', 'ptp'));
        }

        return ['trainer' => $trainer];
    }
}
