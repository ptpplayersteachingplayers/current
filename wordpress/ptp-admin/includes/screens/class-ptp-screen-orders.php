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

    /**
     * Cancel a session on the customer's behalf and refund it.
     *
     * Staff cancellations always refund in full, whatever the notice — this is
     * the path for a trainer dropping out, weather, or a venue closing, none of
     * which the customer should pay for.
     */
    protected function do_refund_booking(): void
    {
        $booking_id = isset($_REQUEST['booking']) ? absint($_REQUEST['booking']) : 0;

        if ($booking_id <= 0) {
            return;
        }

        try {
            $result = ptp_core()->bookings()->cancel(
                ptp_core()->guard()->current_actor(),
                $booking_id
            );
        } catch (PTP_Repository_Exception $e) {
            $this->notice($e->getMessage(), 'error');

            return;
        }

        $this->notice(
            sprintf(
                /* translators: 1: refund amount, 2: yes/no for the trainer payout */
                __('Cancelled. Refunded %1$s. Trainer payout %2$s.', 'ptp'),
                $this->money($result['refunded_cents']),
                $result['payout_reversed'] ? __('withheld', 'ptp') : __('unchanged', 'ptp')
            )
        );
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
                        <th><?php esc_html_e('Refunded', 'ptp'); ?></th>
                        <th><?php esc_html_e('Date', 'ptp'); ?></th>
                        <th><?php esc_html_e('Sessions', 'ptp'); ?></th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($orders as $order) : ?>
                        <tr>
                            <td>#<?php echo esc_html((string) $order->id); ?></td>
                            <td><?php echo esc_html(trim($order->first_name . ' ' . $order->last_name)); ?></td>
                            <td><?php echo esc_html($this->money((int) $order->total_cents)); ?></td>
                            <td><?php echo esc_html($this->money((int) $order->paid_cents)); ?></td>
                            <td>
                                <?php if ((int) $order->refunded_cents > 0) : ?>
                                    <strong><?php echo esc_html($this->money((int) $order->refunded_cents)); ?></strong>
                                <?php else : ?>
                                    &mdash;
                                <?php endif; ?>
                            </td>
                            <td><?php echo esc_html(mysql2date(get_option('date_format'), $order->created_at)); ?></td>
                            <td><?php $this->render_bookings((int) $order->id); ?></td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        <?php endif; ?>
        <?php
    }

    /**
     * The sessions on an order, each with a cancel-and-refund action.
     *
     * Listed per session rather than per order because an order can carry
     * several, and cancelling one should not refund the rest.
     */
    private function render_bookings(int $order_id): void
    {
        global $wpdb;

        $bookings = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM ' . PTP_Schema::table('bookings') . ' WHERE order_id = %d ORDER BY starts_at ASC',
                $order_id
            )
        ) ?: [];

        if ($bookings === []) {
            echo '&mdash;';

            return;
        }

        echo '<ul class="ptp-admin__bookings">';

        foreach ($bookings as $booking) {
            printf(
                '<li><span>%s</span> <span class="ptp-admin__pill">%s</span> ',
                esc_html(mysql2date(get_option('date_format') . ' g:ia', $booking->starts_at)),
                esc_html($booking->status)
            );

            if (!in_array($booking->status, ['cancelled', 'completed'], true)) {
                printf(
                    '<a class="button button-small" href="%s">%s</a>',
                    esc_url($this->action_url('refund_booking', ['booking' => (int) $booking->id, 'status' => 'paid'])),
                    esc_html__('Cancel & refund', 'ptp')
                );
            }

            echo '</li>';
        }

        echo '</ul>';
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
