<?php
/**
 * Plugin Name: PTP Core
 * Description: Shared data, services and security layer for the PTP platform. No user interface — PTP Public, PTP Admin and PTP Marketing all build on this.
 * Version: 1.0.0
 * Author: PTP
 * Requires PHP: 7.4
 *
 * ---------------------------------------------------------------------------
 * ARCHITECTURE
 * ---------------------------------------------------------------------------
 * PTP Core owns every piece of state and every outbound integration. It never
 * renders a page, registers a shortcode, or adds an admin menu. That rule is
 * what keeps the front-end and back-end plugins from re-implementing each
 * other, which is how the previous codebase ended up with 14 checkout
 * implementations writing the same order tables.
 *
 *   ptp-core       data + services + security   (this plugin)
 *   ptp-public     front-end pages              (depends on core)
 *   ptp-admin      back-office screens          (depends on core)
 *   ptp-marketing  landing pages / funnels      (depends on core)
 *
 * Dependency direction is strictly one-way. Core must never call into a
 * consumer plugin; consumers reach core only through the service classes
 * exposed by ptp_core().
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

define('PTP_CORE_VERSION', '1.0.0');
define('PTP_CORE_FILE', __FILE__);
define('PTP_CORE_DIR', plugin_dir_path(__FILE__));
define('PTP_CORE_URL', plugin_dir_url(__FILE__));

require_once PTP_CORE_DIR . 'includes/class-ptp-autoloader.php';
PTP_Autoloader::register(PTP_CORE_DIR . 'includes/', 'PTP_');

/**
 * Service container.
 *
 * Consumer plugins call ptp_core()->stripe(), ptp_core()->bookings(), etc.
 * Services are lazily constructed and shared, so there is exactly one Stripe
 * client and one pricing engine per request.
 */
final class PTP_Core
{
    private static ?PTP_Core $instance = null;

    /** @var array<string, object> */
    private array $services = [];

    public static function instance(): PTP_Core
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    private function __construct()
    {
        add_action('plugins_loaded', [$this, 'boot'], 5);
        add_action('init', [$this, 'register_assets']);
    }

    public function boot(): void
    {
        PTP_Schema::maybe_upgrade();
        $this->stripe()->register_hooks();
        $this->connect()->register_hooks();
        (new PTP_Booking_Fulfilment())->register_hooks();
        (new PTP_Training_Catalogue())->register();
        $this->mail()->register_hooks();
        $this->reminders()->register_hooks();
        $this->api()->register_hooks();

        /**
         * Consumer plugins hook here rather than at plugins_loaded, which
         * guarantees the schema and services are ready before they run.
         */
        do_action('ptp_core_ready', $this);
    }

    /**
     * The single source of design tokens. Every other plugin enqueues its own
     * stylesheet with 'ptp-tokens' as a dependency, so brand changes are made
     * in exactly one file.
     */
    public function register_assets(): void
    {
        wp_register_style(
            'ptp-tokens',
            PTP_CORE_URL . 'assets/css/ptp-tokens.css',
            [],
            PTP_CORE_VERSION
        );
    }

    public function guard(): PTP_Guard
    {
        return $this->service(PTP_Guard::class);
    }

    public function pricing(): PTP_Pricing
    {
        return $this->service(PTP_Pricing::class);
    }

    public function stripe(): PTP_Stripe
    {
        return $this->service(PTP_Stripe::class);
    }

    /** Refunds and payout reversal, governed by the cancellation policy. */
    public function refunds(): PTP_Refunds
    {
        return $this->service(PTP_Refunds::class);
    }

    public function cancellation_policy(): PTP_Cancellation_Policy
    {
        return $this->service(PTP_Cancellation_Policy::class);
    }

    /** Stripe Connect: trainer onboarding, the per-trainer amount, and payouts. */
    public function connect(): PTP_Connect
    {
        return $this->service(PTP_Connect::class);
    }

    /** The REST surface the mobile app consumes. */
    public function api(): PTP_Api
    {
        return $this->service(PTP_Api::class);
    }

    /** Computed booking slots. Stateless; safe to call freely. */
    public function slots(): PTP_Slots
    {
        return $this->service(PTP_Slots::class);
    }

    public function availability(): PTP_Availability_Repository
    {
        return $this->service(PTP_Availability_Repository::class);
    }

    public function mail(): PTP_Mail
    {
        return $this->service(PTP_Mail::class);
    }

    /** Hourly cron that mails session reminders. */
    public function reminders(): PTP_Reminders
    {
        return $this->service(PTP_Reminders::class);
    }

    public function parents(): PTP_Parents_Repository
    {
        return $this->service(PTP_Parents_Repository::class);
    }

    public function players(): PTP_Players_Repository
    {
        return $this->service(PTP_Players_Repository::class);
    }

    public function trainers(): PTP_Trainers_Repository
    {
        return $this->service(PTP_Trainers_Repository::class);
    }

    public function bookings(): PTP_Bookings_Repository
    {
        return $this->service(PTP_Bookings_Repository::class);
    }

    public function orders(): PTP_Orders_Repository
    {
        return $this->service(PTP_Orders_Repository::class);
    }

    /** @template T of object @param class-string<T> $class @return T */
    private function service(string $class): object
    {
        if (!isset($this->services[$class])) {
            $this->services[$class] = new $class();
        }

        /** @var T */
        return $this->services[$class];
    }
}

function ptp_core(): PTP_Core
{
    return PTP_Core::instance();
}

register_activation_hook(__FILE__, ['PTP_Schema', 'install']);

/**
 * Clear the reminder cron on deactivation. Leaving a scheduled hook behind
 * means WordPress keeps firing an action nothing handles — harmless, but it
 * also means reactivating double-schedules it.
 */
register_deactivation_hook(__FILE__, ['PTP_Reminders', 'unschedule']);

ptp_core();
