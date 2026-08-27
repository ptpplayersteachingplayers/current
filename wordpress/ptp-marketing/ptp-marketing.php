<?php
/**
 * Plugin Name: PTP Marketing
 * Description: Ad landing pages, lead capture and attribution. Kept separate from PTP Public because it deploys on a campaign cadence, not a product one.
 * Version: 1.0.0
 * Author: PTP
 * Requires PHP: 7.4
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN PLUGIN
 * ---------------------------------------------------------------------------
 * Landing pages change when a campaign changes — weekly, sometimes daily — and
 * a bad landing page should never be able to take checkout down with it. This
 * plugin therefore holds no booking or payment logic; the call to action on
 * every page is a link into PTP Public.
 *
 * The old landing bundle shipped six variants of two funnels (cold, cold-v3,
 * warm, warm-v3, warm-v6, squad) plus a dated world-cup one-off. A funnel here
 * is one template with campaign copy supplied as attributes, so a new campaign
 * is a new page, not a new file.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

define('PTP_MARKETING_VERSION', '1.0.0');
define('PTP_MARKETING_DIR', plugin_dir_path(__FILE__));
define('PTP_MARKETING_URL', plugin_dir_url(__FILE__));

add_action('ptp_core_ready', 'ptp_marketing_boot');

function ptp_marketing_boot(): void
{
    PTP_Autoloader::register(PTP_MARKETING_DIR . 'includes/', 'PTP_');

    PTP_Marketing::instance()->boot();
}

final class PTP_Marketing
{
    private static ?PTP_Marketing $instance = null;

    public static function instance(): PTP_Marketing
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    public function boot(): void
    {
        add_action('init', [$this, 'register']);
        add_action('wp_enqueue_scripts', [$this, 'register_assets']);

        (new PTP_Lead_Capture())->register();
        (new PTP_Attribution())->register();
    }

    public function register(): void
    {
        $landing = new PTP_Landing_Page();

        // One funnel shortcode. Campaign differences are attributes and copy,
        // not forked templates.
        add_shortcode('ptp_landing', [$landing, 'render']);
        $landing->register();
    }

    public function register_assets(): void
    {
        wp_register_style(
            'ptp-marketing',
            PTP_MARKETING_URL . 'assets/css/ptp-marketing.css',
            ['ptp-tokens'],
            PTP_MARKETING_VERSION
        );
    }
}
