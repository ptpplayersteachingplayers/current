<?php
/**
 * Lead capture, including the Facebook Lead Ads webhook.
 *
 * ---------------------------------------------------------------------------
 * The old webhook verified its HMAC signature only when an app secret happened
 * to be configured — `if (!empty($secret)) { verify(); }` — so an unset secret
 * silently downgraded the endpoint to accepting any POST from anyone. This
 * implementation fails closed: no secret configured means every request is
 * rejected.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Lead_Capture
{
    public function register(): void
    {
        add_action('rest_api_init', [$this, 'register_routes']);
    }

    public function register_routes(): void
    {
        register_rest_route('ptp/v1', '/leads/facebook', [
            [
                'methods'             => 'GET',
                'callback'            => [$this, 'handle_verification'],
                'permission_callback' => '__return_true',
            ],
            [
                'methods'             => 'POST',
                'callback'            => [$this, 'handle_webhook'],
                // Authenticity is established by the HMAC check inside.
                'permission_callback' => '__return_true',
            ],
        ]);
    }

    /** Meta's one-time subscribe handshake. Constant-time comparison. */
    public function handle_verification(WP_REST_Request $request)
    {
        $token    = (string) $request->get_param('hub_verify_token');
        $expected = (string) get_option('ptp_fb_verify_token', '');

        if ($expected === '' || !hash_equals($expected, $token)) {
            return new WP_REST_Response(['error' => 'invalid token'], 403);
        }

        return new WP_REST_Response((string) $request->get_param('hub_challenge'), 200);
    }

    public function handle_webhook(WP_REST_Request $request): WP_REST_Response
    {
        $secret = (string) get_option('ptp_fb_app_secret', '');

        // Fail closed. An unconfigured secret rejects everything.
        if ($secret === '') {
            return new WP_REST_Response(['error' => 'not configured'], 503);
        }

        $signature = (string) $request->get_header('x-hub-signature-256');
        $payload   = $request->get_body();
        $expected  = 'sha256=' . hash_hmac('sha256', $payload, $secret);

        if (!hash_equals($expected, $signature)) {
            return new WP_REST_Response(['error' => 'invalid signature'], 403);
        }

        $event = json_decode($payload, true);

        if (is_array($event)) {
            do_action('ptp_lead_received', 'facebook', $event);
        }

        return new WP_REST_Response(['status' => 'ok'], 200);
    }
}
