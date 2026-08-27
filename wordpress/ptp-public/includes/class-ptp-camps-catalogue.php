<?php
/**
 * Camp catalogue reads.
 *
 * Camps are a WordPress custom post type, so the catalogue is a thin query
 * layer rather than a repository. The price resolver registered here is what
 * PTP_Pricing calls to price a camp line — it reads post meta, which is why a
 * client-supplied camp price can never reach Stripe.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Camps_Catalogue
{
    public const POST_TYPE = 'ptp_camp';

    public static function register_price_resolver(): void
    {
        add_filter('ptp_price_resolver_camp', static function () {
            return static function (int $camp_id): ?array {
                $camp = get_post($camp_id);

                if ($camp === null || $camp->post_type !== self::POST_TYPE || $camp->post_status !== 'publish') {
                    return null;
                }

                return [
                    'label'      => get_the_title($camp),
                    'unit_cents' => (int) get_post_meta($camp_id, '_ptp_price_cents', true),
                ];
            };
        });
    }

    /** @return array<int, WP_Post> */
    public static function upcoming(int $limit = 24, string $location = ''): array
    {
        $meta = [
            [
                'key'     => '_ptp_starts_at',
                'value'   => current_time('Y-m-d'),
                'compare' => '>=',
                'type'    => 'DATE',
            ],
        ];

        if ($location !== '') {
            $meta[] = ['key' => '_ptp_location', 'value' => $location, 'compare' => '='];
        }

        return get_posts([
            'post_type'      => self::POST_TYPE,
            'posts_per_page' => $limit,
            'meta_query'     => $meta,
            'meta_key'       => '_ptp_starts_at',
            'orderby'        => 'meta_value',
            'order'          => 'ASC',
        ]);
    }

    public static function find(int $camp_id): ?WP_Post
    {
        $camp = get_post($camp_id);

        return ($camp && $camp->post_type === self::POST_TYPE && $camp->post_status === 'publish') ? $camp : null;
    }

    public static function price_cents(int $camp_id): int
    {
        return (int) get_post_meta($camp_id, '_ptp_price_cents', true);
    }

    /** Capacity minus paid seats. Negative results are clamped to zero. */
    public static function seats_remaining(int $camp_id): int
    {
        global $wpdb;

        $capacity = (int) get_post_meta($camp_id, '_ptp_capacity', true);

        $sold = (int) $wpdb->get_var(
            $wpdb->prepare(
                'SELECT COALESCE(SUM(i.qty), 0) FROM ' . PTP_Schema::table('order_items') . ' i'
                . ' INNER JOIN ' . PTP_Schema::table('orders') . ' o ON o.id = i.order_id'
                . ' WHERE i.item_type = %s AND i.item_id = %d AND o.status = %s',
                'camp',
                $camp_id,
                'paid'
            )
        );

        return max(0, $capacity - $sold);
    }
}
