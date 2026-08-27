<?php
/**
 * Trainer portal.
 *
 * @var array<string, mixed> $data
 *
 * Ordered by what a trainer needs when they open it: today's sessions, money,
 * sessions still to confirm, then the weekly availability chore.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!empty($data['requires_login'])) : ?>
    <div class="ptp ptp-container ptp-container--narrow">
        <div class="ptp-notice">
            <?php
            printf(
                /* translators: %s: log in link */
                esc_html__('Please %s with your trainer account.', 'ptp'),
                '<a href="' . esc_url($data['login_url']) . '">' . esc_html__('log in', 'ptp') . '</a>'
            );
            ?>
        </div>
    </div>
    <?php return;
endif;

$earnings = $data['earnings'];
$actions  = $data['actions'];
?>
<div class="ptp ptp-container ptp-stack ptp-stack--loose">
    <h1 class="ptp-h1"><?php esc_html_e('Your schedule', 'ptp'); ?></h1>

    <!-- Today -->
    <section class="ptp-panel">
        <h2 class="ptp-panel__title"><?php esc_html_e('Today', 'ptp'); ?></h2>

        <?php if (empty($data['today'])) : ?>
            <p class="ptp-empty"><?php esc_html_e('Nothing scheduled today.', 'ptp'); ?></p>
        <?php else : ?>
            <ul class="ptp-list">
                <?php foreach ($data['today'] as $booking) : ?>
                    <li class="ptp-list__item">
                        <div>
                            <strong><?php echo esc_html(date_i18n(get_option('time_format'), strtotime($booking->starts_at))); ?></strong>
                            <?php if (!empty($booking->location)) : ?>
                                <span class="ptp-muted">&middot; <?php echo esc_html($booking->location); ?></span>
                            <?php endif; ?>
                        </div>
                        <span class="ptp-badge"><?php echo esc_html($booking->status); ?></span>
                    </li>
                <?php endforeach; ?>
            </ul>
        <?php endif; ?>
    </section>

    <!-- Earnings -->
    <section class="ptp-panel">
        <h2 class="ptp-panel__title"><?php esc_html_e('Earnings', 'ptp'); ?></h2>

        <div class="ptp-stats">
            <div class="ptp-stat">
                <span class="ptp-stat__value">$<?php echo esc_html(number_format($earnings['clearing_cents'] / 100, 2)); ?></span>
                <span class="ptp-stat__label"><?php esc_html_e('Ready to pay out', 'ptp'); ?></span>
            </div>
            <div class="ptp-stat">
                <span class="ptp-stat__value">$<?php echo esc_html(number_format($earnings['pending_cents'] / 100, 2)); ?></span>
                <span class="ptp-stat__label"><?php esc_html_e('Pending sessions', 'ptp'); ?></span>
            </div>
            <div class="ptp-stat">
                <span class="ptp-stat__value">$<?php echo esc_html(number_format($earnings['paid_cents'] / 100, 2)); ?></span>
                <span class="ptp-stat__label"><?php esc_html_e('Paid to date', 'ptp'); ?></span>
            </div>
        </div>

        <?php if ((int) $earnings['rate_cents'] > 0) : ?>
            <p class="ptp-muted">
                <?php
                printf(
                    /* translators: 1: amount, 2: "session" or "hour" */
                    esc_html__('You earn %1$s per %2$s.', 'ptp'),
                    esc_html('$' . number_format($earnings['rate_cents'] / 100, 2)),
                    esc_html($earnings['rate_basis'] === 'hour' ? __('hour', 'ptp') : __('session', 'ptp'))
                );
                ?>
            </p>
        <?php else : ?>
            <p class="ptp-muted">
                <?php esc_html_e('Your rate has not been set yet — we will sort that before your first payout.', 'ptp'); ?>
            </p>
        <?php endif; ?>

        <?php if (empty($earnings['connected'])) : ?>
            <div class="ptp-notice">
                <p><?php esc_html_e('Connect a payout account to receive your earnings. We never see your bank details — Stripe handles it.', 'ptp'); ?></p>
                <button
                    class="ptp-btn ptp-btn--primary js-ptp-action"
                    type="button"
                    data-action="<?php echo esc_attr($actions['connect']['action']); ?>"
                    data-nonce="<?php echo esc_attr($actions['connect']['nonce']); ?>">
                    <?php esc_html_e('Set up payouts', 'ptp'); ?>
                </button>
            </div>
        <?php endif; ?>
    </section>

    <!-- Sessions awaiting confirmation -->
    <?php if (!empty($data['to_complete'])) : ?>
        <section class="ptp-panel">
            <h2 class="ptp-panel__title"><?php esc_html_e('Mark as delivered', 'ptp'); ?></h2>
            <p class="ptp-muted"><?php esc_html_e('Confirming a session releases your payout for it.', 'ptp'); ?></p>

            <ul class="ptp-list">
                <?php foreach ($data['to_complete'] as $booking) : ?>
                    <li class="ptp-list__item">
                        <span>
                            <?php echo esc_html(date_i18n(get_option('date_format') . ', g:ia', strtotime($booking->starts_at))); ?>
                        </span>
                        <button
                            class="ptp-btn ptp-btn--primary js-ptp-action"
                            type="button"
                            data-action="<?php echo esc_attr($actions['complete']['action']); ?>"
                            data-nonce="<?php echo esc_attr($actions['complete']['nonce']); ?>"
                            data-field-booking_id="<?php echo esc_attr((string) $booking->id); ?>"
                            data-reload="1">
                            <?php esc_html_e('Delivered', 'ptp'); ?>
                        </button>
                    </li>
                <?php endforeach; ?>
            </ul>
        </section>
    <?php endif; ?>

    <!-- Upcoming -->
    <section class="ptp-panel">
        <h2 class="ptp-panel__title"><?php esc_html_e('Coming up', 'ptp'); ?></h2>

        <?php if (empty($data['upcoming'])) : ?>
            <p class="ptp-empty"><?php esc_html_e('No sessions booked yet.', 'ptp'); ?></p>
        <?php else : ?>
            <ul class="ptp-list">
                <?php foreach ($data['upcoming'] as $booking) : ?>
                    <li class="ptp-list__item">
                        <span><?php echo esc_html(date_i18n(get_option('date_format') . ', g:ia', strtotime($booking->starts_at))); ?></span>
                        <span class="ptp-muted"><?php echo esc_html((string) $booking->location); ?></span>
                    </li>
                <?php endforeach; ?>
            </ul>
        <?php endif; ?>
    </section>

    <!-- Weekly availability -->
    <section class="ptp-panel">
        <h2 class="ptp-panel__title"><?php esc_html_e('When you coach', 'ptp'); ?></h2>
        <p class="ptp-muted"><?php esc_html_e('Parents can only book inside these windows.', 'ptp'); ?></p>

        <?php if (empty($data['rules'])) : ?>
            <p class="ptp-empty"><?php esc_html_e('No availability set — nobody can book you yet.', 'ptp'); ?></p>
        <?php else : ?>
            <ul class="ptp-list">
                <?php foreach ($data['rules'] as $rule) : ?>
                    <li class="ptp-list__item">
                        <div>
                            <strong><?php echo esc_html($data['weekdays'][(int) $rule->weekday] ?? ''); ?></strong>
                            <span class="ptp-muted">
                                <?php echo esc_html(substr((string) $rule->starts_time, 0, 5)); ?>–<?php echo esc_html(substr((string) $rule->ends_time, 0, 5)); ?>
                                &middot; <?php echo esc_html((string) $rule->slot_minutes); ?><?php esc_html_e('min slots', 'ptp'); ?>
                                <?php if (!empty($rule->location)) : ?>
                                    &middot; <?php echo esc_html($rule->location); ?>
                                <?php endif; ?>
                            </span>
                        </div>
                        <button
                            class="ptp-btn ptp-btn--ghost js-ptp-action"
                            type="button"
                            data-action="<?php echo esc_attr($actions['dropRule']['action']); ?>"
                            data-nonce="<?php echo esc_attr($actions['dropRule']['nonce']); ?>"
                            data-field-rule_id="<?php echo esc_attr((string) $rule->id); ?>"
                            data-confirm="<?php esc_attr_e('Remove this availability?', 'ptp'); ?>"
                            data-reload="1">
                            <?php esc_html_e('Remove', 'ptp'); ?>
                        </button>
                    </li>
                <?php endforeach; ?>
            </ul>
        <?php endif; ?>

        <form class="ptp-availability-form" id="ptp-add-availability">
            <label class="ptp-field">
                <span class="ptp-field__label"><?php esc_html_e('Day', 'ptp'); ?></span>
                <select class="ptp-field__select" id="ptp-av-weekday">
                    <?php foreach ($data['weekdays'] as $index => $label) : ?>
                        <option value="<?php echo esc_attr((string) $index); ?>"><?php echo esc_html($label); ?></option>
                    <?php endforeach; ?>
                </select>
            </label>

            <label class="ptp-field">
                <span class="ptp-field__label"><?php esc_html_e('From', 'ptp'); ?></span>
                <input class="ptp-field__input" type="time" id="ptp-av-start" value="16:00">
            </label>

            <label class="ptp-field">
                <span class="ptp-field__label"><?php esc_html_e('To', 'ptp'); ?></span>
                <input class="ptp-field__input" type="time" id="ptp-av-end" value="20:00">
            </label>

            <label class="ptp-field">
                <span class="ptp-field__label"><?php esc_html_e('Session length', 'ptp'); ?></span>
                <select class="ptp-field__select" id="ptp-av-minutes">
                    <option value="30">30 <?php esc_html_e('min', 'ptp'); ?></option>
                    <option value="45">45 <?php esc_html_e('min', 'ptp'); ?></option>
                    <option value="60" selected>60 <?php esc_html_e('min', 'ptp'); ?></option>
                    <option value="90">90 <?php esc_html_e('min', 'ptp'); ?></option>
                </select>
            </label>

            <label class="ptp-field">
                <span class="ptp-field__label"><?php esc_html_e('Where', 'ptp'); ?></span>
                <input class="ptp-field__input" type="text" id="ptp-av-location" placeholder="<?php esc_attr_e('Riverside Park', 'ptp'); ?>">
            </label>

            <button
                class="ptp-btn ptp-btn--secondary js-ptp-action"
                type="button"
                id="ptp-av-submit"
                data-action="<?php echo esc_attr($actions['addRule']['action']); ?>"
                data-nonce="<?php echo esc_attr($actions['addRule']['nonce']); ?>"
                data-reload="1">
                <?php esc_html_e('Add availability', 'ptp'); ?>
            </button>
        </form>
    </section>
</div>

<script>
/**
 * Copy the availability form's values onto the submit button's data-field-*
 * attributes just before the shared portal handler reads them. Keeps one
 * generic AJAX path rather than a second bespoke script.
 */
document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('#ptp-av-submit');
    if (!button) { return; }

    var value = function (id) {
        var node = document.getElementById(id);
        return node ? node.value : '';
    };

    button.dataset.fieldWeekday = value('ptp-av-weekday');
    button.dataset.fieldStarts_time = value('ptp-av-start');
    button.dataset.fieldEnds_time = value('ptp-av-end');
    button.dataset.fieldSlot_minutes = value('ptp-av-minutes');
    button.dataset.fieldLocation = value('ptp-av-location');
}, true);
</script>
