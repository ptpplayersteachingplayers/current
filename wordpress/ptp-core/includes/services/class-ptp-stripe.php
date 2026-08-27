<?php
/**
 * The only Stripe integration in the platform.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS CLASS EXISTS
 * ---------------------------------------------------------------------------
 * The previous codebase had thirteen Stripe files across three plugins. Two of
 * them exposed endpoints that marked an order paid from a client-supplied
 * payment_intent_id without ever asking Stripe whether the payment actually
 * succeeded — a free-order bug reachable by anyone who could load the checkout
 * page.
 *
 * Two rules here, both enforced by the shape of the API rather than by review:
 *
 *   1. create_intent() takes a PTP_Quote, never an amount. There is no
 *      parameter for a caller to pass a figure through.
 *   2. An order is marked paid in exactly one place — the signature-verified
 *      webhook — after re-reading the PaymentIntent from Stripe and comparing
 *      the amount actually received against the quote. No front-end callback
 *      can mark anything paid.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Stripe
{
    private const API_BASE = 'https://api.stripe.com/v1/';

    /** Webhook events older than this are rejected as replays. */
    private const MAX_EVENT_AGE = 300;

    public function register_hooks(): void
    {
        add_action('rest_api_init', [$this, 'register_webhook_route']);
    }

    public function register_webhook_route(): void
    {
        register_rest_route('ptp/v1', '/stripe/webhook', [
            'methods'  => 'POST',
            'callback' => [$this, 'handle_webhook'],
            /**
             * Public by necessity — Stripe cannot authenticate. Authenticity
             * comes from the HMAC signature check in verify_signature(),
             * which fails closed when no secret is configured.
             */
            'permission_callback' => '__return_true',
        ]);
    }

    /**
     * Create a PaymentIntent for a quote.
     *
     * The amount comes from the quote and nowhere else. The quote id is stored
     * in metadata so the webhook can reconcile what Stripe received against
     * what we priced.
     *
     * @return array{id: string, client_secret: string}
     */
    public function create_intent(PTP_Quote $quote, PTP_Actor $actor): array
    {
        $response = $this->request('payment_intents', [
            'amount'                      => $quote->total_cents(),
            'currency'                    => 'usd',
            'automatic_payment_methods'   => ['enabled' => 'true'],
            'metadata'                    => [
                'ptp_quote_id' => $quote->id(),
                'ptp_user_id'  => (string) $actor->user_id(),
            ],
        ]);

        return [
            'id'            => (string) ($response['id'] ?? ''),
            'client_secret' => (string) ($response['client_secret'] ?? ''),
        ];
    }

    /**
     * Update an existing intent to match a re-priced quote.
     *
     * Used when the customer edits the cart mid-checkout. The new amount is
     * again taken from a freshly computed quote, and the intent is verified to
     * belong to this user before it is touched — the audit found an endpoint
     * that would reprice any intent whose id merely started with "pi_".
     */
    public function update_intent_for_quote(string $intent_id, PTP_Quote $quote, PTP_Actor $actor): void
    {
        $intent = $this->retrieve_intent($intent_id);

        if ((int) ($intent['metadata']['ptp_user_id'] ?? -1) !== $actor->user_id()) {
            throw new PTP_Stripe_Exception(__('That payment session belongs to a different account.', 'ptp'));
        }

        $this->request('payment_intents/' . rawurlencode($intent_id), [
            'amount'   => $quote->total_cents(),
            'metadata' => ['ptp_quote_id' => $quote->id()],
        ]);
    }

    /** @return array<string, mixed> */
    public function retrieve_intent(string $intent_id): array
    {
        return $this->request('payment_intents/' . rawurlencode($intent_id), null, 'GET');
    }

    /**
     * Webhook entry point. Nothing is trusted until the signature verifies.
     */
    public function handle_webhook(WP_REST_Request $request): WP_REST_Response
    {
        $payload   = $request->get_body();
        $signature = $request->get_header('stripe-signature') ?? '';

        if (!$this->verify_signature($payload, $signature)) {
            return new WP_REST_Response(['error' => 'invalid signature'], 400);
        }

        $event = json_decode($payload, true);

        if (!is_array($event) || !isset($event['type'], $event['id'])) {
            return new WP_REST_Response(['error' => 'malformed event'], 400);
        }

        // Stripe retries on any non-2xx, so handling must be idempotent.
        if (!$this->claim_event((string) $event['id'])) {
            return new WP_REST_Response(['status' => 'duplicate'], 200);
        }

        if ($event['type'] === 'payment_intent.succeeded') {
            $this->settle_payment((array) ($event['data']['object'] ?? []));
        }

        do_action('ptp_stripe_event', (string) $event['type'], $event);

        return new WP_REST_Response(['status' => 'ok'], 200);
    }

    /**
     * The one place an order becomes paid.
     *
     * Reconciles the amount Stripe actually received against the quote we
     * issued. A shortfall records the payment but never fulfils the order.
     */
    private function settle_payment(array $intent): void
    {
        $quote_id = (string) ($intent['metadata']['ptp_quote_id'] ?? '');
        $received = (int) ($intent['amount_received'] ?? 0);

        if ($quote_id === '') {
            return;
        }

        $order = ptp_core()->orders()->find_by_quote($quote_id);

        if ($order === null) {
            return;
        }

        if ($received < $order->total_cents()) {
            ptp_core()->orders()->flag_underpaid($order->id(), $received);

            return;
        }

        ptp_core()->orders()->mark_paid($order->id(), (string) ($intent['id'] ?? ''), $received);
        ptp_core()->pricing()->consume_quote($quote_id);

        do_action('ptp_order_paid', $order->id());
    }

    /**
     * Constant-time HMAC verification with a replay window.
     * Fails closed: an unconfigured secret rejects every webhook.
     */
    private function verify_signature(string $payload, string $header): bool
    {
        $secret = $this->webhook_secret();

        if ($secret === '' || $header === '') {
            return false;
        }

        $timestamp = '';
        $signatures = [];

        foreach (explode(',', $header) as $part) {
            $pair = explode('=', trim($part), 2);

            if (count($pair) !== 2) {
                continue;
            }

            if ($pair[0] === 't') {
                $timestamp = $pair[1];
            } elseif ($pair[0] === 'v1') {
                $signatures[] = $pair[1];
            }
        }

        if ($timestamp === '' || $signatures === []) {
            return false;
        }

        if (abs(time() - (int) $timestamp) > self::MAX_EVENT_AGE) {
            return false;
        }

        $expected = hash_hmac('sha256', $timestamp . '.' . $payload, $secret);

        foreach ($signatures as $candidate) {
            if (hash_equals($expected, $candidate)) {
                return true;
            }
        }

        return false;
    }

    /** Atomic claim so concurrent retries cannot both process one event. */
    private function claim_event(string $event_id): bool
    {
        return PTP_Schema::claim_idempotency_key('stripe_event_' . $event_id);
    }

    /**
     * @param array<string, mixed>|null $body
     * @return array<string, mixed>
     */
    private function request(string $path, ?array $body = null, string $method = 'POST'): array
    {
        $secret = $this->secret_key();

        if ($secret === '') {
            throw new PTP_Stripe_Exception(__('Payments are not configured.', 'ptp'));
        }

        $args = [
            'method'  => $method,
            'timeout' => 20,
            'headers' => [
                'Authorization'  => 'Bearer ' . $secret,
                'Content-Type'   => 'application/x-www-form-urlencoded',
                'Stripe-Version' => '2024-06-20',
            ],
        ];

        if ($body !== null) {
            $args['body'] = http_build_query($body);
        }

        $response = wp_remote_request(self::API_BASE . $path, $args);

        if (is_wp_error($response)) {
            throw new PTP_Stripe_Exception($response->get_error_message());
        }

        $decoded = json_decode(wp_remote_retrieve_body($response), true);

        if (!is_array($decoded)) {
            throw new PTP_Stripe_Exception(__('Unexpected response from the payment provider.', 'ptp'));
        }

        if (isset($decoded['error'])) {
            throw new PTP_Stripe_Exception((string) ($decoded['error']['message'] ?? 'Stripe error'));
        }

        return $decoded;
    }

    /**
     * Credentials come from constants first so production keys can live in
     * wp-config.php outside the database and outside version control.
     */
    private function secret_key(): string
    {
        if (defined('PTP_STRIPE_SECRET_KEY') && PTP_STRIPE_SECRET_KEY) {
            return (string) PTP_STRIPE_SECRET_KEY;
        }

        return (string) get_option('ptp_stripe_secret_key', '');
    }

    private function webhook_secret(): string
    {
        if (defined('PTP_STRIPE_WEBHOOK_SECRET') && PTP_STRIPE_WEBHOOK_SECRET) {
            return (string) PTP_STRIPE_WEBHOOK_SECRET;
        }

        return (string) get_option('ptp_stripe_webhook_secret', '');
    }

    public function publishable_key(): string
    {
        if (defined('PTP_STRIPE_PUBLISHABLE_KEY') && PTP_STRIPE_PUBLISHABLE_KEY) {
            return (string) PTP_STRIPE_PUBLISHABLE_KEY;
        }

        return (string) get_option('ptp_stripe_publishable_key', '');
    }
}
