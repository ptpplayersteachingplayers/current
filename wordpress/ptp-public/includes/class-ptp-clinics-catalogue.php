<?php
/**
 * Group clinic catalogue reads and price resolver.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Clinics_Catalogue
{
    public const POST_TYPE = 'ptp_clinic';

    public static function register_price_resolver(): void
    {
        add_filter('ptp_price_resolver_clinic', static function () {
            return static function (int $clinic_id): ?array {
                $clinic = get_post($clinic_id);

                if ($clinic === null || $clinic->post_type !== self::POST_TYPE || $clinic->post_status !== 'publish') {
                    return null;
                }

                return [
                    'label'      => get_the_title($clinic),
                    'unit_cents' => (int) get_post_meta($clinic_id, '_ptp_price_cents', true),
                ];
            };
        });
    }

    /** @return array<int, WP_Post> */
    public static function upcoming(int $limit = 20): array
    {
        return get_posts([
            'post_type'      => self::POST_TYPE,
            'posts_per_page' => $limit,
            'meta_key'       => '_ptp_starts_at',
            'orderby'        => 'meta_value',
            'order'          => 'ASC',
            'meta_query'     => [[
                'key'     => '_ptp_starts_at',
                'value'   => current_time('Y-m-d'),
                'compare' => '>=',
                'type'    => 'DATE',
            ]],
        ]);
    }
}
