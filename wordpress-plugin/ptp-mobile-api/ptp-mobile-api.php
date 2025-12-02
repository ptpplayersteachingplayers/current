<?php
/**
 * Plugin Name: PTP Mobile API
 * Plugin URI: https://ptpsummercamps.com
 * Description: REST API endpoints for the PTP Soccer Camps mobile app
 * Version: 1.1.0
 * Author: Players Teaching Players
 * Author URI: https://ptpsummercamps.com
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: ptp-mobile-api
 *
 * Requires at least: 5.8
 * Requires PHP: 7.4
 *
 * @package PTP_Mobile_API
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

// Plugin version
define('PTP_MOBILE_API_VERSION', '1.1.0');

// Plugin directory path
define('PTP_MOBILE_API_PATH', plugin_dir_path(__FILE__));

/**
 * Main PTP Mobile API Class
 *
 * Handles REST API endpoint registration and business logic
 * for the PTP Soccer Camps mobile application.
 */
class PTP_Mobile_API {

    /**
     * REST API namespace
     *
     * @var string
     */
    private $namespace = 'ptp/v1';

    /**
     * Database table name for device tokens
     *
     * @var string
     */
    private $devices_table;

    /**
     * Constructor
     *
     * Sets up hooks and initializes the plugin
     */
    public function __construct() {
        global $wpdb;
        $this->devices_table = $wpdb->prefix . 'ptp_mobile_devices';

        // Register REST API routes
        add_action('rest_api_init', array($this, 'register_routes'));

        // Create database table on activation
        register_activation_hook(__FILE__, array($this, 'activate'));

        // Add CORS headers for mobile app
        add_action('rest_api_init', array($this, 'add_cors_headers'));
    }

    /**
     * Plugin activation
     *
     * Creates the database table for storing device tokens
     */
    public function activate() {
        $this->create_devices_table();
    }

    /**
     * Create devices table using dbDelta
     */
    private function create_devices_table() {
        global $wpdb;

        $charset_collate = $wpdb->get_charset_collate();

        $sql = "CREATE TABLE {$this->devices_table} (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT(20) UNSIGNED NOT NULL,
            token VARCHAR(255) NOT NULL,
            platform VARCHAR(20) DEFAULT 'unknown',
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY user_token (user_id, token),
            KEY user_id (user_id)
        ) $charset_collate;";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql);

