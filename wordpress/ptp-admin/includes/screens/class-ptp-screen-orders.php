<?php
/**
 * Orders.
 *
 * One order list for camps, training and clinics. The old platform had three
 * separate order screens over two order tables, which is why revenue never
 * reconciled.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Screen_Orders extends PTP_Screen
{
    public function title(): string
    {
        return __('Orders', 'ptp');
    }

    protected function body(): void
    {
        $status = isset($_GET['status']) ? sanitize_key(wp_unslash($_GET['status'])) : 'paid';
        $orders = $this->orders($status);
        ?>
        <ul class="subsubsub">
            <?php foreach (['paid' => __('Paid', 'ptp'), 'pending' => __('Pending', 'ptp'), 'underpaid' => __('Needs review', 'ptp')] as $key => $label) : ?>
                <li>
                    <a href="<?php echo esc_url(admin_url('admin.php?page=ptp-orders&status=' . $key)); ?>"
                       class="<?php echo $status === $key ? 'current' : ''; ?>">
                        <?php echo esc_html($label); ?>
                    </a>
                </li>
            <?php endforeach; ?>
        </ul>

        <?php if (empty($orders)) : ?>
            <?php $this->empty_state(__('No orders with this status.', 'ptp')); ?>
        <?php else : ?>
            <table class="wp-list-table widefat fixed striped">
                <thead>
                    <tr>
                        <th><?php esc_html_e('Order', 'ptp'); ?></th>
                        <th><?php esc_html_e('Customer', 'ptp'); ?></th>
                        <th><?php esc_html_e('Quoted', 'ptp'); ?></th>
                        <th><?php esc_html_e('Paid', 'ptp'); ?></th>
                        <th><?php esc_html_e('Date', 'ptp'); ?></th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($orders as $order) : ?>
                        <tr>
                            <td>#<?php echo esc_html((string) $order->id); ?></td>
                            <td><?php echo esc_html(trim($order->first_name . ' ' . $order->last_name)); ?></td>
                            <td><?php echo esc_html($this->money((int) $order->total_cents)); ?></td>
                            <td><?php echo esc_html($this->money((int) $order->paid_cents)); ?></td>
                            <td><?php echo esc_html(mysql2date(get_option('date_format'), $order->created_at)); ?></td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        <?php endif; ?>
        <?php
    }

    /** @return array<int, object> */
    private function orders(string $status): array
    {
        global $wpdb;

        return $wpdb->get_results(
            $wpdb->prepare(
                'SELECT o.*, p.first_name, p.last_name FROM ' . PTP_Schema::table('orders') . ' o'
                . ' LEFT JOIN ' . PTP_Schema::table('parents') . ' p ON p.id = o.parent_id'
                . ' WHERE o.status = %s ORDER BY o.created_at DESC LIMIT 100',
                $status
            )
        ) ?: [];
    }
}
