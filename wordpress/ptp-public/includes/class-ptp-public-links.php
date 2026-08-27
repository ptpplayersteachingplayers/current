<?php
/**
 * Page URL resolution.
 *
 * Page ids are stored as options and set once in the admin settings screen, so
 * templates never hardcode a slug. Falls back to home_url() when unconfigured
 * rather than emitting a broken link.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Public_Links
{
    public static function checkout(): string
    {
        return self::page('ptp_page_checkout');
    }

    public static function cart(): string
    {
        return self::page('ptp_page_cart');
    }

    public static function camps(): string
    {
        return self::page('ptp_page_camps');
    }

    public static function book(): string
    {
        return self::page('ptp_page_book');
    }

    public static function dashboard(): string
    {
        return self::page('ptp_page_dashboard');
    }

    public static function login(): string
    {
        return self::page('ptp_page_login');
    }

    public static function register(): string
    {
        return self::page('ptp_page_register');
    }

    public static function thank_you(int $order_id): string
    {
        return add_query_arg('order', $order_id, self::page('ptp_page_thank_you'));
    }

    private static function page(string $option): string
    {
        $page_id = (int) get_option($option, 0);

        if ($page_id > 0) {
            $url = get_permalink($page_id);

            if (is_string($url) && $url !== '') {
                return $url;
            }
        }

        return home_url('/');
    }
}
