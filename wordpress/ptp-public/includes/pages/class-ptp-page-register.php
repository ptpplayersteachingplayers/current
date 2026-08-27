<?php
/**
 * Account creation.
 *
 * Creates the WordPress user and the Core parent record together, so an actor
 * always resolves to a domain id immediately after signup.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Page_Register extends PTP_Page
{
    private const AJAX_REGISTER = 'ptp_register_account';

    public function register(): void
    {
        add_action('wp_ajax_nopriv_' . self::AJAX_REGISTER, [$this, 'ajax_register']);
    }

    protected function template(): string
    {
        return 'register';
    }

    protected function data(array $atts): array
    {
        return [
            'already_in'      => !$this->actor()->is_guest(),
            'register_action' => self::AJAX_REGISTER,
            'register_nonce'  => $this->nonce(self::AJAX_REGISTER),
            'login_url'       => PTP_Public_Links::login(),
        ];
    }

    public function ajax_register(): void
    {
        // Unauthenticated by necessity, but still nonce-checked so the form
        // cannot be driven from another origin.
        if (!check_ajax_referer(self::AJAX_REGISTER, 'nonce', false)) {
            wp_send_json_error(['message' => __('Please refresh and try again.', 'ptp')], 403);
        }

        $email = isset($_POST['email']) ? sanitize_email(wp_unslash($_POST['email'])) : '';
        $pass  = isset($_POST['password']) ? (string) wp_unslash($_POST['password']) : '';

        if (!is_email($email) || strlen($pass) < 8) {
            wp_send_json_error(['message' => __('Enter a valid email and a password of at least 8 characters.', 'ptp')], 400);
        }

        if (email_exists($email)) {
            wp_send_json_error(['message' => __('An account with that email already exists.', 'ptp')], 400);
        }

        $user_id = wp_create_user($email, $pass, $email);

        if (is_wp_error($user_id)) {
            wp_send_json_error(['message' => __('We could not create your account.', 'ptp')], 400);
        }

        ptp_core()->parents()->create_for_user((int) $user_id, [
            'email'      => $email,
            'first_name' => isset($_POST['first_name']) ? sanitize_text_field(wp_unslash($_POST['first_name'])) : '',
            'last_name'  => isset($_POST['last_name']) ? sanitize_text_field(wp_unslash($_POST['last_name'])) : '',
            'phone'      => isset($_POST['phone']) ? sanitize_text_field(wp_unslash($_POST['phone'])) : '',
        ]);

        wp_set_current_user((int) $user_id);
        wp_set_auth_cookie((int) $user_id, true);

        wp_send_json_success(['redirect' => PTP_Public_Links::dashboard()]);
    }
}
