<?php
/**
 * Trainers — directory, application review, and pay rates.
 *
 * This is where each trainer's payout amount is assigned. Trainers are paid a
 * fixed amount set here, not a percentage of what the parent paid, so the two
 * figures move independently: changing what customers are charged does not
 * change what a trainer earns, and vice versa.
 *
 * Approval is an explicit action. Applications arrive as 'pending' from the
 * public form and only become bookable through this screen.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Screen_Trainers extends PTP_Screen
{
    public function title(): string
    {
        return __('Trainers', 'ptp');
    }

    /** All action handlers are nonce-verified by PTP_Screen before they run. */
    protected function do_approve_trainer(): void
    {
        $id = $this->trainer_param();

        if ($id > 0) {
            ptp_core()->trainers()->set_status($id, 'active');
            $this->notice(__('Trainer approved.', 'ptp'));
        }
    }

    protected function do_archive_trainer(): void
    {
        $id = $this->trainer_param();

        if ($id > 0) {
            ptp_core()->trainers()->set_status($id, 'archived');
            $this->notice(__('Trainer archived.', 'ptp'));
        }
    }

    /**
     * Assign what this trainer earns per session, and what parents are charged.
     *
     * Both are entered in dollars and stored in cents. They are separate
     * figures on purpose — the gap between them is the platform's margin.
     */
    protected function do_save_rates(): void
    {
        $id = $this->trainer_param();

        if ($id <= 0) {
            return;
        }

        $charge = $this->dollars_to_cents($_POST['hourly'] ?? '');
        $payout = $this->dollars_to_cents($_POST['payout'] ?? '');
        $basis  = isset($_POST['basis']) ? sanitize_key(wp_unslash($_POST['basis'])) : PTP_Connect::BASIS_SESSION;

        global $wpdb;

        $wpdb->update(
            PTP_Schema::table('trainers'),
            ['hourly_cents' => $charge, 'updated_at' => current_time('mysql', true)],
            ['id' => $id],
            ['%d', '%s'],
            ['%d']
        );

        try {
            ptp_core()->connect()->set_payout_rate($id, $payout, $basis);
        } catch (PTP_Repository_Exception $e) {
            $this->notice($e->getMessage(), 'error');

            return;
        }

        $this->notice(__('Rates saved.', 'ptp'));
    }

    protected function body(): void
    {
        global $wpdb;

        $trainers = $wpdb->get_results(
            'SELECT * FROM ' . PTP_Schema::table('trainers')
            . ' ORDER BY FIELD(status, "pending", "active", "paused", "archived"), display_name ASC LIMIT 200'
        ) ?: [];

        if (empty($trainers)) {
            $this->empty_state(__('No trainers yet.', 'ptp'));

            return;
        }

        $unpriced = array_filter(
            $trainers,
            static fn(object $t) => $t->status === 'active' && (int) $t->payout_cents === 0
        );

        if ($unpriced !== []) {
            printf(
                '<div class="notice notice-warning"><p>%s</p></div>',
                esc_html(
                    sprintf(
                        /* translators: %d: number of trainers without a pay rate */
                        _n(
                            '%d active trainer has no pay rate set and cannot be paid for sessions.',
                            '%d active trainers have no pay rate set and cannot be paid for sessions.',
                            count($unpriced),
                            'ptp'
                        ),
                        count($unpriced)
                    )
                )
            );
        }
        ?>
        <p class="description">
            <?php esc_html_e('"Parent pays" is what a customer is charged per hour. "Trainer earns" is what you pay this trainer. You keep the difference — the two are set independently.', 'ptp'); ?>
        </p>

        <table class="wp-list-table widefat fixed striped">
            <thead>
                <tr>
                    <th><?php esc_html_e('Name', 'ptp'); ?></th>
                    <th><?php esc_html_e('Status', 'ptp'); ?></th>
                    <th style="width:34%"><?php esc_html_e('Rates', 'ptp'); ?></th>
                    <th><?php esc_html_e('Margin (1 hr)', 'ptp'); ?></th>
                    <th><?php esc_html_e('Payouts', 'ptp'); ?></th>
                    <th><?php esc_html_e('Actions', 'ptp'); ?></th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($trainers as $trainer) : ?>
                    <?php
                    $charge = (int) $trainer->hourly_cents;
                    $payout = (int) $trainer->payout_cents;

                    /**
                     * Margin is shown for a one-hour session, where both bases
                     * coincide: an hourly rate covers exactly one hour, and a
                     * flat session amount is paid in full for it. Shorter or
                     * longer sessions diverge, which is why the column says so.
                     */
                    $margin = $charge - $payout;
                    ?>
                    <tr>
                        <td><strong><?php echo esc_html($trainer->display_name); ?></strong></td>
                        <td><span class="ptp-admin__pill"><?php echo esc_html($trainer->status); ?></span></td>

                        <td>
                            <form method="post" action="<?php echo esc_url($this->action_url('save_rates', ['trainer' => (int) $trainer->id])); ?>" class="ptp-admin__rates">
                                <label>
                                    <span><?php esc_html_e('Parent pays /hr', 'ptp'); ?></span>
                                    <input type="number" step="0.01" min="0" name="hourly"
                                           value="<?php echo esc_attr(number_format($charge / 100, 2, '.', '')); ?>">
                                </label>

                                <label>
                                    <span><?php esc_html_e('Trainer earns', 'ptp'); ?></span>
                                    <input type="number" step="0.01" min="0" name="payout"
                                           value="<?php echo esc_attr(number_format($payout / 100, 2, '.', '')); ?>">
                                </label>

                                <label>
                                    <span><?php esc_html_e('per', 'ptp'); ?></span>
                                    <select name="basis">
                                        <option value="session" <?php selected($trainer->payout_basis, 'session'); ?>>
                                            <?php esc_html_e('session', 'ptp'); ?>
                                        </option>
                                        <option value="hour" <?php selected($trainer->payout_basis, 'hour'); ?>>
                                            <?php esc_html_e('hour', 'ptp'); ?>
                                        </option>
                                    </select>
                                </label>

                                <button class="button button-primary" type="submit"><?php esc_html_e('Save', 'ptp'); ?></button>
                            </form>
                        </td>

                        <td>
                            <?php if ($payout === 0) : ?>
                                <span class="ptp-admin__pill"><?php esc_html_e('not set', 'ptp'); ?></span>
                            <?php else : ?>
                                <strong style="color:<?php echo $margin < 0 ? '#EF4444' : 'inherit'; ?>">
                                    <?php echo esc_html($this->money($margin)); ?>
                                </strong>
                            <?php endif; ?>
                        </td>

                        <td>
                            <?php if (!empty($trainer->stripe_account_id)) : ?>
                                <span class="ptp-admin__pill"><?php esc_html_e('connected', 'ptp'); ?></span>
                            <?php else : ?>
                                <span class="ptp-admin__pill"><?php esc_html_e('not connected', 'ptp'); ?></span>
                            <?php endif; ?>
                        </td>

                        <td>
                            <?php if ($trainer->status === 'pending') : ?>
                                <a class="button button-primary"
                                   href="<?php echo esc_url($this->action_url('approve_trainer', ['trainer' => (int) $trainer->id])); ?>">
                                    <?php esc_html_e('Approve', 'ptp'); ?>
                                </a>
                            <?php endif; ?>

                            <?php if ($trainer->status !== 'archived') : ?>
                                <a class="button"
                                   href="<?php echo esc_url($this->action_url('archive_trainer', ['trainer' => (int) $trainer->id])); ?>">
                                    <?php esc_html_e('Archive', 'ptp'); ?>
                                </a>
                            <?php endif; ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
        <?php
    }

    private function trainer_param(): int
    {
        return isset($_REQUEST['trainer']) ? absint($_REQUEST['trainer']) : 0;
    }

    /**
     * Parse a dollar amount into cents.
     *
     * Rounds rather than truncating, so 49.99 stores 4999 and not 4998 — a cent
     * lost per session compounds quietly across a season.
     */
    private function dollars_to_cents($raw): int
    {
        $value = is_scalar($raw) ? (float) str_replace([',', '$'], '', (string) $raw) : 0.0;

        return max(0, (int) round($value * 100));
    }
}
