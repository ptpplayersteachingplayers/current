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
 *                     (keeps the remainder)      (receives their set amount)
 *
 * Trainers are paid a FIXED AMOUNT set per trainer — not a percentage of what
 * the parent paid. Staff assign each trainer's rate on the Trainers screen.
 *
 *   parent price   trainers.hourly_cents  (what the customer is charged)
 *   trainer pay    trainers.payout_cents  (what this trainer earns)
 *   platform keeps the difference
 *
 * The two are independent on purpose. Raising a trainer's rate does not raise
 * what parents pay, and a promotional price does not silently cut the
 * trainer's pay. Either can change without touching the other.
 *
 * payout_basis decides how payout_cents is read:
 *   'session'  a flat amount for the session, whatever its length (default)
 *   'hour'     a rate, pro-rated to the session length
 *
 * The charge is taken on the PTP account, not the trainer's:
 *
 *   - PTP owns the customer relationship and the refund decision.
 *   - Money is held until the session is delivered, so a no-show is a refund
 *     rather than a clawback from a trainer already paid.
 *   - One Stripe account reconciles camps, clinics and training together.
 *
 * Payouts are therefore *transfers* made after `ptp_booking_completed`, not
 * `ptp_order_paid`. The ledger row is written at payment time so a trainer can
 * see what they have earned, but money only moves once the work is done.
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
    /** Funds clear this long after a session, leaving room for disputes. */
    private const CLEARANCE_DAYS = 7;

    public const BASIS_SESSION = 'session';
    public const BASIS_HOUR    = 'hour';

    public function register_hooks(): void
    {
        // Priority 20: after PTP_Booking_Fulfilment has written the booking
        // rows at priority 10, so the rows this reads already exist.
        add_action('ptp_order_paid', [$this, 'record_trainer_earnings'], 20, 1);
        add_action('ptp_booking_completed', [$this, 'release_payout'], 10, 1);
    }

    /**
     * What a trainer earns for one session.
     *
     * Read from the trainer's own configured amount. Nothing here consults what
     * the parent paid, so a discount, a promotion or a price change never
     * silently alters trainer pay.
     *
     * @return array{gross_cents: int, payout_cents: int, platform_cents: int, shortfall: bool}
     */
    public function split(int $gross_cents, int $trainer_id, int $minutes = 60): array
    {
        $gross  = max(0, $gross_cents);
        $payout = $this->payout_for($trainer_id, $minutes);

        /**
         * A payout larger than the charge means the platform loses money on the
         * session — always a configuration mistake (a rate set too high, or a
         * session sold at a discount below cost). The trainer is still paid
         * what they were promised; the shortfall is flagged for staff instead
         * of being silently absorbed or silently docked from the trainer.
         */
        $shortfall = $payout > $gross;

        return [
            'gross_cents'    => $gross,
            'payout_cents'   => $payout,
            'platform_cents' => max(0, $gross - $payout),
            'shortfall'      => $shortfall,
        ];
    }

    /**
     * This trainer's payout for a session of the given length.
     *
     * Filterable so a one-off arrangement can be honoured without editing the
     * stored rate, but the default is simply what staff assigned.
     */
    public function payout_for(int $trainer_id, int $minutes = 60): int
    {
        $trainer = $this->trainer_row($trainer_id);

        if ($trainer === null) {
            return 0;
        }

        $amount = max(0, (int) $trainer->payout_cents);
        $basis  = (string) $trainer->payout_basis;

        if ($basis === self::BASIS_HOUR) {
            $amount = (int) round($amount * max(0, $minutes) / 60);
        }

        return max(0, (int) apply_filters('ptp_trainer_payout_cents', $amount, $trainer_id, $minutes));
    }

    /**
     * Write ledger rows for every training booking on a paid order.
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
            $trainer_id = (int) $booking->trainer_id;
            $minutes    = $this->minutes_of($booking);
            $gross      = $this->gross_for_order($order_id);
            $split      = $this->split($gross, $trainer_id, $minutes);

            if ($split['payout_cents'] <= 0) {
                /**
                 * No rate assigned yet. Staff need to set one before this
                 * trainer can be paid — surfaced rather than silently skipped,
                 * because the session still happened and is still owed.
                 */
                do_action('ptp_trainer_payout_unset', $trainer_id, (int) $booking->id);

                continue;
            }

            if ($split['shortfall']) {
                do_action(
                    'ptp_payout_exceeds_charge',
                    $trainer_id,
                    (int) $booking->id,
                    $split['payout_cents'],
                    $split['gross_cents']
                );
            }

            // Unique index on booking_id makes a repeated webhook harmless.
            $wpdb->query(
                $wpdb->prepare(
                    'INSERT IGNORE INTO ' . PTP_Schema::table('payouts')
                    . ' (trainer_id, booking_id, gross_cents, platform_fee_cents, net_cents, minutes, status, available_at, created_at)'
                    . ' VALUES (%d, %d, %d, %d, %d, %d, %s, %s, %s)',
                    $trainer_id,
                    (int) $booking->id,
                    $split['gross_cents'],
                    $split['platform_cents'],
                    $split['payout_cents'],
                    $minutes,
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
     * Skips when the trainer has not finished Stripe onboarding — the ledger
     * row stays pending and their dashboard says "connect your account to get
     * paid", which is more useful than a failed transfer.
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
     * @return array{pending_cents: int, clearing_cents: int, paid_cents: int, connected: bool, rate_cents: int, rate_basis: string}
     */
    public function earnings_for(PTP_Actor $actor): array
    {
        global $wpdb;

        $empty = [
            'pending_cents'  => 0,
            'clearing_cents' => 0,
            'paid_cents'     => 0,
            'connected'      => false,
            'rate_cents'     => 0,
            'rate_basis'     => self::BASIS_SESSION,
        ];

        if (!$actor->is(PTP_Guard::ROLE_TRAINER) || $actor->id() === null) {
            return $empty;
        }

        $trainer_id = (int) $actor->id();
        $table      = PTP_Schema::table('payouts');
        $now        = current_time('mysql', true);
        $trainer    = $this->trainer_row($trainer_id);

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
            'rate_cents'     => $trainer ? (int) $trainer->payout_cents : 0,
            'rate_basis'     => $trainer ? (string) $trainer->payout_basis : self::BASIS_SESSION,
        ];
    }

    /**
     * Set a trainer's payout rate. Staff action — the caller is responsible for
     * the capability check; the repository guards the values.
     */
    public function set_payout_rate(int $trainer_id, int $payout_cents, string $basis = self::BASIS_SESSION): void
    {
        global $wpdb;

        if (!in_array($basis, [self::BASIS_SESSION, self::BASIS_HOUR], true)) {
            throw new PTP_Repository_Exception(__('Unknown payout basis.', 'ptp'));
        }

        $wpdb->update(
            PTP_Schema::table('trainers'),
            [
                'payout_cents' => max(0, $payout_cents),
                'payout_basis' => $basis,
                'updated_at'   => current_time('mysql', true),
            ],
            ['id' => $trainer_id],
            ['%d', '%s', '%s'],
            ['%d']
        );
    }

    // -- internals ------------------------------------------------------------

    /** What the parent paid for the training lines on this order. */
    private function gross_for_order(int $order_id): int
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

    /** Session length from the booking's own start and end. */
    private function minutes_of(object $booking): int
    {
        if (empty($booking->ends_at)) {
            return 60;
        }

        try {
            $start = new DateTimeImmutable((string) $booking->starts_at);
            $end   = new DateTimeImmutable((string) $booking->ends_at);
        } catch (Exception $e) {
            return 60;
        }

        $minutes = (int) round(($end->getTimestamp() - $start->getTimestamp()) / 60);

        return $minutes > 0 ? $minutes : 60;
    }

    private function trainer_row(int $trainer_id): ?object
    {
        global $wpdb;

        $row = $wpdb->get_row(
            $wpdb->prepare(
                'SELECT id, payout_cents, payout_basis, stripe_account_id FROM ' . PTP_Schema::table('trainers') . ' WHERE id = %d',
                $trainer_id
            )
        );

        return $row ?: null;
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
        $trainer = $this->trainer_row($trainer_id);

        return $trainer ? (string) $trainer->stripe_account_id : '';
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
