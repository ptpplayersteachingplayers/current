<?php
/**
 * Trainer dashboard.
 *
 * Replaces trainer-dashboard-v200.php (3,103 lines). Scoped to the trainer
 * resolved from the session; a trainer cannot read another trainer's schedule.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Page_Trainer_Dashboard extends PTP_Page
{
    protected function template(): string
    {
        return 'trainer-dashboard';
    }

    protected function data(array $atts): array
    {
        $actor = $this->actor();

        if (!$actor->is(PTP_Guard::ROLE_TRAINER)) {
            return ['requires_login' => true, 'login_url' => wp_login_url(get_permalink())];
        }

        return [
            'requires_login' => false,
            'bookings'       => ptp_core()->bookings()->upcoming_for($actor),
        ];
    }
}
