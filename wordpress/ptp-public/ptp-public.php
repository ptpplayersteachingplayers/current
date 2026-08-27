<?php
/**
 * Plugin Name: PTP Public
 * Description: Every customer-facing page on the PTP site — camps, trainers, checkout, and the parent and trainer dashboards. Renders only; all state lives in PTP Core.
 * Version: 1.0.0
 * Author: PTP
 * Requires PHP: 7.4
 *
 * ---------------------------------------------------------------------------
 * SCOPE
 * ---------------------------------------------------------------------------
 * This plugin owns the front-end page surface and nothing else. It has no
 * tables, no Stripe client, no email templates and no admin menus. When a page
 * needs data it asks a Core repository; when it needs to charge someone it asks
 * Core for a quote.
 *
 * The old platform registered 122 shortcodes, many of them near-duplicates
 * (ptp_camp_thank_you and ptp_camp_thankyou; five landing-page variants;
 * ptp_find_camp beside ptp_find_camp_v35). This registry is deliberately
 * short. Adding one means deciding it is a genuinely distinct page.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

define('PTP_PUBLIC_VERSION', '1.0.0');
define('PTP_PUBLIC_DIR', plugin_dir_path(__FILE__));
define('PTP_PUBLIC_URL', plugin_dir_url(__FILE__));

add_action('ptp_core_ready', 'ptp_public_boot');

function ptp_public_boot(): void
{
    // Registered under the shared PTP_ prefix so the PTP_Page base class
    // resolves alongside the PTP_Page_* subclasses in includes/pages/.
    PTP_Autoloader::register(PTP_PUBLIC_DIR . 'includes/', 'PTP_');

    PTP_Public::instance()->boot();
}

/**
 * Front-end bootstrap: registers pages, assets and the AJAX surface.
 */
final class PTP_Public
{
    private static ?PTP_Public $instance = null;

    /**
     * The complete front-end page map: shortcode => page class.
     *
     * Each class extends PTP_Page and owns one screen. Nothing else in this
     * plugin may call add_shortcode.
     *
     * @var array<string, class-string<PTP_Page>>
     */
    private const PAGES = [
        // Browse and book
        'ptp_camps'            => PTP_Page_Camps::class,
        'ptp_camp'             => PTP_Page_Camp_Detail::class,
        'ptp_trainers'         => PTP_Page_Trainers::class,
        'ptp_trainer'          => PTP_Page_Trainer_Detail::class,
        'ptp_book'             => PTP_Page_Book::class,
        'ptp_clinics'          => PTP_Page_Clinics::class,

        // Buy
        'ptp_cart'             => PTP_Page_Cart::class,
        'ptp_checkout'         => PTP_Page_Checkout::class,
        'ptp_thank_you'        => PTP_Page_Thank_You::class,

        // Account
        'ptp_login'            => PTP_Page_Login::class,
        'ptp_register'         => PTP_Page_Register::class,
        'ptp_parent_dashboard' => PTP_Page_Parent_Dashboard::class,
        'ptp_trainer_dashboard' => PTP_Page_Trainer_Dashboard::class,

        // Apply
        'ptp_trainer_application' => PTP_Page_Trainer_Application::class,
    ];

    public static function instance(): PTP_Public
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    public function boot(): void
    {
        add_action('init', [$this, 'register_post_types']);
        add_action('init', [$this, 'register_pages']);
        add_action('wp_enqueue_scripts', [$this, 'register_assets']);
        add_action('init', [$this, 'register_routes']);

        /**
         * Price resolvers must be registered before any quote is built. They
         * are the only way an item type gets a price, and each one reads from
         * the database — which is what makes client-side price tampering
         * structurally impossible rather than merely guarded against.
         */
        PTP_Camps_Catalogue::register_price_resolver();
        PTP_Clinics_Catalogue::register_price_resolver();
    }

    /**
     * Camps and clinics are custom post types so staff can edit copy and
     * imagery in the normal WordPress editor. Price and capacity live in post
     * meta and are read server-side at checkout.
     */
    public function register_post_types(): void
    {
        register_post_type(PTP_Camps_Catalogue::POST_TYPE, [
            'label'        => __('Camps', 'ptp'),
            'public'       => true,
            'has_archive'  => true,
            'rewrite'      => ['slug' => 'camps'],
            'supports'     => ['title', 'editor', 'thumbnail', 'excerpt'],
            'show_in_rest' => true,
            'menu_icon'    => 'dashicons-groups',
        ]);

        register_post_type(PTP_Clinics_Catalogue::POST_TYPE, [
            'label'        => __('Clinics', 'ptp'),
            'public'       => true,
            'has_archive'  => true,
            'rewrite'      => ['slug' => 'clinics'],
            'supports'     => ['title', 'editor', 'thumbnail', 'excerpt'],
            'show_in_rest' => true,
            'menu_icon'    => 'dashicons-calendar-alt',
        ]);
    }

    public function register_pages(): void
    {
        foreach (self::PAGES as $shortcode => $class) {
            $page = new $class();
            add_shortcode($shortcode, [$page, 'render']);
            $page->register();
        }
    }

    /**
     * Pretty URLs for the two pages that need them for SEO. Everything else is
     * a WordPress page containing a shortcode, which keeps routing legible.
     */
    public function register_routes(): void
    {
        add_rewrite_rule('^trainer/([^/]+)/?$', 'index.php?ptp_trainer_slug=$matches[1]', 'top');
        add_rewrite_tag('%ptp_trainer_slug%', '([^&]+)');
    }

    /**
     * Assets are registered here but enqueued per-page, so a landing page does
     * not ship the checkout bundle. The old build loaded everything everywhere.
     */
    public function register_assets(): void
    {
        wp_register_style(
            'ptp-public',
            PTP_PUBLIC_URL . 'assets/css/ptp-public.css',
            ['ptp-tokens'],
            PTP_PUBLIC_VERSION
        );

        wp_register_script(
            'ptp-checkout',
            PTP_PUBLIC_URL . 'assets/js/ptp-checkout.js',
            ['stripe-js'],
            PTP_PUBLIC_VERSION,
            true
        );

        wp_register_script(
            'ptp-booking',
            PTP_PUBLIC_URL . 'assets/js/ptp-booking.js',
            [],
            PTP_PUBLIC_VERSION,
            true
        );

        // Shared portal behaviour: the small AJAX actions both dashboards use.
        wp_register_script(
            'ptp-portal',
            PTP_PUBLIC_URL . 'assets/js/ptp-portal.js',
            [],
            PTP_PUBLIC_VERSION,
            true
        );
    }
}
