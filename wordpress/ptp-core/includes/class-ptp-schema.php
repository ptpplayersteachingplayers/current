<?php
/**
 * The consolidated database schema.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * The previous platform declared 74 CREATE TABLE statements across 119 distinct
 * table names, and — the root cause of most of its bugs — seventeen of those
 * tables were written by two different plugins that did not know about each
 * other, including ptp_camp_orders, ptp_bookings, ptp_parents and ptp_trainers.
 * That is why the codebase accumulated files named customer-unifier,
 * order-totals-repair, invoice-verifier and hardcoded-backfill: they were
 * reconciling two systems fighting over the same rows.
 *
 * Core owns every table. Feature plugins read and write through repositories
 * and never issue their own CREATE TABLE. One order table, one booking table,
 * one customer identity.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Schema
{
    /** Bump to trigger dbDelta on the next request after deploy. */
    public const VERSION = '1.3.0';

    private const OPTION_VERSION = 'ptp_schema_version';

    public static function install(): void
    {
        self::run_delta();
        update_option(self::OPTION_VERSION, self::VERSION, false);
    }

    public static function maybe_upgrade(): void
    {
        if (get_option(self::OPTION_VERSION) === self::VERSION) {
            return;
        }

        self::install();
    }

    public static function table(string $name): string
    {
        global $wpdb;

        return $wpdb->prefix . 'ptp_' . $name;
    }

    /**
     * Atomically claim a one-time key.
     *
     * Backs webhook idempotency and discount redemption. Relies on the unique
     * index rejecting the second insert, rather than a get-then-set on a
     * transient — the audit found a non-atomic dedup that could double-count a
     * discount redemption under concurrent webhook retries.
     */
    public static function claim_idempotency_key(string $key): bool
    {
        global $wpdb;

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- intentional unique-index race guard
        $inserted = $wpdb->query(
            $wpdb->prepare(
                'INSERT IGNORE INTO ' . self::table('idempotency') . ' (claim_key, claimed_at) VALUES (%s, %s)',
                $key,
                current_time('mysql', true)
            )
        );

        return (int) $inserted === 1;
    }

    private static function run_delta(): void
    {
        global $wpdb;

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        $charset = $wpdb->get_charset_collate();

        foreach (self::definitions($charset) as $sql) {
            dbDelta($sql);
        }
    }

    /** @return array<int, string> */
    private static function definitions(string $charset): array
    {
        $parents   = self::table('parents');
        $players   = self::table('players');
        $trainers  = self::table('trainers');
        $orders    = self::table('orders');
        $items     = self::table('order_items');
        $bookings  = self::table('bookings');
        $discounts = self::table('discounts');
        $redeems   = self::table('discount_redemptions');
        $idem      = self::table('idempotency');
        $events    = self::table('events');
        $avail     = self::table('availability');
        $avex      = self::table('availability_exceptions');
        $payouts   = self::table('payouts');

        return [
            // Customer identity. One row per household, linked to a WP user.
            "CREATE TABLE {$parents} (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                user_id BIGINT UNSIGNED NOT NULL,
                first_name VARCHAR(100) NOT NULL DEFAULT '',
                last_name VARCHAR(100) NOT NULL DEFAULT '',
                email VARCHAR(190) NOT NULL,
                phone VARCHAR(32) NOT NULL DEFAULT '',
                stripe_customer_id VARCHAR(64) NOT NULL DEFAULT '',
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY user_id (user_id),
                UNIQUE KEY email (email)
            ) {$charset};",

            // Children. parent_id is the ownership boundary the Guard enforces.
            "CREATE TABLE {$players} (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                parent_id BIGINT UNSIGNED NOT NULL,
                first_name VARCHAR(100) NOT NULL DEFAULT '',
                last_name VARCHAR(100) NOT NULL DEFAULT '',
                birth_date DATE DEFAULT NULL,
                position VARCHAR(50) NOT NULL DEFAULT '',
                notes TEXT,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                PRIMARY KEY (id),
                KEY parent_id (parent_id)
            ) {$charset};",

            "CREATE TABLE {$trainers} (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                user_id BIGINT UNSIGNED NOT NULL,
                slug VARCHAR(190) NOT NULL,
                display_name VARCHAR(150) NOT NULL DEFAULT '',
                bio LONGTEXT,
                hourly_cents INT UNSIGNED NOT NULL DEFAULT 0,
                /**
                 * What THIS trainer is paid, set per trainer by staff — not a
                 * percentage of what the parent paid. hourly_cents is what the
                 * customer is charged; payout_cents is what the trainer earns.
                 * The platform keeps the difference.
                 *
                 * payout_basis decides how payout_cents is read:
                 *   'session' — a flat amount for the session, whatever its length
                 *   'hour'    — a rate, pro-rated to the session length
                 */
                payout_cents INT UNSIGNED NOT NULL DEFAULT 0,
                payout_basis VARCHAR(10) NOT NULL DEFAULT 'session',
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                stripe_account_id VARCHAR(64) NOT NULL DEFAULT '',
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY user_id (user_id),
                UNIQUE KEY slug (slug),
                KEY status (status)
            ) {$charset};",

            /**
             * One order table for camps, training and clinics alike. The old
             * split between ptp_camp_orders and ptp_unified_camp_orders is what
             * made revenue reporting unreliable.
             *
             * quote_id ties the order to the priced quote so the Stripe webhook
             * can reconcile the amount received against the amount quoted.
             */
            "CREATE TABLE {$orders} (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                parent_id BIGINT UNSIGNED NOT NULL,
                quote_id CHAR(36) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                subtotal_cents INT UNSIGNED NOT NULL DEFAULT 0,
                discount_cents INT UNSIGNED NOT NULL DEFAULT 0,
                total_cents INT UNSIGNED NOT NULL DEFAULT 0,
                paid_cents INT UNSIGNED NOT NULL DEFAULT 0,
                discount_code VARCHAR(64) NOT NULL DEFAULT '',
                stripe_payment_intent_id VARCHAR(64) NOT NULL DEFAULT '',
                /**
                 * Refunds are cumulative: a session cancelled from a two-session
                 * order refunds part of it, and a later cancellation adds to
                 * this rather than replacing it.
                 */
                refunded_cents INT UNSIGNED NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL,
                paid_at DATETIME DEFAULT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY quote_id (quote_id),
                KEY parent_id (parent_id),
                KEY status (status),
                KEY stripe_payment_intent_id (stripe_payment_intent_id)
            ) {$charset};",

            "CREATE TABLE {$items} (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                order_id BIGINT UNSIGNED NOT NULL,
                item_type VARCHAR(30) NOT NULL,
                item_id BIGINT UNSIGNED NOT NULL,
                player_id BIGINT UNSIGNED DEFAULT NULL,
                label VARCHAR(190) NOT NULL DEFAULT '',
                qty SMALLINT UNSIGNED NOT NULL DEFAULT 1,
                unit_cents INT UNSIGNED NOT NULL DEFAULT 0,
                amount_cents INT UNSIGNED NOT NULL DEFAULT 0,
                PRIMARY KEY (id),
                KEY order_id (order_id),
                KEY item_lookup (item_type, item_id)
            ) {$charset};",

            // Sessions across every product line.
            "CREATE TABLE {$bookings} (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                order_id BIGINT UNSIGNED DEFAULT NULL,
                parent_id BIGINT UNSIGNED NOT NULL,
                player_id BIGINT UNSIGNED DEFAULT NULL,
                trainer_id BIGINT UNSIGNED DEFAULT NULL,
                booking_type VARCHAR(30) NOT NULL DEFAULT 'training',
                starts_at DATETIME NOT NULL,
                ends_at DATETIME DEFAULT NULL,
                location VARCHAR(190) NOT NULL DEFAULT '',
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                PRIMARY KEY (id),
                KEY parent_id (parent_id),
                KEY trainer_id (trainer_id),
                KEY starts_at (starts_at),
                KEY status (status)
            ) {$charset};",

            "CREATE TABLE {$discounts} (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                code VARCHAR(64) NOT NULL,
                label VARCHAR(190) NOT NULL DEFAULT '',
                kind VARCHAR(20) NOT NULL DEFAULT 'fixed',
                value INT UNSIGNED NOT NULL DEFAULT 0,
                min_subtotal_cents INT UNSIGNED NOT NULL DEFAULT 0,
                usage_limit INT UNSIGNED NOT NULL DEFAULT 0,
                usage_count INT UNSIGNED NOT NULL DEFAULT 0,
                starts_at DATETIME DEFAULT NULL,
                ends_at DATETIME DEFAULT NULL,
                active TINYINT(1) NOT NULL DEFAULT 1,
                PRIMARY KEY (id),
                UNIQUE KEY code (code)
            ) {$charset};",

            /**
             * Redemptions are rows, not a counter increment. The unique index on
             * (discount_id, order_id) makes double-counting impossible even
             * under concurrent webhook retries.
             */
            "CREATE TABLE {$redeems} (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                discount_id BIGINT UNSIGNED NOT NULL,
                order_id BIGINT UNSIGNED NOT NULL,
                redeemed_at DATETIME NOT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY discount_order (discount_id, order_id)
            ) {$charset};",

            "CREATE TABLE {$idem} (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                claim_key VARCHAR(190) NOT NULL,
                claimed_at DATETIME NOT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY claim_key (claim_key)
            ) {$charset};",

            /**
             * Recurring weekly availability. One row per trainer per weekday
             * block, e.g. "Tuesdays 16:00-20:00 at Riverside Park".
             *
             * Times are stored as local wall-clock strings, not UTC: a trainer
             * who says "I coach Tuesday evenings" means 4pm local, and that
             * should not shift by an hour when the clocks change.
             */
            "CREATE TABLE {$avail} (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                trainer_id BIGINT UNSIGNED NOT NULL,
                weekday TINYINT UNSIGNED NOT NULL,
                starts_time TIME NOT NULL,
                ends_time TIME NOT NULL,
                location VARCHAR(190) NOT NULL DEFAULT '',
                slot_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 60,
                active TINYINT(1) NOT NULL DEFAULT 1,
                created_at DATETIME NOT NULL,
                PRIMARY KEY (id),
                KEY trainer_weekday (trainer_id, weekday)
            ) {$charset};",

            /**
             * One-off overrides: a holiday closing a normally-open day, or an
             * extra Saturday opened for a tournament week.
             */
            "CREATE TABLE {$avex} (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                trainer_id BIGINT UNSIGNED NOT NULL,
                on_date DATE NOT NULL,
                kind VARCHAR(10) NOT NULL DEFAULT 'block',
                starts_time TIME DEFAULT NULL,
                ends_time TIME DEFAULT NULL,
                location VARCHAR(190) NOT NULL DEFAULT '',
                note VARCHAR(190) NOT NULL DEFAULT '',
                created_at DATETIME NOT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY trainer_date_kind (trainer_id, on_date, kind, starts_time)
            ) {$charset};",

            /**
             * Trainer earnings ledger. One row per booking that owes a trainer
             * money, settled when the session completes.
             */
            "CREATE TABLE {$payouts} (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                trainer_id BIGINT UNSIGNED NOT NULL,
                booking_id BIGINT UNSIGNED NOT NULL,
                gross_cents INT UNSIGNED NOT NULL DEFAULT 0,
                platform_fee_cents INT UNSIGNED NOT NULL DEFAULT 0,
                net_cents INT UNSIGNED NOT NULL DEFAULT 0,
                minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                stripe_transfer_id VARCHAR(64) NOT NULL DEFAULT '',
                cancelled_reason VARCHAR(190) NOT NULL DEFAULT '',
                available_at DATETIME DEFAULT NULL,
                paid_at DATETIME DEFAULT NULL,
                created_at DATETIME NOT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY booking_id (booking_id),
                KEY trainer_status (trainer_id, status)
            ) {$charset};",

            // Append-only audit trail. Replaces the ad-hoc ptp_log writes.
            "CREATE TABLE {$events} (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                event_type VARCHAR(60) NOT NULL,
                subject_type VARCHAR(30) NOT NULL DEFAULT '',
                subject_id BIGINT UNSIGNED DEFAULT NULL,
                actor_user_id BIGINT UNSIGNED DEFAULT NULL,
                payload LONGTEXT,
                created_at DATETIME NOT NULL,
                PRIMARY KEY (id),
                KEY event_type (event_type),
                KEY subject (subject_type, subject_id),
                KEY created_at (created_at)
            ) {$charset};",
        ];
    }
}
