<?php
/**
 * Camp listing.
 *
 * @var array<string, mixed> $data
 */

if (!defined('ABSPATH')) {
    exit;
}
?>
<div class="ptp ptp-container">
    <h1 class="ptp-h1"><?php esc_html_e('Camps', 'ptp'); ?></h1>

    <?php if (empty($data['camps'])) : ?>
        <p class="ptp-empty"><?php esc_html_e('No camps are open for registration right now. Check back soon.', 'ptp'); ?></p>
    <?php else : ?>
        <div class="ptp-grid">
            <?php foreach ($data['camps'] as $camp) : ?>
                <?php
                $seats = PTP_Camps_Catalogue::seats_remaining((int) $camp->ID);
                $price = PTP_Camps_Catalogue::price_cents((int) $camp->ID);
                ?>
                <article class="ptp-card">
                    <?php if (has_post_thumbnail($camp)) : ?>
                        <?php echo get_the_post_thumbnail($camp, 'medium_large', ['class' => 'ptp-card__media', 'loading' => 'lazy']); ?>
                    <?php endif; ?>

                    <div class="ptp-card__body ptp-stack">
                        <?php if ($seats === 0) : ?>
                            <span class="ptp-badge ptp-badge--sold-out"><?php esc_html_e('Sold out', 'ptp'); ?></span>
                        <?php elseif ($seats <= 5) : ?>
                            <span class="ptp-badge ptp-badge--low">
                                <?php
                                printf(
                                    /* translators: %d: number of remaining places */
                                    esc_html(_n('%d place left', '%d places left', $seats, 'ptp')),
                                    (int) $seats
                                );
                                ?>
                            </span>
                        <?php endif; ?>

                        <h2 class="ptp-h3"><?php echo esc_html(get_the_title($camp)); ?></h2>
                        <p class="ptp-muted"><?php echo esc_html(get_post_meta($camp->ID, '_ptp_location', true)); ?></p>
                    </div>

                    <div class="ptp-card__footer">
                        <span class="ptp-price">$<?php echo esc_html(number_format($price / 100, 0)); ?></span>
                        <a class="ptp-btn ptp-btn--primary" href="<?php echo esc_url((string) get_permalink($camp)); ?>">
                            <?php esc_html_e('Details', 'ptp'); ?>
                        </a>
                    </div>
                </article>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>
</div>
