<?php
/**
 * Trainer application form.
 *
 * Applications are created with status 'pending' and require an explicit staff
 * approval in the admin plugin before the profile becomes bookable. The old
 * quick-apply endpoint inserted trainers directly as 'active' from an
 * unauthenticated POST, putting unvetted profiles straight into the directory.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Page_Trainer_Application extends PTP_Page
{
    private const AJAX_APPLY = 'ptp_trainer_apply';

    public function register(): void
    {
        add_action('wp_ajax_' . self::AJAX_APPLY, [$this, 'ajax_apply']);
        add_action('wp_ajax_nopriv_' . self::AJAX_APPLY, [$this, 'ajax_apply']);
    }

    protected function template(): string
    {
        return 'trainer-application';
    }

    protected function data(array $atts): array
    {
        return [
            'apply_action' => self::AJAX_APPLY,
            'apply_nonce'  => $this->nonce(self::AJAX_APPLY),
        ];
    }

    public function ajax_apply(): void
    {
        if (!check_ajax_referer(self::AJAX_APPLY, 'nonce', false)) {
            wp_send_json_error(['message' => __('Please refresh and try again.', 'ptp')], 403);
        }

        $name = isset($_POST['display_name']) ? sanitize_text_field(wp_unslash($_POST['display_name'])) : '';

        if ($name === '') {
            wp_send_json_error(['message' => __('Please tell us your name.', 'ptp')], 400);
        }

        ptp_core()->trainers()->create_application([
            'display_name' => $name,
            'bio'          => isset($_POST['bio']) ? wp_kses_post(wp_unslash($_POST['bio'])) : '',
        ]);

        wp_send_json_success(['message' => __('Thanks — we\'ll be in touch after we review your application.', 'ptp')]);
    }
}
