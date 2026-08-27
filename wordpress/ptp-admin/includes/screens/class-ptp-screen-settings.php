<?php
/**
 * Settings.
 *
 * Credentials are shown masked and are only written when a new value is typed,
 * so an existing secret is never rendered into the page source. The old clinic
 * settings page printed the live Stripe secret key into a type="text" input.
 *
 * Keys defined as constants in wp-config.php take precedence and are reported
 * here as managed, which keeps production secrets out of the database entirely.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Screen_Settings extends PTP_Screen
{
    private const FIELDS = [
        'ptp_stripe_publishable_key' => ['label' => 'Stripe publishable key', 'secret' => false, 'constant' => 'PTP_STRIPE_PUBLISHABLE_KEY'],
        'ptp_stripe_secret_key'      => ['label' => 'Stripe secret key', 'secret' => true, 'constant' => 'PTP_STRIPE_SECRET_KEY'],
        'ptp_stripe_webhook_secret'  => ['label' => 'Stripe webhook signing secret', 'secret' => true, 'constant' => 'PTP_STRIPE_WEBHOOK_SECRET'],
    ];

    public function title(): string
    {
        return __('Settings', 'ptp');
    }

    protected function do_save_settings(): void
    {
        foreach (self::FIELDS as $option => $meta) {
            if (!isset($_POST[$option])) {
                continue;
            }

            $value = sanitize_text_field(wp_unslash($_POST[$option]));

            // Blank means "leave as is" for secrets, so a masked field that is
            // submitted untouched cannot wipe a working key.
            if ($meta['secret'] && $value === '') {
                continue;
            }

            update_option($option, $value, false);
        }

        $this->notice(__('Settings saved.', 'ptp'));
    }

    protected function body(): void
    {
        ?>
        <form method="post" action="<?php echo esc_url($this->action_url('save_settings')); ?>">
            <table class="form-table" role="presentation">
                <tbody>
                <?php foreach (self::FIELDS as $option => $meta) : ?>
                    <?php $managed = defined($meta['constant']) && constant($meta['constant']); ?>
                    <tr>
                        <th scope="row">
                            <label for="<?php echo esc_attr($option); ?>"><?php echo esc_html($meta['label']); ?></label>
                        </th>
                        <td>
                            <?php if ($managed) : ?>
                                <p class="description">
                                    <?php
                                    printf(
                                        /* translators: %s: PHP constant name */
                                        esc_html__('Managed in wp-config.php via %s.', 'ptp'),
                                        '<code>' . esc_html($meta['constant']) . '</code>'
                                    );
                                    ?>
                                </p>
                            <?php else : ?>
                                <input
                                    type="<?php echo $meta['secret'] ? 'password' : 'text'; ?>"
                                    class="regular-text"
                                    id="<?php echo esc_attr($option); ?>"
                                    name="<?php echo esc_attr($option); ?>"
                                    autocomplete="off"
                                    value="<?php echo $meta['secret'] ? '' : esc_attr((string) get_option($option, '')); ?>"
                                    placeholder="<?php echo $meta['secret'] && get_option($option) ? esc_attr__('Saved — type to replace', 'ptp') : ''; ?>">
                            <?php endif; ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>

            <?php submit_button(__('Save settings', 'ptp')); ?>
        </form>
        <?php
    }
}
