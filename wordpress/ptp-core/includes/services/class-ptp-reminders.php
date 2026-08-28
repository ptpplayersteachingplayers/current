<?php
/**
 * Session reminders.
 *
 * ---------------------------------------------------------------------------
 * One cron pass an hour, sending a reminder the day before a session and again
 * on the morning of it. Reminders reduce no-shows, which is the single most
 * expensive thing that can happen to a booked slot: the trainer still gets
 * paid, the parent is not refunded, and nobody is happy.
 *
 * Two rules keep this from becoming a source of duplicate mail:
 *
 *   1. Every send claims an idempotency key first. The claim is a unique-index
 *      insert, so an overlapping cron run, a manual trigger and a retry all
 *      collapse to one email.
 *
 *   2. A window, not an instant. Cron does not fire on time; if the job is
 *      late, a reminder due 90 minutes ago should still go out rather than
 *      being skipped because its exact moment passed.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Reminders
{
    private const HOOK = 'ptp_send_reminders';

    /** How far either side of the target the job will still send. */
    private const WINDOW_HOURS = 3;

    /** Reminders to send, as hours before the session start. */
    private const SCHEDULE = [
        24 => 'day_before',
        2  => 'same_day',
    ];

    public function register_hooks(): void
    {
        add_action(self::HOOK, [$this, 'run']);
        add_action('init', [$this, 'schedule']);
    }

    public function schedule(): void
    {
        if (!wp_next_scheduled(self::HOOK)) {
            wp_schedule_event(time() + HOUR_IN_SECONDS, 'hourly', self::HOOK);
        }
    }

    public static function unschedule(): void
    {
        $timestamp = wp_next_scheduled(self::HOOK);

        if ($timestamp) {
            wp_unschedule_event($timestamp, self::HOOK);
        }
    }

    /**
     * Send every reminder currently due.
     *
     * @return int how many were sent, for logging and for the admin trigger
     */
    public function run(): int
    {
        $sent = 0;

        foreach (self::SCHEDULE as $hours_before => $slug) {
            foreach ($this->due($hours_before) as $booking) {
                if ($this->send($booking, $slug, $hours_before)) {
                    $sent++;
                }
            }
        }

        if ($sent > 0) {
            do_action('ptp_reminders_sent', $sent);
        }

        return $sent;
    }

    /**
     * Bookings starting inside the window around `now + $hours_before`.
     *
     * Cancelled bookings are excluded, and so are ones already completed —
     * a trainer who marked a session delivered early should not trigger a
     * "see you tomorrow" the next morning.
     *
     * @return array<int, object>
     */
    private function due(int $hours_before): array
    {
        global $wpdb;

        $target = time() + ($hours_before * HOUR_IN_SECONDS);
        $window = self::WINDOW_HOURS * HOUR_IN_SECONDS;

        return $wpdb->get_results(
            $wpdb->prepare(
                'SELECT b.*, p.email, p.first_name, t.display_name AS trainer_name'
                . ' FROM ' . PTP_Schema::table('bookings') . ' b'
                . ' INNER JOIN ' . PTP_Schema::table('parents') . ' p ON p.id = b.parent_id'
                . ' LEFT JOIN ' . PTP_Schema::table('trainers') . ' t ON t.id = b.trainer_id'
                . ' WHERE b.status = %s AND b.starts_at BETWEEN %s AND %s',
                'confirmed',
                gmdate('Y-m-d H:i:s', $target - $window),
                gmdate('Y-m-d H:i:s', $target + $window)
            )
        ) ?: [];
    }

    /**
     * Send one reminder, claiming its key first.
     *
     * The claim happens before the send, so a failed send does not leave the
     * key unclaimed and mail the customer twice on the next pass. The trade is
     * deliberate: a missed reminder is a smaller problem than a duplicate one.
     */
    private function send(object $booking, string $slug, int $hours_before): bool
    {
        if (empty($booking->email)) {
            return false;
        }

        $key = sprintf('reminder_%d_%s', (int) $booking->id, $slug);

        if (!PTP_Schema::claim_idempotency_key($key)) {
            return false;
        }

        $when = mysql2date(get_option('date_format') . ', g:ia', $booking->starts_at);

        return ptp_core()->mail()->send(
            (string) $booking->email,
            $this->subject($booking, $hours_before),
            $this->body($booking, $when, $hours_before)
        );
    }

    private function subject(object $booking, int $hours_before): string
    {
        $what = $booking->trainer_name
            ? sprintf(
                /* translators: %s: trainer name */
                __('your session with %s', 'ptp'),
                $booking->trainer_name
            )
            : __('your PTP session', 'ptp');

        return $hours_before <= 3
            ? sprintf(__('Today: %s', 'ptp'), $what)
            : sprintf(__('Tomorrow: %s', 'ptp'), $what);
    }

    private function body(object $booking, string $when, int $hours_before): string
    {
        $lead = $hours_before <= 3
            ? __('Just a reminder — this is happening today.', 'ptp')
            : __('Just a reminder — this is happening tomorrow.', 'ptp');

        $rows = sprintf(
            '<tr><td style="padding:8px 0;color:#6B7280;">%s</td><td align="right" style="padding:8px 0;font-weight:700;">%s</td></tr>',
            esc_html__('When', 'ptp'),
            esc_html($when)
        );

        if (!empty($booking->location)) {
            $rows .= sprintf(
                '<tr><td style="padding:8px 0;color:#6B7280;">%s</td><td align="right" style="padding:8px 0;font-weight:700;">%s</td></tr>',
                esc_html__('Where', 'ptp'),
                esc_html($booking->location)
            );
        }

        if (!empty($booking->trainer_name)) {
            $rows .= sprintf(
                '<tr><td style="padding:8px 0;color:#6B7280;">%s</td><td align="right" style="padding:8px 0;font-weight:700;">%s</td></tr>',
                esc_html__('Trainer', 'ptp'),
                esc_html($booking->trainer_name)
            );
        }

        $name = esc_html((string) $booking->first_name);
        $lead = esc_html($lead);

        return <<<HTML
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#374151;">
  Hi {$name} — {$lead}
</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;border-top:1px solid #E5E7EB;">
  {$rows}
</table>
HTML;
    }
}
