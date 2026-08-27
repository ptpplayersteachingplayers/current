<?php
/**
 * Post-purchase confirmation.
 *
 * Replaces ptp_thank_you, ptp_camp_thank_you and ptp_camp_thankyou — three
 * shortcodes for one page, plus two template versions (v100 and v175).
 *
 * This page reports status; it never sets it. An order becomes paid only via
 * the signature-verified Stripe webhook, so a customer who lands here before
 * the webhook arrives sees a pending state rather than a false confirmation.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Page_Thank_You extends PTP_Page
{
    protected function template(): string
    {
        return 'thank-you';
    }

    protected function data(array $atts): array
    {
        $actor    = $this->actor();
        $order_id = isset($_GET['order']) ? absint($_GET['order']) : 0;

        // find_for scopes to the actor, so ?order=N cannot show someone else's.
        $order = $order_id > 0 ? ptp_core()->orders()->find_for($actor, $order_id) : null;

        return [
            'order'   => $order,
            'pending' => $order !== null && !$order->is_paid(),
        ];
    }
}
