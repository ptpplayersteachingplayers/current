<?php
/**
 * Trainer portal.
 *
 * ---------------------------------------------------------------------------
 * What a trainer needs, in order: what's on today, what have I earned, and who
 * do I still need to mark as delivered. Availability editing sits below that
 * because it is a weekly chore, not a daily one.
 *
 * Every read is scoped by the Core repositories to the trainer resolved from
 * the session. There is no trainer id in this file to tamper with, which is
 * what the old 3,103-line trainer-dashboard-v200.php could not say.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Page_Trainer_Dashboard extends PTP_Page
{
    private const AJAX_COMPLETE   = 'ptp_trainer_complete_session';
    private const AJAX_ADD_RULE   = 'ptp_trainer_add_availability';
    private const AJAX_DROP_RULE  = 'ptp_trainer_drop_availability';
    private const AJAX_BLOCK_DATE = 'ptp_trainer_block_date';
    private const AJAX_CONNECT    = 'ptp_trainer_connect_payouts';

    public function register(): void
    {
        add_action('wp_ajax_' . self::AJAX_COMPLETE, [$this, 'ajax_complete']);
        add_action('wp_ajax_' . self::AJAX_ADD_RULE, [$this, 'ajax_add_rule']);
        add_action('wp_ajax_' . self::AJAX_DROP_RULE, [$this, 'ajax_drop_rule']);
        add_action('wp_ajax_' . self::AJAX_BLOCK_DATE, [$this, 'ajax_block_date']);
        add_action('wp_ajax_' . self::AJAX_CONNECT, [$this, 'ajax_connect']);
    }

    protected function template(): string
    {
        return 'trainer-dashboard';
    }

    protected function enqueue(): void
    {
        parent::enqueue();
        wp_enqueue_script('ptp-portal');
    }

    protected function data(array $atts): array
    {
        $actor = $this->actor();

        if (!$actor->is(PTP_Guard::ROLE_TRAINER)) {
            return ['requires_login' => true, 'login_url' => wp_login_url(get_permalink())];
        }

        $bookings = ptp_core()->bookings()->upcoming_for($actor, 50);

        return [
            'requires_login' => false,
            'today'          => $this->only_today($bookings),
            'upcoming'       => $bookings,
            'to_complete'    => ptp_core()->bookings()->awaiting_completion($actor),
            'earnings'       => ptp_core()->connect()->earnings_for($actor),
            'rules'          => ptp_core()->availability()->rules_for($actor),
            'blocked'        => ptp_core()->availability()->blocked_dates($actor),
            'weekdays'       => $this->weekday_labels(),
            'actions'        => [
                'complete'   => ['action' => self::AJAX_COMPLETE, 'nonce' => $this->nonce(self::AJAX_COMPLETE)],
                'addRule'    => ['action' => self::AJAX_ADD_RULE, 'nonce' => $this->nonce(self::AJAX_ADD_RULE)],
                'dropRule'   => ['action' => self::AJAX_DROP_RULE, 'nonce' => $this->nonce(self::AJAX_DROP_RULE)],
                'blockDate'  => ['action' => self::AJAX_BLOCK_DATE, 'nonce' => $this->nonce(self::AJAX_BLOCK_DATE)],
                'connect'    => ['action' => self::AJAX_CONNECT, 'nonce' => $this->nonce(self::AJAX_CONNECT)],
            ],
        ];
    }

    /**
     * Mark a session delivered. The repository scopes to this trainer and only
     * transitions a confirmed booking, so this cannot release another
     * trainer's payout or fire the same one twice.
     */
    public function ajax_complete(): void
    {
        $actor   = ptp_core()->guard()->authorise_ajax(self::AJAX_COMPLETE, PTP_Guard::ROLE_TRAINER);
        $booking = ptp_core()->bookings()->find_for($actor, isset($_POST['booking_id']) ? absint($_POST['booking_id']) : 0);

        if ($booking === null) {
            wp_send_json_error(['message' => __('Session not found.', 'ptp')], 404);
        }

        if ($booking->starts_at > current_time('mysql', true)) {
            wp_send_json_error(['message' => __('That session has not happened yet.', 'ptp')], 400);
        }

        ptp_core()->bookings()->mark_completed((int) $booking->id);

        wp_send_json_success(['message' => __('Marked as delivered. Your payout will clear shortly.', 'ptp')]);
    }

    public function ajax_add_rule(): void
    {
        $actor = ptp_core()->guard()->authorise_ajax(self::AJAX_ADD_RULE, PTP_Guard::ROLE_TRAINER);

        try {
            ptp_core()->availability()->add_rule($actor, [
                'weekday'      => $_POST['weekday'] ?? null,
                'starts_time'  => $_POST['starts_time'] ?? '',
                'ends_time'    => $_POST['ends_time'] ?? '',
                'location'     => $_POST['location'] ?? '',
                'slot_minutes' => $_POST['slot_minutes'] ?? 60,
            ]);
        } catch (PTP_Repository_Exception $e) {
            wp_send_json_error(['message' => $e->getMessage()], 400);
        }

        wp_send_json_success(['message' => __('Availability added.', 'ptp')]);
    }

    public function ajax_drop_rule(): void
    {
        $actor = ptp_core()->guard()->authorise_ajax(self::AJAX_DROP_RULE, PTP_Guard::ROLE_TRAINER);

        try {
            ptp_core()->availability()->delete_rule($actor, isset($_POST['rule_id']) ? absint($_POST['rule_id']) : 0);
        } catch (PTP_Repository_Exception $e) {
            wp_send_json_error(['message' => $e->getMessage()], 403);
        }

        wp_send_json_success(['message' => __('Availability removed.', 'ptp')]);
    }

    public function ajax_block_date(): void
    {
        $actor = ptp_core()->guard()->authorise_ajax(self::AJAX_BLOCK_DATE, PTP_Guard::ROLE_TRAINER);
        $date  = isset($_POST['date']) ? sanitize_text_field(wp_unslash($_POST['date'])) : '';

        try {
            if (!empty($_POST['unblock'])) {
                ptp_core()->availability()->unblock_date($actor, $date);
            } else {
                ptp_core()->availability()->block_date($actor, $date, isset($_POST['note']) ? sanitize_text_field(wp_unslash($_POST['note'])) : '');
            }
        } catch (PTP_Repository_Exception $e) {
            wp_send_json_error(['message' => $e->getMessage()], 400);
        }

        wp_send_json_success(['message' => __('Calendar updated.', 'ptp')]);
    }

    /** Hand the trainer a Stripe-hosted onboarding link. */
    public function ajax_connect(): void
    {
        $actor = ptp_core()->guard()->authorise_ajax(self::AJAX_CONNECT, PTP_Guard::ROLE_TRAINER);

        try {
            $url = ptp_core()->connect()->onboarding_url($actor, get_permalink());
        } catch (PTP_Stripe_Exception | PTP_Repository_Exception $e) {
            wp_send_json_error(['message' => $e->getMessage()], 400);
        }

        wp_send_json_success(['url' => $url]);
    }

    /** @param array<int, object> $bookings @return array<int, object> */
    private function only_today(array $bookings): array
    {
        $today = current_time('Y-m-d');

        return array_values(array_filter(
            $bookings,
            static fn(object $b) => substr((string) $b->starts_at, 0, 10) === $today
        ));
    }

    /** @return array<int, string> */
    private function weekday_labels(): array
    {
        return [
            __('Sunday', 'ptp'), __('Monday', 'ptp'), __('Tuesday', 'ptp'),
            __('Wednesday', 'ptp'), __('Thursday', 'ptp'), __('Friday', 'ptp'),
            __('Saturday', 'ptp'),
        ];
    }
}
