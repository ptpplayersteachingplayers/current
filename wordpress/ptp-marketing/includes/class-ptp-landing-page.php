<?php
/**
 * The single landing-page funnel.
 *
 * Campaign variations are attributes, not forked templates:
 *   [ptp_landing variant="warm" headline="..." cta="Claim your spot"]
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Landing_Page
{
    private const VARIANTS = ['cold', 'warm', 'squad'];

    public function register(): void
    {
    }

    public function render($atts = []): string
    {
        $atts = shortcode_atts(
            [
                'variant'  => 'cold',
                'headline' => '',
                'subhead'  => '',
                'cta'      => __('Find a camp', 'ptp'),
                'cta_url'  => '',
            ],
            is_array($atts) ? $atts : [],
            'ptp_landing'
        );

        $variant = in_array($atts['variant'], self::VARIANTS, true) ? $atts['variant'] : 'cold';

        wp_enqueue_style('ptp-marketing');

        $data = [
            'variant'  => $variant,
            'headline' => sanitize_text_field((string) $atts['headline']),
            'subhead'  => sanitize_text_field((string) $atts['subhead']),
            'cta'      => sanitize_text_field((string) $atts['cta']),
            // Falls back to the camps page rather than trusting an arbitrary URL.
            'cta_url'  => $this->safe_url((string) $atts['cta_url']),
        ];

        ob_start();
        require PTP_MARKETING_DIR . 'templates/landing.php';

        return (string) ob_get_clean();
    }

    /** Only same-host URLs are accepted, so a shortcode cannot become an open redirect. */
    private function safe_url(string $url): string
    {
        $fallback = class_exists('PTP_Public_Links') ? PTP_Public_Links::camps() : home_url('/');

        if ($url === '') {
            return $fallback;
        }

        return wp_validate_redirect(esc_url_raw($url), $fallback);
    }
}
