<?php
/**
 * Parent dashboard.
 *
 * @var array<string, mixed> $data
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!empty($data['requires_login'])) : ?>
    <div class="ptp ptp-container ptp-container--narrow">
        <div class="ptp-notice">
            <?php
            printf(
                esc_html__('Please %s to see your bookings.', 'ptp'),
                '<a href="' . esc_url($data['login_url']) . '">' . esc_html__('log in', 'ptp') . '</a>'
            );
            ?>
        </div>
    </div>
    <?php return;
endif; ?>

<div class="ptp ptp-container ptp-stack--loose ptp-stack">
    <h1 class="ptp-h1"><?php esc_html_e('Your account', 'ptp'); ?></h1>

    <section class="ptp-panel">
        <h2 class="ptp-panel__title"><?php esc_html_e('Upcoming sessions', 'ptp'); ?></h2>

        <?php if (empty($data['bookings'])) : ?>
            <div class="ptp-empty ptp-stack">
                <p><?php esc_html_e('Nothing booked yet.', 'ptp'); ?></p>
                <a class="ptp-btn ptp-btn--primary" href="<?php echo esc_url($data['book_url']); ?>">
                    <?php esc_html_e('Book a session', 'ptp'); ?>
                </a>
            </div>
        <?php else : ?>
            <ul class="ptp-list">
                <?php foreach ($data['bookings'] as $booking) : ?>
                    <li class="ptp-list__item">
                        <div>
                            <strong><?php echo esc_html(ucfirst((string) $booking->booking_type)); ?></strong><br>
                            <span class="ptp-muted">
                                <?php echo esc_html(mysql2date(get_option('date_format') . ', g:ia', $booking->starts_at)); ?>
                                <?php if (!empty($booking->location)) : ?>
                                    &middot; <?php echo esc_html($booking->location); ?>
                                <?php endif; ?>
                            </span>
                        </div>
                        <button
                            class="ptp-btn ptp-btn--ghost js-ptp-action"
                            type="button"
                            data-action="<?php echo esc_attr($data['cancel_action']); ?>"
                            data-nonce="<?php echo esc_attr($data['cancel_nonce']); ?>"
                            data-field-booking_id="<?php echo esc_attr((string) $booking->id); ?>"
                            data-confirm="<?php echo esc_attr($data['policy']->describe((string) $booking->starts_at) . ' ' . __('Cancel this session?', 'ptp')); ?>"
                            data-reload="1">
                            <?php esc_html_e('Cancel', 'ptp'); ?>
                        </button>
                    </li>
                <?php endforeach; ?>
            </ul>
        <?php endif; ?>
    </section>

    <section class="ptp-panel">
        <h2 class="ptp-panel__title"><?php esc_html_e('Players', 'ptp'); ?></h2>

        <?php if (empty($data['players'])) : ?>
            <p class="ptp-empty"><?php esc_html_e('No players added yet.', 'ptp'); ?></p>
        <?php else : ?>
            <ul class="ptp-list">
                <?php foreach ($data['players'] as $player) : ?>
                    <li class="ptp-list__item">
                        <span><?php echo esc_html(trim($player->first_name . ' ' . $player->last_name)); ?></span>
                        <span class="ptp-muted"><?php echo esc_html((string) $player->position); ?></span>
                    </li>
                <?php endforeach; ?>
            </ul>
        <?php endif; ?>
    </section>

    <section class="ptp-panel">
        <h2 class="ptp-panel__title"><?php esc_html_e('Order history', 'ptp'); ?></h2>

        <?php if (empty($data['orders'])) : ?>
            <p class="ptp-empty"><?php esc_html_e('No orders yet.', 'ptp'); ?></p>
        <?php else : ?>
            <ul class="ptp-list">
                <?php foreach ($data['orders'] as $order) : ?>
                    <li class="ptp-list__item">
                        <span class="ptp-muted"><?php echo esc_html(mysql2date(get_option('date_format'), $order->created_at)); ?></span>
                        <strong>$<?php echo esc_html(number_format(((int) $order->total_cents) / 100, 2)); ?></strong>
                    </li>
                <?php endforeach; ?>
            </ul>
        <?php endif; ?>
    </section>
</div>