        // Store version for future upgrades
        update_option('ptp_mobile_api_db_version', PTP_MOBILE_API_VERSION);
    }

    /**
     * Sanitize float request params
     */
    private function sanitize_float_param($request, $key) {
        $value = $request->get_param($key);
        if ($value === null || $value === '') {
            return null;
        }

        return is_numeric($value) ? (float) $value : null;
    }

    /**
     * Calculate distance in miles between two coordinates using Haversine formula
     */
    private function calculate_distance_miles($lat1, $lon1, $lat2, $lon2) {
        $earth_radius = 3958.8; // miles
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);
        $a = sin($dLat / 2) * sin($dLat / 2) + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) * sin($dLon / 2);
        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
        return $earth_radius * $c;
    }

    /**
     * Add CORS headers for mobile app requests
     */
    public function add_cors_headers() {
        // Allow requests from any origin for the mobile app
        remove_filter('rest_pre_serve_request', 'rest_send_cors_headers');
        add_filter('rest_pre_serve_request', function($value) {
            header('Access-Control-Allow-Origin: *');
            header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
            header('Access-Control-Allow-Headers: Authorization, Content-Type');
            header('Access-Control-Allow-Credentials: true');
            return $value;
        });
    }

    /**
     * Register REST API routes
     */
    public function register_routes() {
        // GET /ptp/v1/me - Get current user info
        register_rest_route($this->namespace, '/me', array(
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => array($this, 'get_me'),
            'permission_callback' => array($this, 'require_login'),
        ));

        // GET /ptp/v1/camps - Get list of camps/clinics
        register_rest_route($this->namespace, '/camps', array(
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => array($this, 'get_camps'),
            'permission_callback' => '__return_true', // Public endpoint
        ));

        // GET /ptp/v1/app-config - Dynamic app configuration for the mobile app
        register_rest_route($this->namespace, '/app-config', array(
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => array($this, 'get_app_config'),
            'permission_callback' => '__return_true',
        ));

        // GET /ptp/v1/trainers - Get list of trainers
        register_rest_route($this->namespace, '/trainers', array(
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => array($this, 'get_trainers'),
            'permission_callback' => '__return_true', // Public endpoint
        ));

        // GET /ptp/v1/sessions - Get user's sessions/schedule
        register_rest_route($this->namespace, '/sessions', array(
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => array($this, 'get_sessions'),
            'permission_callback' => array($this, 'require_login'),
        ));

        // POST /ptp/v1/devices - Register device for push notifications
        register_rest_route($this->namespace, '/devices', array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => array($this, 'register_device'),
            'permission_callback' => array($this, 'require_login'),
            'args'                => array(
                'token' => array(
                    'required'          => true,
                    'type'              => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                    'validate_callback' => function($param) {
                        return !empty($param) && strlen($param) <= 255;
                    },
                ),
                'platform' => array(
                    'required'          => true,
                    'type'              => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                    'validate_callback' => function($param) {
                        return in_array($param, array('ios', 'android'), true);
                    },
                ),
            ),
        ));
    }

    /**
     * Permission callback: Require authenticated user
     *
     * @return bool|WP_Error
     */
    public function require_login() {
        if (!is_user_logged_in()) {
            return new WP_Error(
                'rest_not_logged_in',
                __('You must be logged in to access this endpoint.', 'ptp-mobile-api'),
                array('status' => 401)
            );
        }
        return true;
    }

    /**
     * GET /ptp/v1/me
     *
     * Returns current user information
     *
     * @param WP_REST_Request $request
     * @return WP_REST_Response|WP_Error
     */
    public function get_me($request) {
        $user = wp_get_current_user();

        if (!$user->exists()) {
            return new WP_Error(
                'rest_user_not_found',
                __('User not found.', 'ptp-mobile-api'),
                array('status' => 404)
            );
        }

        // Get primary role
        $roles = $user->roles;
        $role = !empty($roles) ? reset($roles) : 'subscriber';

        $response = array(
            'id'    => $user->ID,
            'name'  => $user->display_name,
            'email' => $user->user_email,
            'role'  => $role,
        );

        return rest_ensure_response($response);
    }

    /**
     * GET /ptp/v1/camps
     *
     * Returns list of camps and clinics from WooCommerce products
     *
     * @param WP_REST_Request $request
     * @return WP_REST_Response|WP_Error
     */
    public function get_camps($request) {
        // Check if WooCommerce is active
        if (!class_exists('WooCommerce')) {
            return new WP_Error(
                'woocommerce_not_active',
                __('WooCommerce is required for this endpoint.', 'ptp-mobile-api'),
                array('status' => 500)
            );
        }

        $lat = $this->sanitize_float_param($request, 'lat');
        $lng = $this->sanitize_float_param($request, 'lng');
        $radius = $this->sanitize_float_param($request, 'radius');

        // Query products in summer or winter-clinics categories
        $args = array(
            'post_type'      => 'product',
            'post_status'    => 'publish',
            'posts_per_page' => 100,
            'orderby'        => 'meta_value',
            'meta_key'       => '_camp_date',
            'order'          => 'ASC',
            'tax_query'      => array(
                array(
                    'taxonomy' => 'product_cat',
                    'field'    => 'slug',
                    'terms'    => array('summer', 'winter-clinics'),
                ),
            ),
        );

        $products = get_posts($args);
        $camps = array();

        foreach ($products as $product) {
            $wc_product = wc_get_product($product->ID);

            if (!$wc_product) {
                continue;
            }

            // Get product category
            $categories = wp_get_post_terms($product->ID, 'product_cat', array('fields' => 'slugs'));
            $category = !empty($categories) ? $categories[0] : 'summer';

            // Get product image
            $image_id = $wc_product->get_image_id();
            $image_url = $image_id ? wp_get_attachment_image_url($image_id, 'medium') : null;

            // Get custom meta
            $camp_date = get_post_meta($product->ID, '_camp_date', true);
            $camp_time = get_post_meta($product->ID, '_camp_time', true);
            $camp_location = get_post_meta($product->ID, '_camp_location', true);
            $camp_state = get_post_meta($product->ID, '_camp_state', true);
            $bestseller = get_post_meta($product->ID, '_bestseller', true);
            $almost_full = get_post_meta($product->ID, '_almost_full', true);
            $camp_lat = get_post_meta($product->ID, '_camp_lat', true);
            $camp_lng = get_post_meta($product->ID, '_camp_lng', true);
            $available_seats = get_post_meta($product->ID, '_available_seats', true);
            $is_waitlist_only = get_post_meta($product->ID, '_is_waitlist_only', true);

            // If geo filters are provided, skip camps outside the radius
            if ($lat !== null && $lng !== null && $radius !== null && $camp_lat && $camp_lng) {
                $distance = $this->calculate_distance_miles($lat, $lng, (float) $camp_lat, (float) $camp_lng);
                if ($distance > $radius) {
                    continue;
                }
            }

            $camps[] = array(
                'id'              => $product->ID,
                'name'            => $wc_product->get_name(),
                'image'           => $image_url,
                'price'           => $wc_product->get_price_html()
                    ? wp_strip_all_tags($wc_product->get_price_html())
                    : '$' . $wc_product->get_price(),
                'date'            => $camp_date ?: '',
                'time'            => $camp_time ?: '',
                'location'        => $camp_location ?: '',
                'state'           => $camp_state ?: '',
                'bestseller'      => $bestseller === 'yes',
                'almost_full'     => $almost_full === 'yes',
                'availableSeats'  => $available_seats !== '' ? (int) $available_seats : null,
                'isAlmostFull'    => $almost_full === 'yes',
                'isWaitlistOnly'  => $is_waitlist_only === 'yes',
                'latitude'        => $camp_lat !== '' ? (float) $camp_lat : null,
                'longitude'       => $camp_lng !== '' ? (float) $camp_lng : null,
                'product_url'     => get_permalink($product->ID),
                'description'     => $wc_product->get_short_description(),
                'category'        => $category,
            );
        }

        return rest_ensure_response($camps);
    }

    /**
     * GET /ptp/v1/app-config
     *
     * Returns dynamic configuration for the mobile app (feature flags, banners)
     */
    public function get_app_config($request) {
        $config = array(
            'minSupportedAppVersion' => '1.0.0',
            'features' => array(
                'enablePrivateTraining' => true,
                'enableMessaging'      => true,
            ),
            'banners' => array(
                array(
                    'id'       => 'winter-clinic',
                    'title'    => 'Winter Clinics Near You',
                    'body'     => '3 hours, 500 touches, no lines.',
                    'ctaText'  => 'Find a Clinic',
                    'url'      => 'https://ptpsummercamps.com/winter',
                ),
            ),
        );

        /**
         * Allow site admins to filter the mobile app configuration.
         */
        $config = apply_filters('ptp_mobile_app_config', $config, $request);

        return rest_ensure_response($config);
    }

    /**
     * GET /ptp/v1/trainers
     *
     * Returns list of private trainers
     *
     * @param WP_REST_Request $request
     * @return WP_REST_Response|WP_Error
     */
    public function get_trainers($request) {
        // Check if ptp_trainer post type exists
        if (!post_type_exists('ptp_trainer')) {
            // Return empty array if trainer CPT doesn't exist yet
            return rest_ensure_response(array());
        }

        $args = array(
            'post_type'      => 'ptp_trainer',
            'post_status'    => 'publish',
            'posts_per_page' => 50,
            'orderby'        => 'menu_order title',
            'order'          => 'ASC',
        );

        $trainers_query = get_posts($args);
        $trainers = array();

        foreach ($trainers_query as $trainer_post) {
            // Get featured image
            $photo_id = get_post_thumbnail_id($trainer_post->ID);
            $photo_url = $photo_id ? wp_get_attachment_image_url($photo_id, 'medium') : null;

            // Get trainer meta
            $college = get_post_meta($trainer_post->ID, '_ptp_college', true);
            $bio = get_post_meta($trainer_post->ID, '_ptp_bio', true);
            $city = get_post_meta($trainer_post->ID, '_ptp_city', true);
            $specialty = get_post_meta($trainer_post->ID, '_ptp_specialty', true);
            $rating = get_post_meta($trainer_post->ID, '_ptp_avg_rating', true);

            $trainers[] = array(
                'id'        => $trainer_post->ID,
                'name'      => $trainer_post->post_title,
                'photo'     => $photo_url,
                'college'   => $college ?: '',
                'bio'       => $bio ?: $trainer_post->post_content,
                'city'      => $city ?: '',
                'specialty' => $specialty ?: '',
                'rating'    => $rating ? (float) $rating : 0,
            );
        }

        return rest_ensure_response($trainers);
    }

    /**
     * GET /ptp/v1/sessions
     *
     * Returns current user's upcoming and past sessions
     *
     * @param WP_REST_Request $request
     * @return WP_REST_Response|WP_Error
     */
    public function get_sessions($request) {
        $user_id = get_current_user_id();
        $sessions = array();

        // Check if WooCommerce is active
        if (class_exists('WooCommerce')) {
            // Get user's orders for camps/clinics
            $orders = wc_get_orders(array(
                'customer_id' => $user_id,
                'status'      => array('completed', 'processing', 'on-hold'),
                'limit'       => 50,
                'orderby'     => 'date',
                'order'       => 'DESC',
            ));

            foreach ($orders as $order) {
                foreach ($order->get_items() as $item) {
                    $product_id = $item->get_product_id();
                    $product = wc_get_product($product_id);

                    if (!$product) {
                        continue;
                    }

                    // Check if this product is a camp/clinic
                    $categories = wp_get_post_terms($product_id, 'product_cat', array('fields' => 'slugs'));
                    $is_camp = array_intersect($categories, array('summer', 'winter-clinics'));

                    if (empty($is_camp)) {
                        continue;
                    }

                    // Determine type
                    $type = in_array('winter-clinics', $categories, true) ? 'clinic' : 'camp';

                    // Get camp meta
                    $camp_date = get_post_meta($product_id, '_camp_date', true);
                    $camp_time = get_post_meta($product_id, '_camp_time', true);
                    $camp_location = get_post_meta($product_id, '_camp_location', true);

                    // Determine status based on date
                    $status = 'upcoming';
                    if ($camp_date) {
                        $camp_timestamp = strtotime($camp_date);
                        if ($camp_timestamp && $camp_timestamp < time()) {
                            $status = 'completed';
                        }
                    }

                    $sessions[] = array(
                        'id'           => $item->get_id(),
                        'type'         => $type,
                        'name'         => $product->get_name(),
                        'date'         => $camp_date ?: 'TBD',
                        'time'         => $camp_time ?: '',
                        'location'     => $camp_location ?: '',
                        'trainer_name' => null,
                        'status'       => $status,
                    );
                }
            }
        }

        // Also get private training sessions if that functionality exists
        // This can be extended when the training booking system is implemented
        $sessions = apply_filters('ptp_user_sessions', $sessions, $user_id);

        // Sort by date (upcoming first)
        usort($sessions, function($a, $b) {
            $date_a = strtotime($a['date']) ?: PHP_INT_MAX;
            $date_b = strtotime($b['date']) ?: PHP_INT_MAX;
            return $date_a - $date_b;
        });

        return rest_ensure_response($sessions);
    }

    /**
     * POST /ptp/v1/devices
     *
     * Registers a device for push notifications
     *
     * @param WP_REST_Request $request
     * @return WP_REST_Response|WP_Error
     */
    public function register_device($request) {
        global $wpdb;

        $user_id = get_current_user_id();
        $token = $request->get_param('token');
        $platform = $request->get_param('platform');

        // Validate inputs (already validated by endpoint args, but double-check)
        if (empty($token) || empty($platform)) {
            return new WP_Error(
                'invalid_params',
                __('Token and platform are required.', 'ptp-mobile-api'),
                array('status' => 400)
            );
        }

        // Sanitize
        $token = sanitize_text_field($token);
        $platform = sanitize_text_field($platform);

        // Use REPLACE to upsert (insert or update)
        // This handles the unique constraint on (user_id, token)
        $result = $wpdb->replace(
            $this->devices_table,
            array(
                'user_id'    => $user_id,
                'token'      => $token,
                'platform'   => $platform,
                'updated_at' => current_time('mysql'),
            ),
            array('%d', '%s', '%s', '%s')
        );

        if ($result === false) {
            return new WP_Error(
                'db_error',
                __('Failed to register device.', 'ptp-mobile-api'),
                array('status' => 500)
            );
        }

        // Clean up old tokens for this user (keep only last 5 devices)
        $this->cleanup_old_devices($user_id);

        return rest_ensure_response(array(
            'success' => true,
        ));
    }

    /**
     * Remove old device tokens for a user
     *
     * Keeps only the 5 most recently updated devices
     *
     * @param int $user_id
     */
    private function cleanup_old_devices($user_id) {
        global $wpdb;

        // Get IDs of devices to keep (5 most recent)
        $keep_ids = $wpdb->get_col($wpdb->prepare(
            "SELECT id FROM {$this->devices_table}
            WHERE user_id = %d
            ORDER BY updated_at DESC
            LIMIT 5",
            $user_id
        ));

        if (empty($keep_ids)) {
            return;
        }

        // Delete older devices
        $placeholders = implode(',', array_fill(0, count($keep_ids), '%d'));
        $wpdb->query($wpdb->prepare(
            "DELETE FROM {$this->devices_table}
            WHERE user_id = %d AND id NOT IN ($placeholders)",
            array_merge(array($user_id), $keep_ids)
        ));
    }

    /**
     * Get device tokens for a user
     *
     * Utility method for sending push notifications
     *
     * @param int $user_id
     * @return array
     */
    public static function get_user_devices($user_id) {
        global $wpdb;
        $table = $wpdb->prefix . 'ptp_mobile_devices';

        return $wpdb->get_results($wpdb->prepare(
            "SELECT token, platform FROM {$table} WHERE user_id = %d",
            $user_id
        ), ARRAY_A);
    }

    /**
     * Get all device tokens
     *
     * Utility method for sending broadcast notifications
     *
     * @return array
     */
    public static function get_all_devices() {
        global $wpdb;
        $table = $wpdb->prefix . 'ptp_mobile_devices';

        return $wpdb->get_results(
            "SELECT user_id, token, platform FROM {$table}",
            ARRAY_A
        );
    }
}

// Initialize the plugin
new PTP_Mobile_API();

/**
 * Plugin deactivation cleanup
 *
 * Note: We don't delete the devices table on deactivation
 * as that would lose user push notification registrations.
 * Use uninstall.php for complete cleanup.
 */
register_deactivation_hook(__FILE__, function() {
    // Nothing to do on deactivation
    // Table cleanup should be handled in uninstall.php if needed
});
