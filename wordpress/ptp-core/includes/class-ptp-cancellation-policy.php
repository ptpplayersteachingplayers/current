<?php
/**
 * What a cancellation is worth.
 *
 * ---------------------------------------------------------------------------
 * The policy lives in one class so that "how much do we refund?" has a single
 * answer, and so changing the rule is a change in one place rather than a hunt
 * through the cancel handlers on the web, the mobile API and the admin screen.
 *
 * The default rule, in plain terms:
 *
 *   more than 24h before the session   full refund
 *   less than 24h before               no refund — the trainer's slot is gone
 *   staff cancelling, any time         full refund
 *   the session already happened       no refund
 *
 * Trainer pay follows the same decision. A refunded session reverses the
 * trainer's pending payout: they are not paid for a session that did not
 * happen and that the parent got their money back for. When the parent is NOT
 * refunded — a late cancellation — the trainer keeps their payout, because the
 * whole point of the cutoff is that they held the time.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Cancellation_Policy
{
    /** Cancel before this many hours to get a full refund. */
    private const FREE_CANCEL_HOURS = 24;

    /**
     * Decide what a cancellation is worth.
     *
     * @param string $starts_at   the session's start, MySQL format
     * @param bool   $by_staff    staff override the cutoff
     * @return array{refund: bool, reverse_payout: bool, reason: string}
     */
    public function decide(string $starts_at, bool $by_staff = false): array
    {
        // Staff cancel for a reason the customer should not pay for — a trainer
        // dropping out, weather, a venue closing.
        if ($by_staff) {
            return [
                'refund'         => true,
                'reverse_payout' => true,
                'reason'         => 'staff_cancelled',
            ];
        }

        $starts = $this->timestamp($starts_at);

        if ($starts === null) {
            // An unparseable date is not the customer's fault; refund and flag.
            return ['refund' => true, 'reverse_payout' => true, 'reason' => 'unknown_start'];
        }

        if ($starts <= time()) {
            // Already happened, or in progress. The trainer delivered or held it.
            return ['refund' => false, 'reverse_payout' => false, 'reason' => 'session_passed'];
        }

        $hours_notice = ($starts - time()) / HOUR_IN_SECONDS;

        if ($hours_notice >= $this->free_cancel_hours()) {
            return ['refund' => true, 'reverse_payout' => true, 'reason' => 'cancelled_in_time'];
        }

        /**
         * Inside the cutoff. The trainer held the slot and turned other work
         * away, so they keep their payout and the parent is not refunded.
         */
        return ['refund' => false, 'reverse_payout' => false, 'reason' => 'cancelled_late'];
    }

    /** Customer-facing explanation, shown before they confirm. */
    public function describe(string $starts_at): string
    {
        $decision = $this->decide($starts_at);

        switch ($decision['reason']) {
            case 'cancelled_in_time':
                return __('Cancelling now refunds you in full.', 'ptp');

            case 'cancelled_late':
                return sprintf(
                    /* translators: %d: hours of notice required for a refund */
                    __('This session starts in under %d hours, so it is not refundable. You can still cancel to free up the time.', 'ptp'),
                    $this->free_cancel_hours()
                );

            case 'session_passed':
                return __('This session has already started and cannot be refunded.', 'ptp');

            default:
                return __('Cancelling now refunds you in full.', 'ptp');
        }
    }

    /** Hours of notice needed for a full refund. Filterable per site. */
    public function free_cancel_hours(): int
    {
        return max(0, (int) apply_filters(
            'ptp_free_cancel_hours',
            (int) get_option('ptp_free_cancel_hours', self::FREE_CANCEL_HOURS)
        ));
    }

    private function timestamp(string $starts_at): ?int
    {
        if (trim($starts_at) === '') {
            return null;
        }

        try {
            return (new DateTimeImmutable($starts_at))->getTimestamp();
        } catch (Exception $e) {
            return null;
        }
    }
}
