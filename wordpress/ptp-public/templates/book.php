<?php
/**
 * Training booking page.
 *
 * @var array<string, mixed> $data
 *
 * Three steps in one screen: trainer, then time, then who. The slot list is
 * fetched from the server and rendered from its response — no price or duration
 * is written into this markup for the browser to send back.
 */

if (!defined('ABSPATH')) {
    exit;
}
?>
<div class="ptp ptp-container ptp-stack--loose ptp-stack">
    <h1 class="ptp-h1"><?php esc_html_e('Book a session', 'ptp'); ?></h1>

    <?php if ($data['is_guest']) : ?>
        <div class="ptp-notice">
            <?php
            printf(
                /* translators: %s: log in link */
                esc_html__('Browse times below — you will need to %s before confirming.', 'ptp'),
                '<a href="' . esc_url($data['login_url']) . '">' . esc_html__('log in', 'ptp') . '</a>'
            );
            ?>
        </div>
    <?php endif; ?>

    <section class="ptp-panel" aria-labelledby="ptp-step-trainer">
        <h2 class="ptp-panel__title" id="ptp-step-trainer"><?php esc_html_e('1. Choose a trainer', 'ptp'); ?></h2>

        <?php if (empty($data['trainers'])) : ?>
            <p class="ptp-empty"><?php esc_html_e('No trainers are taking bookings right now.', 'ptp'); ?></p>
        <?php else : ?>
            <label class="ptp-field">
                <span class="ptp-visually-hidden"><?php esc_html_e('Trainer', 'ptp'); ?></span>
                <select class="ptp-field__select" id="ptp-trainer">
                    <option value=""><?php esc_html_e('Select a trainer…', 'ptp'); ?></option>
                    <?php foreach ($data['trainers'] as $trainer) : ?>
                        <option
                            value="<?php echo esc_attr((string) $trainer->id); ?>"
                            <?php selected((int) $data['trainer_id'], (int) $trainer->id); ?>>
                            <?php echo esc_html($trainer->display_name); ?>
                            &mdash; $<?php echo esc_html(number_format(((int) $trainer->hourly_cents) / 100, 0)); ?>/hr
                        </option>
                    <?php endforeach; ?>
                </select>
            </label>
        <?php endif; ?>
    </section>

    <section class="ptp-panel" aria-labelledby="ptp-step-time">
        <h2 class="ptp-panel__title" id="ptp-step-time"><?php esc_html_e('2. Pick a time', 'ptp'); ?></h2>

        <p class="ptp-muted">
            <?php
            printf(
                /* translators: %d: number of days bookable ahead */
                esc_html__('Showing the next %d days.', 'ptp'),
                (int) $data['horizon']
            );
            ?>
        </p>

        <div id="ptp-slots" class="ptp-slots" aria-live="polite">
            <p class="ptp-empty"><?php esc_html_e('Choose a trainer to see available times.', 'ptp'); ?></p>
        </div>
    </section>

    <section class="ptp-panel" aria-labelledby="ptp-step-player">
        <h2 class="ptp-panel__title" id="ptp-step-player"><?php esc_html_e('3. Who is training?', 'ptp'); ?></h2>

        <?php if (empty($data['players'])) : ?>
            <p class="ptp-muted"><?php esc_html_e('You can add your player details at checkout.', 'ptp'); ?></p>
        <?php else : ?>
            <label class="ptp-field">
                <span class="ptp-visually-hidden"><?php esc_html_e('Player', 'ptp'); ?></span>
                <select class="ptp-field__select" id="ptp-player">
                    <?php foreach ($data['players'] as $player) : ?>
                        <option value="<?php echo esc_attr((string) $player->id); ?>">
                            <?php echo esc_html(trim($player->first_name . ' ' . $player->last_name)); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
            </label>
        <?php endif; ?>

        <p class="ptp-field__error" id="ptp-book-error" role="alert" hidden></p>

        <button class="ptp-btn ptp-btn--primary ptp-btn--block" id="ptp-book-continue" type="button" disabled aria-disabled="true">
            <?php esc_html_e('Continue to payment', 'ptp'); ?>
        </button>
    </section>
</div>
