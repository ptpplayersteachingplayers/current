<?php
/**
 * Trainer directory.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Page_Trainers extends PTP_Page
{
    protected function template(): string
    {
        return 'trainers';
    }

    protected function data(array $atts): array
    {
        $atts = shortcode_atts(['limit' => 60], $atts, 'ptp_trainers');

        return ['trainers' => ptp_core()->trainers()->active(absint($atts['limit']))];
    }
}
