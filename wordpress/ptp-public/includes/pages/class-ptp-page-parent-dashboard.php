<?php
/**
 * Parent dashboard.
 *
 * Replaces parent-dashboard-v200.php (2,914 lines of mixed query, markup and
 * business logic). Every read is scoped by the Core repositories to the actor
 * resolved from the session, so there is no id in this file to tamper with.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Page_Parent_Dashboard extends PTP_Page
{
    private const AJAX_CANCEL = 'ptp_parent_cancel_booking';

    public function register(): void
    {
        add_action('wp_ajax_' . self::AJAX_CANCEL, [$this, 'ajax_cancel_booking']);
    }

    protected function template(): string
    {
        return 'parent-dashboard';
    }

    protected function data(array $atts): array
    {
        $actor = $this->actor();

        if (!$actor->is(PTP_Guard::ROLE_PARENT)) {
            return ['requires_login' => true, 'login_url' => wp_login_url(get_permalink())];
        }

        return [
            'requires_login' => false,
            'parent'         => ptp_core()->parents()->find_for($actor),
            'players'        => ptp_core()->players()->for_actor($actor),
            'bookings'       => ptp_core()->bookings()->upcoming_for($actor),
            'orders'         => ptp_core()->orders()->history_for($actor),
            'cancel_action'  => self::AJAX_CANCEL,
            'cancel_nonce'   => $this->nonce(self::AJAX_CANCEL),
        ];
    }

    /**
     * Cancel a booking.
     *
     * The repository refuses any booking that is not the actor's — the check
     * the old leave-group-session handler was missing, which let any logged-in
     * user cancel another family's paid registration.
     */
    public function ajax_cancel_booking(): void
    {
        $actor = ptp_core()->guard()->authorise_ajax(self::AJAX_CANCEL);

        $booking_id = isset($_POST['booking_id']) ? absint($_POST['booking_id']) : 0;

        try {
            ptp_core()->bookings()->cancel($actor, $booking_id);
        } catch (PTP_Repository_Exception $e) {
            wp_send_json_error(['message' => $e->getMessage()], 400);
        }

        wp_send_json_success(['message' => __('Booking cancelled.', 'ptp')]);
    }
}
