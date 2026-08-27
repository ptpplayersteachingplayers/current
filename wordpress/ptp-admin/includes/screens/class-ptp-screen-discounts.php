<?php
/**
 * Discounts screen.
 *
 * Scaffolded during the rebuild. See MIGRATION.md for the old screens this
 * consolidates and the order to port them in.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Screen_Discounts extends PTP_Screen
{
    public function title(): string
    {
        return __('Discounts', 'ptp');
    }

    protected function body(): void
    {
        $this->empty_state(__('This screen is being rebuilt.', 'ptp'));
    }
}
