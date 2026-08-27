<?php
/**
 * Today — the landing screen.
 *
 * Answers the only questions that matter first thing: what is happening today,
 * what money came in, what needs a human. Replaces a 7,283-line dashboard that
 * tried to be a reporting suite.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Screen_Today extends PTP_Screen
{
    public function title(): string
    {
        return __('Today', 'ptp');
    }

    public function menu_label(): string
    {
        return __('Today', 'ptp');
    }

    protected function body(): void
    {
        $stats = $this->stats();
        ?>
        <div class="ptp-admin__stats">
            <?php
            $this->stat(__('Sessions today', 'ptp'), (string) $stats['sessions_today']);
            $this->stat(__('Paid orders (7d)', 'ptp'), (string) $stats['orders_week']);
            $this->stat(__('Revenue (7d)', 'ptp'), $this->money($stats['revenue_week_cents']));
            $this->stat(__('Needs attention', 'ptp'), (string) $stats['needs_attention'], $stats['needs_attention'] > 0 ? 'warn' : '');
            ?>
        </div>

        <?php if ($stats['needs_attention'] > 0) : ?>
            <div class="notice notice-warning">
                <p>
                    <?php
                    printf(
                        /* translators: %d: count of orders requiring review */
                        esc_html(_n('%d order needs review — payment did not match the quoted total.', '%d orders need review — payment did not match the quoted total.', $stats['needs_attention'], 'ptp')),
                        (int) $stats['needs_attention']
                    );
                    ?>
                    <a href="<?php echo esc_url(admin_url('admin.php?page=ptp-orders&status=underpaid')); ?>">
                        <?php esc_html_e('Review', 'ptp'); ?>
                    </a>
                </p>
            </div>
        <?php endif; ?>
        <?php
    }

    private function stat(string $label, string $value, string $modifier = ''): void
    {
        printf(
            '<div class="ptp-admin__stat %s"><span class="ptp-admin__stat-value">%s</span><span class="ptp-admin__stat-label">%s</span></div>',
            $modifier ? esc_attr('ptp-admin__stat--' . $modifier) : '',
            esc_html($value),
            esc_html($label)
        );
    }

    /** @return array{sessions_today: int, orders_week: int, revenue_week_cents: int, needs_attention: int} */
    private function stats(): array
    {
        global $wpdb;

        $week = gmdate('Y-m-d H:i:s', time() - WEEK_IN_SECONDS);

        return [
            'sessions_today' => (int) $wpdb->get_var(
                $wpdb->prepare(
                    'SELECT COUNT(*) FROM ' . PTP_Schema::table('bookings') . ' WHERE DATE(starts_at) = %s AND status != %s',
                    current_time('Y-m-d'),
                    'cancelled'
                )
            ),
            'orders_week' => (int) $wpdb->get_var(
                $wpdb->prepare(
                    'SELECT COUNT(*) FROM ' . PTP_Schema::table('orders') . ' WHERE status = %s AND paid_at >= %s',
                    'paid',
                    $week
                )
            ),
            'revenue_week_cents' => (int) $wpdb->get_var(
                $wpdb->prepare(
                    'SELECT COALESCE(SUM(paid_cents), 0) FROM ' . PTP_Schema::table('orders') . ' WHERE status = %s AND paid_at >= %s',
                    'paid',
                    $week
                )
            ),
            'needs_attention' => (int) $wpdb->get_var(
                $wpdb->prepare(
                    'SELECT COUNT(*) FROM ' . PTP_Schema::table('orders') . ' WHERE status = %s',
                    'underpaid'
                )
            ),
        ];
    }
}
