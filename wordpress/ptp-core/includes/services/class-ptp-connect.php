<?php
/**
 * Stripe Connect — how money reaches trainers.
 *
 * ---------------------------------------------------------------------------
 * THE MONEY MAP
 * ---------------------------------------------------------------------------
 * A training session involves three parties and one charge:
 *
 *   parent pays  ──►  PTP platform account  ──►  trainer connected account
 *                     (keeps platform fee)       (receives net, on completion)
 *
 * The charge is taken on the PTP account, not the trainer's. That is deliberate:
 *
 *   - PTP owns the customer relationship and the refund decision.
 *   - Money is held until the session is delivered, so a no-show or a
 *     cancellation is a refund rather than a clawback from a trainer who has
 *     already been paid.
 *   - One Stripe account reconciles all revenue — camps, clinics and training
 *     together — which the old split across separate integrations never did.
 *
 * Payouts are therefore *transfers*, made after `ptp_booking_completed`, not
 * `ptp_order_paid`. The ledger row is written at payment time so a trainer can
 * see what they have earned and when it clears, but the transfer only moves
 * once the work is done.
 *
 * Trainer onboarding uses Stripe's hosted flow. PTP never sees or stores a
 * trainer's bank details — only the `acct_…` id.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Connect
{
    /** Platform's share of a training session, in basis points (2500 = 25%). */
    private const DEFAULT_FEE_BPS = 2500;

    /** Funds clear this long after a session, leaving room for disputes. */
    private const CLEARANCE_DAYS = 7;

    public function register_hooks(): void
    {
        // Priority 20: after PTP_Bookings_Repository has realised the booking
        // at priority 10, so the rows this reads already exist.
        add_action('ptp_order_paid', [$this, 'record_trainer_earnings'], 20, 1);
        add_action('ptp_booking_completed', [$this, 'release_payout'], 10, 1);
    }

    /**
     * The platform's cut, as a proportion in basis points.
     *
     * Filterable so a trainer-specific or promotional rate can be applied
     * without touching this class.
     */
    public function fee_bps(int $trainer_id): int
    {
        $bps = (int) apply_filters(
            'ptp_platform_fee_bps',
            (int) get_option('ptp_platform_fee_bps', self::DEFAULT_FEE_BPS),
            $trainer_id
        );

        // A fee outside 0-100% is a configuration error, not a business rule.
        return max(0, min(10000, $bps));
    }

    /**
     * Split a gross amount into platform fee and trainer net.
     *
     * @return array{gross_cents: int, fee_cents: int, net_cents: int}
     */
    public function split(int $gross_cents, int $trainer_id): array
    {
        $gross = max(0, $gross_cents);
        $fee   = (int) round($gross * $this->fee_bps($trainer_id) / 10000);

        return [
            'gross_cents' => $gross,
            'fee_cents'   => $fee,
            'net_cents'   => $gross - $fee,
        ];
    }

    /**
     * Write ledger rows for every training line on a paid order.
     *
     * Runs on ptp_order_paid so the trainer sees pending earnings immediately,
     * but the row is 'pending' — no money moves until the session happens.
     */
    public function record_trainer_earnings(int $order_id): void
    {
        global $wpdb;

        $bookings = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM ' . PTP_Schema::table('bookings')
                . ' WHERE order_id = %d AND trainer_id IS NOT NULL AND trainer_id > 0',
                $order_id
            )
        ) ?: [];

        foreach ($bookings as $booking) {
            $gross = $this->gross_for_booking($order_id, (int) $booking->id);

            if ($gross <= 0) {
                continue;
            }

            $split = $this->split($gross, (int) $booking->trainer_id);

            // Unique index on booking_id makes a repeated webhook harmless.
            $wpdb->query(
                $wpdb->prepare(
                    'INSERT IGNORE INTO ' . PTP_Schema::table('payouts')
                    . ' (trainer_id, booking_id, gross_cents, platform_fee_cents, net_cents, status, available_at, created_at)'
                    . ' VALUES (%d, %d, %d, %d, %d, %s, %s, %s)',
                    (int) $booking->trainer_id,
                    (int) $booking->id,
                    $split['gross_cents'],
                    $split['fee_cents'],
                    $split['net_cents'],
                    'pending',
                    $this->clearance_date((string) $booking->starts_at),
                    current_time('mysql', true)
                )
            );
        }
    }

    /**
     * Move money to the trainer once a session is delivered.
     *
     * Skips silently when the trainer has not finished Stripe onboarding — the
     * ledger row stays pending and shows on their dashboard as "connect your
     * account to get paid", which is more useful than a failed transfer.
     */
    public function release_payout(int $booking_id): void
    {
        global $wpdb;

        $payout = $wpdb->get_row(
            $wpdb->prepare(
                'SELECT * FROM ' . PTP_Schema::table('payouts') . ' WHERE booking_id = %d AND status = %s',
                $booking_id,
                'pending'
            )
        );

        if ($payout === null) {
            return;
        }

        $account = $this->account_id((int) $payout->trainer_id);

        if ($account === '') {
            return;
        }

        try {
            $transfer = ptp_core()->stripe()->create_transfer(
                (int) $payout->net_cents,
                $account,
                ['ptp_booking_id' => (string) $booking_id]
            );
        } catch (PTP_Stripe_Exception $e) {
            do_action('ptp_payout_failed', $booking_id, $e->getMessage());

            return;
        }

        $wpdb->update(
            PTP_Schema::table('payouts'),
            [
                'status'             => 'paid',
                'stripe_transfer_id' => (string) ($transfer['id'] ?? ''),
                'paid_at'            => current_time('mysql', true),
            ],
            ['id' => (int) $payout->id],
            ['%s', '%s', '%s'],
            ['%d']
        );

        do_action('ptp_payout_paid', $booking_id, (int) $payout->net_cents);
    }

    /**
     * Start or resume Stripe's hosted onboarding for a trainer.
     *
     * Returns a single-use URL. The account id is stored on first call so a
     * trainer who abandons onboarding resumes rather than starting over.
     */
    public function onboarding_url(PTP_Actor $actor, string $return_url): string
    {
        if (!$actor->is(PTP_Guard::ROLE_TRAINER) || $actor->id() === null) {
            throw new PTP_Repository_Exception(__('Only a trainer can connect a payout account.', 'ptp'));
        }

        $trainer_id = (int) $actor->id();
        $account    = $this->account_id($trainer_id);

        if ($account === '') {
            $created = ptp_core()->stripe()->create_connected_account([
                'ptp_trainer_id' => (string) $trainer_id,
            ]);

            $account = (string) ($created['id'] ?? '');

            if ($account === '') {
                throw new PTP_Stripe_Exception(__('Could not start payout setup. Please try again.', 'ptp'));
            }

            $this->store_account_id($trainer_id, $account);
        }

        $link = ptp_core()->stripe()->create_account_link($account, $return_url);

        return (string) ($link['url'] ?? $return_url);
    }

    /**
     * Earnings summary for a trainer's dashboard.
     *
     * @return array{pending_cents: int, clearing_cents: int, paid_cents: int, connected: bool}
     */
    public function earnings_for(PTP_Actor $actor): array
    {
        global $wpdb;

        $empty = ['pending_cents' => 0, 'clearing_cents' => 0, 'paid_cents' => 0, 'connected' => false];

        if (!$actor->is(PTP_Guard::ROLE_TRAINER) || $actor->id() === null) {
            return $empty;
        }

        $trainer_id = (int) $actor->id();
        $table      = PTP_Schema::table('payouts');
        $now        = current_time('mysql', true);

        $sum = static function (string $sql, ...$args) use ($wpdb): int {
            return (int) $wpdb->get_var($wpdb->prepare($sql, ...$args));
        };

        return [
            // Earned, session not yet delivered or still inside clearance.
            'pending_cents'  => $sum(
                "SELECT COALESCE(SUM(net_cents),0) FROM {$table} WHERE trainer_id = %d AND status = %s AND available_at > %s",
                $trainer_id, 'pending', $now
            ),
            // Cleared and awaiting the next transfer.
            'clearing_cents' => $sum(
                "SELECT COALESCE(SUM(net_cents),0) FROM {$table} WHERE trainer_id = %d AND status = %s AND available_at <= %s",
                $trainer_id, 'pending', $now
            ),
            'paid_cents'     => $sum(
                "SELECT COALESCE(SUM(net_cents),0) FROM {$table} WHERE trainer_id = %d AND status = %s",
                $trainer_id, 'paid'
            ),
            'connected'      => $this->account_id($trainer_id) !== '',
        ];
    }

    // -- internals ------------------------------------------------------------

    /** What the parent actually paid for this booking's line. */
    private function gross_for_booking(int $order_id, int $booking_id): int
    {
        global $wpdb;

        return (int) $wpdb->get_var(
            $wpdb->prepare(
                'SELECT COALESCE(SUM(amount_cents), 0) FROM ' . PTP_Schema::table('order_items')
                . ' WHERE order_id = %d AND item_type = %s',
                $order_id,
                'training'
            )
        );
    }

    private function clearance_date(string $session_start): string
    {
        try {
            return (new DateTimeImmutable($session_start))
                ->modify('+' . self::CLEARANCE_DAYS . ' days')
                ->format('Y-m-d H:i:s');
        } catch (Exception $e) {
            return (new DateTimeImmutable('+' . self::CLEARANCE_DAYS . ' days'))->format('Y-m-d H:i:s');
        }
    }

    private function account_id(int $trainer_id): string
    {
        global $wpdb;

        return (string) $wpdb->get_var(
            $wpdb->prepare(
                'SELECT stripe_account_id FROM ' . PTP_Schema::table('trainers') . ' WHERE id = %d',
                $trainer_id
            )
        );
    }

    private function store_account_id(int $trainer_id, string $account_id): void
    {
        global $wpdb;

        $wpdb->update(
            PTP_Schema::table('trainers'),
            ['stripe_account_id' => $account_id, 'updated_at' => current_time('mysql', true)],
            ['id' => $trainer_id],
            ['%s', '%s'],
            ['%d']
        );
    }
}
