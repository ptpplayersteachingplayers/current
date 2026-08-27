<?php
/**
 * Transactional email.
 *
 * Replaces fourteen email files spread across the old plugins. One layout, one
 * send path, one place to change the brand. Recipients are always resolved from
 * a database record — never from a request field — so a request cannot redirect
 * a receipt to an attacker's inbox.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Mail
{
    public function register_hooks(): void
    {
        add_action('ptp_order_paid', [$this, 'send_receipt'], 10, 1);
    }

    public function send_receipt(int $order_id): void
    {
        global $wpdb;

        $row = $wpdb->get_row(
            $wpdb->prepare('SELECT * FROM ' . PTP_Schema::table('orders') . ' WHERE id = %d', $order_id)
        );

        if ($row === null) {
            return;
        }

        $parent = $wpdb->get_row(
            $wpdb->prepare('SELECT * FROM ' . PTP_Schema::table('parents') . ' WHERE id = %d', (int) $row->parent_id)
        );

        if ($parent === null || empty($parent->email)) {
            return;
        }

        $items = $wpdb->get_results(
            $wpdb->prepare('SELECT * FROM ' . PTP_Schema::table('order_items') . ' WHERE order_id = %d', $order_id)
        ) ?: [];

        $this->send(
            (string) $parent->email,
            __('Your PTP receipt', 'ptp'),
            $this->render_receipt($row, $items, $parent)
        );
    }

    /**
     * Send one HTML email.
     *
     * The subject is sanitised of line breaks before it reaches wp_mail, which
     * closes off header injection regardless of where the string originated.
     */
    public function send(string $to, string $subject, string $body_html): bool
    {
        $to      = sanitize_email($to);
        $subject = str_replace(["\r", "\n"], '', wp_strip_all_tags($subject));

        if ($to === '') {
            return false;
        }

        return wp_mail(
            $to,
            $subject,
            $this->layout($subject, $body_html),
            ['Content-Type: text/html; charset=UTF-8']
        );
    }

    /**
     * The single email shell. Inline styles only — mail clients discard
     * stylesheets — but the values mirror the design tokens.
     */
    private function layout(string $title, string $content): string
    {
        $safe_title = esc_html($title);

        return <<<HTML
<!doctype html>
<html>
<body style="margin:0;padding:0;background:#F4F3F0;font-family:Helvetica,Arial,sans-serif;color:#0A0A0A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F3F0;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;">
        <tr><td style="background:#0A0A0A;padding:20px 24px;">
          <span style="color:#FCB900;font-size:20px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">PTP</span>
        </td></tr>
        <tr><td style="padding:28px 24px;">
          <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:#0A0A0A;">{$safe_title}</h1>
          {$content}
        </td></tr>
        <tr><td style="padding:18px 24px;background:#F4F3F0;color:#6B7280;font-size:12px;">
          Players Teaching Players &middot; info@ptpsummercamps.com
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
HTML;
    }

    /** @param array<int, object> $items */
    private function render_receipt(object $order, array $items, object $parent): string
    {
        $rows = '';

        foreach ($items as $item) {
            $rows .= sprintf(
                '<tr><td style="padding:8px 0;color:#0A0A0A;">%s &times;%d</td><td align="right" style="padding:8px 0;color:#0A0A0A;">%s</td></tr>',
                esc_html($item->label),
                (int) $item->qty,
                esc_html($this->money((int) $item->amount_cents))
            );
        }

        $name     = esc_html($parent->first_name);
        $total    = esc_html($this->money((int) $order->total_cents));
        $discount = (int) $order->discount_cents;

        $discount_row = $discount > 0
            ? sprintf(
                '<tr><td style="padding:8px 0;color:#22C55E;">%s</td><td align="right" style="padding:8px 0;color:#22C55E;">-%s</td></tr>',
                esc_html__('Discount', 'ptp'),
                esc_html($this->money($discount))
            )
            : '';

        return <<<HTML
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#374151;">
  Thanks {$name} — your booking is confirmed. Here's what you paid for:
</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;border-top:1px solid #E5E7EB;">
  {$rows}
  {$discount_row}
  <tr><td style="padding:12px 0;border-top:2px solid #0A0A0A;font-weight:700;">Total</td>
      <td align="right" style="padding:12px 0;border-top:2px solid #0A0A0A;font-weight:700;">{$total}</td></tr>
</table>
HTML;
    }

    private function money(int $cents): string
    {
        return '$' . number_format($cents / 100, 2);
    }
}
