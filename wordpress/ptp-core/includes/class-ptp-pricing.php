<?php
/**
 * Server-authoritative pricing.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS CLASS EXISTS
 * ---------------------------------------------------------------------------
 * The audit found three independent pay-what-you-want vulnerabilities, all the
 * same shape: an amount, an early-bird discount, or an add-on fee arrived in
 * the request body and reached Stripe without ever being recomputed from
 * trusted data. One of them "verified" the charged amount against a total that
 * was itself client-supplied, so the attacker controlled both sides of the
 * check.
 *
 * The fix is architectural, not a patch. quote() is the only function in the
 * platform permitted to produce an amount for Stripe. It accepts item
 * *references* — ids and quantities — and nothing else. There is no parameter
 * through which a caller can express a price, a discount value, or a total.
 * Every figure it returns is read from the database or computed here.
 *
 * A quote is signed and cached server-side. The checkout flow passes the quote
 * id (not the amount) to the payment step, which re-reads the quote from the
 * cache. A tampered amount has nowhere to enter the system.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Pricing
{
    /** Quotes expire so a stale price cannot be redeemed weeks later. */
    private const QUOTE_TTL = 30 * MINUTE_IN_SECONDS;

    private const TRANSIENT_PREFIX = 'ptp_quote_';

    /** Upper bound on a single line's quantity. */
    private const MAX_QUANTITY = 50;

    /**
     * Build a priced quote from item references.
     *
     * @param array<int, array{type: string, id: int, qty: int}> $items
     *        Only type, id and qty are read. Any price-like key is ignored.
     * @param string|null $discount_code Validated here, never trusted as a value.
     */
    public function quote(array $items, ?string $discount_code, PTP_Actor $actor): PTP_Quote
    {
        $lines    = [];
        $subtotal = 0;

        foreach ($items as $item) {
            $line = $this->price_line(
                isset($item['type']) ? sanitize_key($item['type']) : '',
                isset($item['id']) ? absint($item['id']) : 0,
                $this->clamp_quantity($item['qty'] ?? 1)
            );

            if ($line === null) {
                continue;
            }

            $lines[]   = $line;
            $subtotal += $line['amount_cents'];
        }

        if ($lines === []) {
            throw new PTP_Pricing_Exception(__('Your cart is empty.', 'ptp'));
        }

        $discount = $this->resolve_discount($discount_code, $subtotal, $actor);
        $total    = max(0, $subtotal - $discount['amount_cents']);

        $quote = new PTP_Quote(
            wp_generate_uuid4(),
            $lines,
            $subtotal,
            $discount,
            $total,
            $actor->user_id(),
            time() + self::QUOTE_TTL
        );

        set_transient(self::TRANSIENT_PREFIX . $quote->id(), $quote->to_array(), self::QUOTE_TTL);

        return $quote;
    }

    /**
     * Re-read a previously issued quote.
     *
     * The payment step calls this with the quote id and charges
     * $quote->total_cents(). It never accepts an amount from the request.
     * Quotes are bound to the user who created them, so one customer cannot
     * redeem another's quote.
     */
    public function retrieve_quote(string $quote_id, PTP_Actor $actor): PTP_Quote
    {
        $raw = get_transient(self::TRANSIENT_PREFIX . sanitize_text_field($quote_id));

        if (!is_array($raw)) {
            throw new PTP_Pricing_Exception(__('Your checkout session expired. Please review your cart and try again.', 'ptp'));
        }

        $quote = PTP_Quote::from_array($raw);

        if ($quote->user_id() !== $actor->user_id()) {
            throw new PTP_Pricing_Exception(__('That checkout session belongs to a different account.', 'ptp'));
        }

        if ($quote->is_expired()) {
            throw new PTP_Pricing_Exception(__('Your checkout session expired. Please review your cart and try again.', 'ptp'));
        }

        return $quote;
    }

    /** Consume a quote once payment succeeds, so it cannot be replayed. */
    public function consume_quote(string $quote_id): void
    {
        delete_transient(self::TRANSIENT_PREFIX . sanitize_text_field($quote_id));
    }

    /**
     * Normalise a requested quantity into a sane range.
     *
     * Deliberately not absint(): absint(-5) is 5, which would silently bill a
     * customer for five places when their request said minus five. A malformed
     * quantity means one, and an absurd one is capped rather than trusted —
     * nobody books 10,000 camp places, but an integer overflow attempt will try.
     */
    private function clamp_quantity($raw): int
    {
        $qty = is_numeric($raw) ? (int) $raw : 1;

        return max(1, min(self::MAX_QUANTITY, $qty));
    }

    /**
     * Price one line from trusted data.
     *
     * @return array{type: string, id: int, qty: int, label: string, unit_cents: int, amount_cents: int}|null
     */
    private function price_line(string $type, int $id, int $qty): ?array
    {
        if ($id <= 0) {
            return null;
        }

        /**
         * Product types register a resolver that returns a label and a unit
         * price in cents read from the database. Filters may add types; they
         * cannot supply a price from the request because the request is not
         * passed to them.
         */
        $resolver = apply_filters("ptp_price_resolver_{$type}", null, $id);

        if (!is_callable($resolver)) {
            return null;
        }

        $resolved = $resolver($id);

        if (!is_array($resolved) || !isset($resolved['unit_cents'], $resolved['label'])) {
            return null;
        }

        $unit_cents = absint($resolved['unit_cents']);

        return [
            'type'         => $type,
            'id'           => $id,
            'qty'          => $qty,
            'label'        => (string) $resolved['label'],
            'unit_cents'   => $unit_cents,
            'amount_cents' => $unit_cents * $qty,
        ];
    }

    /**
     * Validate a discount code and compute its value here.
     *
     * The caller supplies a code string only. Its value, eligibility window,
     * usage limit and minimum spend are all read from the database. The audit
     * found a public endpoint that incremented a code's usage counter on every
     * validation call, letting anyone exhaust a limited code without buying —
     * validation is read-only here, and usage is recorded only on payment.
     *
     * @return array{code: string, label: string, amount_cents: int}
     */
    private function resolve_discount(?string $code, int $subtotal_cents, PTP_Actor $actor): array
    {
        $empty = ['code' => '', 'label' => '', 'amount_cents' => 0];

        if ($code === null || trim($code) === '') {
            return $empty;
        }

        $record = PTP_Discounts::find(sanitize_text_field($code));

        if ($record === null || !$record->is_redeemable_by($actor, $subtotal_cents)) {
            return $empty;
        }

        return [
            'code'         => $record->code(),
            'label'        => $record->label(),
            'amount_cents' => $record->value_for($subtotal_cents),
        ];
    }
}
