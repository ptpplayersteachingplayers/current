<?php
/**
 * Checkout — the only one.
 *
 * ---------------------------------------------------------------------------
 * This single class replaces fourteen checkout and cart implementations that
 * were all loaded and all hooked simultaneously in the old platform:
 * unified-checkout, unified-checkout-handler, unified-cart, bulletproof-checkout,
 * bundle-checkout, camp-checkout, camp-checkout-v99, cart-checkout-v71,
 * checkout-v77, checkout-ux, checkout-diagnostic, native-cart, cart-ajax and
 * agent-1-checkout-hardening.
 *
 * The security properties come from Core, not from care taken here:
 *   - The browser sends item ids and quantities. It cannot send a price.
 *   - PTP_Pricing computes every figure from the database.
 *   - The PaymentIntent is created from the quote; no amount parameter exists.
 *   - Nothing here can mark an order paid. Only the signed webhook does that.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Page_Checkout extends PTP_Page
{
    private const AJAX_QUOTE  = 'ptp_checkout_quote';
    private const AJAX_INTENT = 'ptp_checkout_intent';

    public function register(): void
    {
        add_action('wp_ajax_' . self::AJAX_QUOTE, [$this, 'ajax_quote']);
        add_action('wp_ajax_' . self::AJAX_INTENT, [$this, 'ajax_intent']);
    }

    protected function template(): string
    {
        return 'checkout';
    }

    protected function enqueue(): void
    {
        parent::enqueue();

        /**
         * Stripe.js must come from Stripe's own domain — self-hosting it
         * breaks PCI SAQ-A eligibility and Stripe's fraud signals. It is
         * declared as a dependency so it is always present before our script
         * runs.
         */
        wp_enqueue_script('stripe-js', 'https://js.stripe.com/v3/', [], null, true);
        wp_enqueue_script('ptp-checkout');
        wp_localize_script('ptp-checkout', 'PTPCheckout', [
            'ajaxUrl'        => admin_url('admin-ajax.php'),
            'quoteAction'    => self::AJAX_QUOTE,
            'intentAction'   => self::AJAX_INTENT,
            'quoteNonce'     => $this->nonce(self::AJAX_QUOTE),
            'intentNonce'    => $this->nonce(self::AJAX_INTENT),
            'publishableKey' => ptp_core()->stripe()->publishable_key(),
            'strings'        => [
                'processing' => __('Processing…', 'ptp'),
                'pay'        => __('Pay now', 'ptp'),
                'generic'    => __('We could not take that payment. Please check your details and try again.', 'ptp'),
            ],
        ]);
    }

    protected function data(array $atts): array
    {
        $actor = $this->actor();

        return [
            'actor'      => $actor,
            'is_guest'   => $actor->is_guest(),
            'login_url'  => wp_login_url(get_permalink()),
            'players'    => ptp_core()->players()->for_actor($actor),
        ];
    }

    /**
     * Price the cart.
     *
     * Reads only item references from the request. Any price, total or discount
     * amount in the payload is ignored — quote() has no parameter for one.
     */
    public function ajax_quote(): void
    {
        $actor = ptp_core()->guard()->authorise_ajax(self::AJAX_QUOTE);

        try {
            $quote = ptp_core()->pricing()->quote(
                $this->read_items(),
                isset($_POST['discount_code']) ? sanitize_text_field(wp_unslash($_POST['discount_code'])) : null,
                $actor
            );
        } catch (PTP_Pricing_Exception $e) {
            wp_send_json_error(['message' => $e->getMessage()], 400);
        }

        wp_send_json_success($this->present_quote($quote));
    }

    /**
     * Create or update the PaymentIntent for a quote.
     *
     * The client sends the quote id. The amount is re-read server-side from the
     * cached quote, so there is no value the browser can alter to change what
     * it will be charged.
     */
    public function ajax_intent(): void
    {
        $actor = ptp_core()->guard()->authorise_ajax(self::AJAX_INTENT);

        $quote_id  = isset($_POST['quote_id']) ? sanitize_text_field(wp_unslash($_POST['quote_id'])) : '';
        $intent_id = isset($_POST['intent_id']) ? sanitize_text_field(wp_unslash($_POST['intent_id'])) : '';

        try {
            $quote = ptp_core()->pricing()->retrieve_quote($quote_id, $actor);

            if ($intent_id !== '') {
                ptp_core()->stripe()->update_intent_for_quote($intent_id, $quote, $actor);

                wp_send_json_success([
                    'id'     => $intent_id,
                    'amount' => $quote->total_cents(),
                ]);
            }

            // The order is written before payment so the webhook has something
            // to reconcile against when Stripe calls back.
            $order_id = ptp_core()->orders()->create_from_quote($quote, $actor);

            $intent = ptp_core()->stripe()->create_intent($quote, $actor);
        } catch (PTP_Pricing_Exception | PTP_Stripe_Exception | PTP_Repository_Exception $e) {
            wp_send_json_error(['message' => $e->getMessage()], 400);
        }

        wp_send_json_success([
            'id'           => $intent['id'],
            'clientSecret' => $intent['client_secret'],
            'amount'       => $quote->total_cents(),
            /**
             * Where Stripe returns the customer after any redirect-based
             * method. Built server-side from the order we just wrote, so the
             * browser cannot point the confirmation at someone else's order —
             * and the thank-you page scopes the lookup to the actor anyway.
             */
            'returnUrl'    => PTP_Public_Links::thank_you($order_id),
        ]);
    }

    /**
     * Extract item references from the request.
     *
     * Deliberately narrow: type, id, qty. Everything else in the posted cart —
     * including any price the browser thinks applies — is discarded here.
     *
     * @return array<int, array{type: string, id: int, qty: int}>
     */
    private function read_items(): array
    {
        $raw = isset($_POST['items']) ? wp_unslash($_POST['items']) : '';
        $decoded = is_string($raw) ? json_decode($raw, true) : $raw;

        if (!is_array($decoded)) {
            return [];
        }

        $items = [];

        foreach ($decoded as $entry) {
            if (!is_array($entry)) {
                continue;
            }

            $items[] = [
                'type' => isset($entry['type']) ? sanitize_key($entry['type']) : '',
                'id'   => isset($entry['id']) ? absint($entry['id']) : 0,
                'qty'  => isset($entry['qty']) ? absint($entry['qty']) : 1,
            ];
        }

        return $items;
    }

    /** @return array<string, mixed> */
    private function present_quote(PTP_Quote $quote): array
    {
        $lines = [];

        foreach ($quote->lines() as $line) {
            $lines[] = [
                'label'  => $line['label'],
                'qty'    => $line['qty'],
                'amount' => $this->money($line['amount_cents']),
            ];
        }

        return [
            'quoteId'  => $quote->id(),
            'lines'    => $lines,
            'subtotal' => $this->money($quote->subtotal_cents()),
            'discount' => $quote->discount_cents() > 0 ? $this->money($quote->discount_cents()) : null,
            'discountLabel' => $quote->discount_label(),
            'total'    => $this->money($quote->total_cents()),
        ];
    }
}
