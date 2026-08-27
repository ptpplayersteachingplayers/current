<?php
/**
 * Branded login.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Page_Login extends PTP_Page
{
    protected function template(): string
    {
        return 'login';
    }

    protected function data(array $atts): array
    {
        $atts = shortcode_atts(['redirect' => ''], $atts, 'ptp_login');

        $redirect = (string) $atts['redirect'];

        return [
            'already_in' => !$this->actor()->is_guest(),
            // wp_validate_redirect keeps an attacker-supplied ?redirect_to from
            // turning the login form into an open redirect.
            'redirect'   => wp_validate_redirect($redirect, PTP_Public_Links::dashboard()),
            'register_url' => PTP_Public_Links::register(),
        ];
    }
}
