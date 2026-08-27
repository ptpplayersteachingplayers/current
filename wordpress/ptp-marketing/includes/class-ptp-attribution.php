<?php
/**
 * Campaign attribution.
 *
 * Captures UTM parameters into a first-party cookie on landing and attaches
 * them to an order when one is paid. Values are sanitised on capture and
 * escaped on output; the old templates reflected UTM strings into markup.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Attribution
{
    private const COOKIE = 'ptp_attr';
    private const PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];

    public function register(): void
    {
        add_action('template_redirect', [$this, 'capture']);
        add_action('ptp_order_paid', [$this, 'attach_to_order']);
    }

    public function capture(): void
    {
        if (is_admin() || headers_sent() || !empty($_COOKIE[self::COOKIE])) {
            return;
        }

        $captured = [];

        foreach (self::PARAMS as $param) {
            if (!empty($_GET[$param])) {
                $captured[$param] = sanitize_text_field(wp_unslash($_GET[$param]));
            }
        }

        if ($captured === []) {
            return;
        }

        setcookie(
            self::COOKIE,
            wp_json_encode($captured),
            [
                'expires'  => time() + (30 * DAY_IN_SECONDS),
                'path'     => COOKIEPATH ?: '/',
                'domain'   => COOKIE_DOMAIN,
                'secure'   => is_ssl(),
                'httponly' => true,
                'samesite' => 'Lax',
            ]
        );
    }

    public function attach_to_order(int $order_id): void
    {
        if (empty($_COOKIE[self::COOKIE])) {
            return;
        }

        $decoded = json_decode((string) wp_unslash($_COOKIE[self::COOKIE]), true);

        if (!is_array($decoded)) {
            return;
        }

        global $wpdb;

        $wpdb->insert(
            PTP_Schema::table('events'),
            [
                'event_type'   => 'order_attribution',
                'subject_type' => 'order',
                'subject_id'   => $order_id,
                'payload'      => wp_json_encode(array_map('sanitize_text_field', $decoded)),
                'created_at'   => current_time('mysql', true),
            ],
            ['%s', '%s', '%d', '%s', '%s']
        );
    }
}
