<?php
/**
 * Plugin Name: PTP Admin
 * Description: The PTP back office — scheduling, orders, customers, trainers and settings. One menu tree, one screen per job.
 * Version: 1.0.0
 * Author: PTP
 * Requires PHP: 7.4
 *
 * ---------------------------------------------------------------------------
 * SCOPE
 * ---------------------------------------------------------------------------
 * Everything staff see and nothing customers see. This plugin renders no
 * front-end output and registers no shortcodes.
 *
 * The old platform declared 12 top-level admin menus and 85 submenus across
 * four plugins, several pointing at the same data through different screens
 * (three order views, two scheduling boards, a separate customer hub beside a
 * separate customer manager). The menu below is the whole back office.
 *
 * Every screen extends PTP_Screen, which enforces the capability check on
 * render and on every action — never relying on the screen being reachable
 * only from a capability-gated menu, which was the pattern that left a
 * database-wipe tool guarded by a nonce alone.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

define('PTP_ADMIN_VERSION', '1.0.0');
define('PTP_ADMIN_DIR', plugin_dir_path(__FILE__));
define('PTP_ADMIN_URL', plugin_dir_url(__FILE__));

add_action('ptp_core_ready', 'ptp_admin_boot');

function ptp_admin_boot(): void
{
    if (!is_admin()) {
        return;
    }

    PTP_Autoloader::register(PTP_ADMIN_DIR . 'includes/', 'PTP_');

    PTP_Admin::instance()->boot();
}

final class PTP_Admin
{
    private static ?PTP_Admin $instance = null;

    public const MENU_SLUG = 'ptp';

    /** The complete back office: slug => screen class. */
    private const SCREENS = [
        'ptp'           => PTP_Screen_Today::class,
        'ptp-schedule'  => PTP_Screen_Schedule::class,
        'ptp-orders'    => PTP_Screen_Orders::class,
        'ptp-customers' => PTP_Screen_Customers::class,
        'ptp-trainers'  => PTP_Screen_Trainers::class,
        'ptp-discounts' => PTP_Screen_Discounts::class,
        'ptp-settings'  => PTP_Screen_Settings::class,
    ];

    /** @var array<string, PTP_Screen> */
    private array $screens = [];

    public static function instance(): PTP_Admin
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    public function boot(): void
    {
        foreach (self::SCREENS as $slug => $class) {
            $screen = new $class();
            $this->screens[$slug] = $screen;
            $screen->register();
        }

        add_action('admin_menu', [$this, 'register_menu']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue']);
    }

    public function register_menu(): void
    {
        add_menu_page(
            __('PTP', 'ptp'),
            __('PTP', 'ptp'),
            'manage_options',
            self::MENU_SLUG,
            [$this->screens['ptp'], 'render'],
            'dashicons-shield',
            3
        );

        foreach ($this->screens as $slug => $screen) {
            add_submenu_page(
                self::MENU_SLUG,
                $screen->title(),
                $screen->menu_label(),
                $screen->capability(),
                $slug,
                [$screen, 'render']
            );
        }
    }

    /** Admin CSS loads only on PTP screens, never across all of wp-admin. */
    public function enqueue(string $hook): void
    {
        if (strpos($hook, self::MENU_SLUG) === false) {
            return;
        }

        wp_enqueue_style('ptp-tokens');
        wp_enqueue_style(
            'ptp-admin',
            PTP_ADMIN_URL . 'assets/css/ptp-admin.css',
            ['ptp-tokens'],
            PTP_ADMIN_VERSION
        );
    }
}
