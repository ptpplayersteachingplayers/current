<?php
/**
 * Checkout view.
 *
 * @var array<string, mixed> $data
 *
 * The summary is rendered empty and filled from the server's quote response.
 * No price is ever written into the markup by the client, and no price posted
 * by the client is ever read back — the totals shown here always originate
 * from PTP_Pricing.
 */

if (!defined('ABSPATH')) {
    exit;
}
?>
<div class="ptp ptp-container">
    <h1 class="ptp-h1"><?php esc_html_e('Checkout', 'ptp'); ?></h1>

    <?php if ($data['is_guest']) : ?>
        <div class="ptp-notice">
            <?php
            printf(
                /* translators: %s: login link */
                esc_html__('Already have an account? %s to check out faster.', 'ptp'),
                '<a href="' . esc_url($data['login_url']) . '">' . esc_html__('Log in', 'ptp') . '</a>'
            );
            ?>
        </div>
    <?php endif; ?>

    <div class="ptp-checkout">
        <div class="ptp-stack">
            <section class="ptp-panel" aria-labelledby="ptp-who">
                <h2 class="ptp-panel__title" id="ptp-who"><?php esc_html_e('Who is attending', 'ptp'); ?></h2>

                <?php if (empty($data['players'])) : ?>
                    <p class="ptp-muted"><?php esc_html_e('Add a player during booking.', 'ptp'); ?></p>
                <?php else : ?>
                    <label class="ptp-field">
                        <span class="ptp-field__label"><?php esc_html_e('Player', 'ptp'); ?></span>
                        <select class="ptp-field__select" name="player_id" id="ptp-player">
                            <?php foreach ($data['players'] as $player) : ?>
                                <option value="<?php echo esc_attr((string) $player->id); ?>">
                                    <?php echo esc_html(trim($player->first_name . ' ' . $player->last_name)); ?>
                                </option>
                            <?php endforeach; ?>
                        </select>
                    </label>
                <?php endif; ?>
            </section>

            <section class="ptp-panel" aria-labelledby="ptp-pay">
                <h2 class="ptp-panel__title" id="ptp-pay"><?php esc_html_e('Payment', 'ptp'); ?></h2>
                <div id="ptp-payment-element"></div>
                <p class="ptp-field__error" id="ptp-payment-error" role="alert" hidden></p>
            </section>
        </div>

        <aside class="ptp-summary" aria-labelledby="ptp-summary-title">
            <h2 class="ptp-panel__title" id="ptp-summary-title"><?php esc_html_e('Order summary', 'ptp'); ?></h2>

            <div id="ptp-summary-lines"></div>

            <label class="ptp-field">
                <span class="ptp-field__label"><?php esc_html_e('Discount code', 'ptp'); ?></span>
                <input class="ptp-field__input" type="text" id="ptp-discount" autocomplete="off">
            </label>

            <div class="ptp-summary__total">
                <span><?php esc_html_e('Total', 'ptp'); ?></span>
                <span id="ptp-total">&mdash;</span>
            </div>

            <div class="ptp-checkout__actions">
                <button class="ptp-btn ptp-btn--primary ptp-btn--block" id="ptp-pay-button" type="button">
                    <?php esc_html_e('Pay now', 'ptp'); ?>
                </button>
            </div>
        </aside>
    </div>
</div>
