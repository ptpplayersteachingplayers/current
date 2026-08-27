<?php
/**
 * Trainers — directory and application review.
 *
 * Approval is an explicit staff action here. Applications arrive as 'pending'
 * from the public form and only become bookable through this screen.
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

    /** Nonce-verified by PTP_Screen::handle_actions before this runs. */
    protected function do_approve_trainer(): void
    {
        $id = isset($_GET['trainer']) ? absint($_GET['trainer']) : 0;

        if ($id > 0) {
            ptp_core()->trainers()->set_status($id, 'active');
            $this->notice(__('Trainer approved.', 'ptp'));
        }
    }

    protected function do_archive_trainer(): void
    {
        $id = isset($_GET['trainer']) ? absint($_GET['trainer']) : 0;

        if ($id > 0) {
            ptp_core()->trainers()->set_status($id, 'archived');
            $this->notice(__('Trainer archived.', 'ptp'));
        }
    }

    protected function body(): void
    {
        global $wpdb;

        $trainers = $wpdb->get_results(
            'SELECT * FROM ' . PTP_Schema::table('trainers') . ' ORDER BY FIELD(status, "pending", "active", "paused", "archived"), display_name ASC LIMIT 200'
        ) ?: [];

        if (empty($trainers)) {
            $this->empty_state(__('No trainers yet.', 'ptp'));

            return;
        }
        ?>
        <table class="wp-list-table widefat fixed striped">
            <thead>
                <tr>
                    <th><?php esc_html_e('Name', 'ptp'); ?></th>
                    <th><?php esc_html_e('Status', 'ptp'); ?></th>
                    <th><?php esc_html_e('Actions', 'ptp'); ?></th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($trainers as $trainer) : ?>
                    <tr>
                        <td><?php echo esc_html($trainer->display_name); ?></td>
                        <td><span class="ptp-admin__pill"><?php echo esc_html($trainer->status); ?></span></td>
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
}
