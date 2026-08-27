<?php
/**
 * Landing funnel template.
 *
 * @var array<string, mixed> $data
 */

if (!defined('ABSPATH')) {
    exit;
}
?>
<section class="ptp ptp-landing ptp-landing--<?php echo esc_attr($data['variant']); ?>">
    <div class="ptp-container ptp-container--narrow ptp-stack">
        <?php if ($data['headline'] !== '') : ?>
            <h1 class="ptp-h1 ptp-landing__headline"><?php echo esc_html($data['headline']); ?></h1>
        <?php endif; ?>

        <?php if ($data['subhead'] !== '') : ?>
            <p class="ptp-landing__subhead"><?php echo esc_html($data['subhead']); ?></p>
        <?php endif; ?>

        <a class="ptp-btn ptp-btn--primary ptp-btn--block" href="<?php echo esc_url($data['cta_url']); ?>">
            <?php echo esc_html($data['cta']); ?>
        </a>
    </div>
</section>
