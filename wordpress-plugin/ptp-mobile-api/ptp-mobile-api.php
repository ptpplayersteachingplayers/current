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
define('PTP_MOBILE_API_VERSION', '2.0.0');

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

        // POST /ptp/v1/register - Register new user
        register_rest_route($this->namespace, '/register', array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => array($this, 'register_user'),
            'permission_callback' => '__return_true',
            'args'                => array(
                'email' => array(
                    'required'          => true,
                    'type'              => 'string',
                    'sanitize_callback' => 'sanitize_email',
                    'validate_callback' => 'is_email',
                ),
                'password' => array(
                    'required'          => true,
                    'type'              => 'string',
                    'validate_callback' => function($param) {
                        return strlen($param) >= 8;
                    },
                ),
                'first_name' => array(
                    'required'          => true,
                    'type'              => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                ),
                'last_name' => array(
                    'required'          => true,
                    'type'              => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                ),
            ),
        ));

        // POST /ptp/v1/password-reset - Request password reset email
        register_rest_route($this->namespace, '/password-reset', array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => array($this, 'request_password_reset'),
            'permission_callback' => '__return_true',
            'args'                => array(
                'email' => array(
                    'required'          => true,
                    'type'              => 'string',
                    'sanitize_callback' => 'sanitize_email',
                    'validate_callback' => 'is_email',
                ),
            ),
        ));

        // GET /ptp/v1/orders - Get user's orders
        register_rest_route($this->namespace, '/orders', array(
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => array($this, 'get_orders'),
            'permission_callback' => array($this, 'require_login'),
        ));

        // GET /ptp/v1/orders/{id} - Get single order
        register_rest_route($this->namespace, '/orders/(?P<id>\d+)', array(
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => array($this, 'get_order'),
            'permission_callback' => array($this, 'require_login'),
        ));

        // GET /ptp/v1/children - Get user's child profiles
        register_rest_route($this->namespace, '/children', array(
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => array($this, 'get_children'),
            'permission_callback' => array($this, 'require_login'),
        ));

        // POST /ptp/v1/children - Create child profile
        register_rest_route($this->namespace, '/children', array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => array($this, 'create_child'),
            'permission_callback' => array($this, 'require_login'),
        ));

        // GET /ptp/v1/children/{id} - Get single child profile
        register_rest_route($this->namespace, '/children/(?P<id>\d+)', array(
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => array($this, 'get_child'),
            'permission_callback' => array($this, 'require_login'),
        ));

        // PUT /ptp/v1/children/{id} - Update child profile
        register_rest_route($this->namespace, '/children/(?P<id>\d+)', array(
            'methods'             => 'PUT',
            'callback'            => array($this, 'update_child'),
            'permission_callback' => array($this, 'require_login'),
        ));

        // DELETE /ptp/v1/children/{id} - Delete child profile
        register_rest_route($this->namespace, '/children/(?P<id>\d+)', array(
            'methods'             => WP_REST_Server::DELETABLE,
            'callback'            => array($this, 'delete_child'),
            'permission_callback' => array($this, 'require_login'),
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

    // =========================================================================
    // User Registration
    // =========================================================================

    /**
     * POST /ptp/v1/register
     *
     * Registers a new user (creates WooCommerce customer)
     */
    public function register_user($request) {
        $email = $request->get_param('email');
        $password = $request->get_param('password');
        $first_name = $request->get_param('first_name');
        $last_name = $request->get_param('last_name');

        // Check if email already exists
        if (email_exists($email)) {
            return new WP_Error(
                'email_exists',
                __('An account with this email already exists.', 'ptp-mobile-api'),
                array('status' => 400)
            );
        }

        // Create user
        $user_data = array(
            'user_login'   => $email,
            'user_email'   => $email,
            'user_pass'    => $password,
            'first_name'   => $first_name,
            'last_name'    => $last_name,
            'display_name' => $first_name . ' ' . $last_name,
            'role'         => 'customer', // WooCommerce customer role
        );

        $user_id = wp_insert_user($user_data);

        if (is_wp_error($user_id)) {
            return new WP_Error(
                'registration_failed',
                $user_id->get_error_message(),
                array('status' => 400)
            );
        }

        // Create WooCommerce customer if WooCommerce is active
        if (class_exists('WC_Customer')) {
            $customer = new WC_Customer($user_id);
            $customer->set_billing_first_name($first_name);
            $customer->set_billing_last_name($last_name);
            $customer->set_billing_email($email);
            $customer->save();
        }

        // Send welcome email
        wp_new_user_notification($user_id, null, 'user');

        return rest_ensure_response(array(
            'id'    => $user_id,
            'email' => $email,
            'name'  => $first_name . ' ' . $last_name,
        ));
    }

    /**
     * POST /ptp/v1/password-reset
     *
     * Sends password reset email
     */
    public function request_password_reset($request) {
        $email = $request->get_param('email');
        $user = get_user_by('email', $email);

        if (!$user) {
            // Don't reveal if email exists for security
            return rest_ensure_response(array('success' => true));
        }

        // Generate reset key and send email
        $reset_key = get_password_reset_key($user);

        if (is_wp_error($reset_key)) {
            return new WP_Error(
                'reset_failed',
                __('Unable to process password reset.', 'ptp-mobile-api'),
                array('status' => 500)
            );
        }

        // Send the email
        $reset_url = network_site_url("wp-login.php?action=rp&key=$reset_key&login=" . rawurlencode($user->user_login), 'login');

        $message = sprintf(__('Someone has requested a password reset for your PTP Soccer account.

If this was you, click the link below to reset your password:
%s

If you didn\'t request this, you can safely ignore this email.

Thanks,
Players Teaching Players', 'ptp-mobile-api'), $reset_url);

        $sent = wp_mail(
            $email,
            __('[PTP Soccer] Password Reset Request', 'ptp-mobile-api'),
            $message
        );

        return rest_ensure_response(array('success' => true));
    }

    // =========================================================================
    // Orders
    // =========================================================================

    /**
     * GET /ptp/v1/orders
     *
     * Returns user's WooCommerce orders
     */
    public function get_orders($request) {
        if (!class_exists('WooCommerce')) {
            return new WP_Error(
                'woocommerce_not_active',
                __('WooCommerce is required.', 'ptp-mobile-api'),
                array('status' => 500)
            );
        }

        $user_id = get_current_user_id();

        $orders = wc_get_orders(array(
            'customer_id' => $user_id,
            'limit'       => 50,
            'orderby'     => 'date',
            'order'       => 'DESC',
        ));

        $result = array();
        foreach ($orders as $order) {
            $result[] = $this->format_order($order);
        }

        return rest_ensure_response($result);
    }

    /**
     * GET /ptp/v1/orders/{id}
     *
     * Returns single order
     */
    public function get_order($request) {
        if (!class_exists('WooCommerce')) {
            return new WP_Error(
                'woocommerce_not_active',
                __('WooCommerce is required.', 'ptp-mobile-api'),
                array('status' => 500)
            );
        }

        $order_id = absint($request->get_param('id'));
        $order = wc_get_order($order_id);

        if (!$order) {
            return new WP_Error(
                'order_not_found',
                __('Order not found.', 'ptp-mobile-api'),
                array('status' => 404)
            );
        }

        // Verify ownership
        if ($order->get_customer_id() !== get_current_user_id()) {
            return new WP_Error(
                'forbidden',
                __('You cannot view this order.', 'ptp-mobile-api'),
                array('status' => 403)
            );
        }

        return rest_ensure_response($this->format_order($order));
    }

    /**
     * Format WooCommerce order for API response
     */
    private function format_order($order) {
        $line_items = array();
        foreach ($order->get_items() as $item) {
            $product_id = $item->get_product_id();

            // Get camp/event meta
            $child_name = $item->get_meta('_child_name');
            $event_date = get_post_meta($product_id, '_camp_date', true);
            $event_time = get_post_meta($product_id, '_camp_time', true);
            $event_location = get_post_meta($product_id, '_camp_location', true);

            $line_items[] = array(
                'id'             => $item->get_id(),
                'name'           => $item->get_name(),
                'product_id'     => $product_id,
                'quantity'       => $item->get_quantity(),
                'subtotal'       => wc_price($item->get_subtotal()),
                'total'          => wc_price($item->get_total()),
                'child_name'     => $child_name ?: null,
                'event_date'     => $event_date ?: null,
                'event_time'     => $event_time ?: null,
                'event_location' => $event_location ?: null,
            );
        }

        return array(
            'id'           => $order->get_id(),
            'order_number' => $order->get_order_number(),
            'status'       => $order->get_status(),
            'total'        => $order->get_formatted_order_total(),
            'currency'     => $order->get_currency(),
            'date_created' => $order->get_date_created()->format('c'),
            'date_paid'    => $order->get_date_paid() ? $order->get_date_paid()->format('c') : null,
            'line_items'   => $line_items,
            'billing'      => array(
                'first_name' => $order->get_billing_first_name(),
                'last_name'  => $order->get_billing_last_name(),
                'email'      => $order->get_billing_email(),
                'phone'      => $order->get_billing_phone(),
            ),
        );
    }

    // =========================================================================
    // Child Profiles
    // =========================================================================

    /**
     * GET /ptp/v1/children
     *
     * Returns all child profiles for current user
     */
    public function get_children($request) {
        $user_id = get_current_user_id();
        $children = get_user_meta($user_id, '_ptp_children', true);

        if (!is_array($children)) {
            $children = array();
        }

        // Add computed age to each child
        foreach ($children as &$child) {
            if (!empty($child['birth_date'])) {
                $child['age'] = $this->calculate_age($child['birth_date']);
            }
        }

        return rest_ensure_response(array_values($children));
    }

    /**
     * GET /ptp/v1/children/{id}
     *
     * Returns single child profile
     */
    public function get_child($request) {
        $child_id = absint($request->get_param('id'));
        $user_id = get_current_user_id();
        $children = get_user_meta($user_id, '_ptp_children', true);

        if (!is_array($children) || !isset($children[$child_id])) {
            return new WP_Error(
                'child_not_found',
                __('Child profile not found.', 'ptp-mobile-api'),
                array('status' => 404)
            );
        }

        $child = $children[$child_id];
        if (!empty($child['birth_date'])) {
            $child['age'] = $this->calculate_age($child['birth_date']);
        }

        return rest_ensure_response($child);
    }

    /**
     * POST /ptp/v1/children
     *
     * Creates a new child profile
     */
    public function create_child($request) {
        $user_id = get_current_user_id();
        $children = get_user_meta($user_id, '_ptp_children', true);

        if (!is_array($children)) {
            $children = array();
        }

        // Generate new ID
        $max_id = 0;
        foreach ($children as $child) {
            if (isset($child['id']) && $child['id'] > $max_id) {
                $max_id = $child['id'];
            }
        }
        $new_id = $max_id + 1;

        $child = array(
            'id'               => $new_id,
            'parent_id'        => $user_id,
            'name'             => sanitize_text_field($request->get_param('name')),
            'birth_date'       => sanitize_text_field($request->get_param('birth_date')),
            'gender'           => sanitize_text_field($request->get_param('gender')),
            'experience_level' => sanitize_text_field($request->get_param('experience_level')),
            'team'             => sanitize_text_field($request->get_param('team')),
            'position'         => sanitize_text_field($request->get_param('position')),
            'tshirt_size'      => sanitize_text_field($request->get_param('tshirt_size')),
            'notes'            => sanitize_textarea_field($request->get_param('notes')),
            'medical_notes'    => sanitize_textarea_field($request->get_param('medical_notes')),
            'created_at'       => current_time('c'),
            'updated_at'       => current_time('c'),
        );

        $children[$new_id] = $child;
        update_user_meta($user_id, '_ptp_children', $children);

        if (!empty($child['birth_date'])) {
            $child['age'] = $this->calculate_age($child['birth_date']);
        }

        return rest_ensure_response($child);
    }

    /**
     * PUT /ptp/v1/children/{id}
     *
     * Updates a child profile
     */
    public function update_child($request) {
        $child_id = absint($request->get_param('id'));
        $user_id = get_current_user_id();
        $children = get_user_meta($user_id, '_ptp_children', true);

        if (!is_array($children) || !isset($children[$child_id])) {
            return new WP_Error(
                'child_not_found',
                __('Child profile not found.', 'ptp-mobile-api'),
                array('status' => 404)
            );
        }

        $child = $children[$child_id];

        // Update fields if provided
        $fields = array('name', 'birth_date', 'gender', 'experience_level', 'team', 'position', 'tshirt_size', 'notes', 'medical_notes');
        foreach ($fields as $field) {
            $value = $request->get_param($field);
            if ($value !== null) {
                $child[$field] = $field === 'notes' || $field === 'medical_notes'
                    ? sanitize_textarea_field($value)
                    : sanitize_text_field($value);
            }
        }

        $child['updated_at'] = current_time('c');
        $children[$child_id] = $child;
        update_user_meta($user_id, '_ptp_children', $children);

        if (!empty($child['birth_date'])) {
            $child['age'] = $this->calculate_age($child['birth_date']);
        }

        return rest_ensure_response($child);
    }

    /**
     * DELETE /ptp/v1/children/{id}
     *
     * Deletes a child profile
     */
    public function delete_child($request) {
        $child_id = absint($request->get_param('id'));
        $user_id = get_current_user_id();
        $children = get_user_meta($user_id, '_ptp_children', true);

        if (!is_array($children) || !isset($children[$child_id])) {
            return new WP_Error(
                'child_not_found',
                __('Child profile not found.', 'ptp-mobile-api'),
                array('status' => 404)
            );
        }

        unset($children[$child_id]);
        update_user_meta($user_id, '_ptp_children', $children);

        return rest_ensure_response(array('deleted' => true));
    }

    /**
     * Calculate age from birth date
     */
    private function calculate_age($birth_date) {
        try {
            $birth = new DateTime($birth_date);
            $today = new DateTime();
            $age = $today->diff($birth)->y;
            return $age;
        } catch (Exception $e) {
            return null;
        }
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
