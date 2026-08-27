<?php
/**
 * Post-purchase confirmation.
 *
 * @var array<string, mixed> $data
 *
 * This page reflects order state; it never sets it. When the customer arrives
 * before Stripe's webhook has landed, we say the payment is processing rather
 * than confirming a sale that has not settled.
 */

if (!defined('ABSPATH')) {
    exit;
}

/** @var PTP_Order|null $order */
$order = $data['order'];
?>
<div class="ptp ptp-container ptp-container--narrow ptp-stack">
    <?php if ($order === null) : ?>

        <h1 class="ptp-h1"><?php esc_html_e('Order not found', 'ptp'); ?></h1>
        <p class="ptp-muted">
            <?php esc_html_e('We could not find that order on your account. If you have just paid, check your email for a receipt.', 'ptp'); ?>
        </p>

    <?php elseif (!empty($data['pending'])) : ?>

        <h1 class="ptp-h1"><?php esc_html_e('Payment processing', 'ptp'); ?></h1>
        <div class="ptp-notice">
            <?php esc_html_e('Your payment is going through. This page will show your confirmation once it clears — you will also get an email receipt.', 'ptp'); ?>
        </div>

    <?php else : ?>

        <h1 class="ptp-h1"><?php esc_html_e("You're booked", 'ptp'); ?></h1>
        <div class="ptp-notice ptp-notice--success">
            <?php esc_html_e('Payment received. A receipt is on its way to your inbox.', 'ptp'); ?>
        </div>

        <div class="ptp-summary">
            <div class="ptp-summary__total">
                <span><?php esc_html_e('Paid', 'ptp'); ?></span>
                <span>$<?php echo esc_html(number_format($order->paid_cents() / 100, 2)); ?></span>
            </div>
        </div>

        <a class="ptp-btn ptp-btn--secondary" href="<?php echo esc_url(PTP_Public_Links::dashboard()); ?>">
            <?php esc_html_e('Go to your account', 'ptp'); ?>
        </a>

    <?php endif; ?>
</div>
