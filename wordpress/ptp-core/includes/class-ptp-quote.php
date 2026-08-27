<?php
/**
 * An immutable priced cart.
 *
 * A Quote is the only object the payment layer accepts. It is produced by
 * PTP_Pricing::quote() from trusted data and has no setters — nothing between
 * pricing and charging can alter a figure inside it.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Quote
{
    private string $id;

    /** @var array<int, array{type: string, id: int, qty: int, label: string, unit_cents: int, amount_cents: int}> */
    private array $lines;

    private int $subtotal_cents;

    /** @var array{code: string, label: string, amount_cents: int} */
    private array $discount;

    private int $total_cents;
    private int $user_id;
    private int $expires_at;

    public function __construct(
        string $id,
        array $lines,
        int $subtotal_cents,
        array $discount,
        int $total_cents,
        int $user_id,
        int $expires_at
    ) {
        $this->id             = $id;
        $this->lines          = $lines;
        $this->subtotal_cents = $subtotal_cents;
        $this->discount       = $discount;
        $this->total_cents    = $total_cents;
        $this->user_id        = $user_id;
        $this->expires_at     = $expires_at;
    }

    public function id(): string
    {
        return $this->id;
    }

    /** @return array<int, array{type: string, id: int, qty: int, label: string, unit_cents: int, amount_cents: int}> */
    public function lines(): array
    {
        return $this->lines;
    }

    public function subtotal_cents(): int
    {
        return $this->subtotal_cents;
    }

    public function discount_cents(): int
    {
        return $this->discount['amount_cents'];
    }

    public function discount_code(): string
    {
        return $this->discount['code'];
    }

    public function discount_label(): string
    {
        return $this->discount['label'];
    }

    /** The one figure the payment layer is allowed to charge. */
    public function total_cents(): int
    {
        return $this->total_cents;
    }

    public function user_id(): int
    {
        return $this->user_id;
    }

    public function is_expired(): bool
    {
        return time() > $this->expires_at;
    }

    /** @return array<string, mixed> */
    public function to_array(): array
    {
        return [
            'id'             => $this->id,
            'lines'          => $this->lines,
            'subtotal_cents' => $this->subtotal_cents,
            'discount'       => $this->discount,
            'total_cents'    => $this->total_cents,
            'user_id'        => $this->user_id,
            'expires_at'     => $this->expires_at,
        ];
    }

    /** @param array<string, mixed> $data */
    public static function from_array(array $data): PTP_Quote
    {
        return new self(
            (string) ($data['id'] ?? ''),
            (array) ($data['lines'] ?? []),
            (int) ($data['subtotal_cents'] ?? 0),
            (array) ($data['discount'] ?? ['code' => '', 'label' => '', 'amount_cents' => 0]),
            (int) ($data['total_cents'] ?? 0),
            (int) ($data['user_id'] ?? 0),
            (int) ($data['expires_at'] ?? 0)
        );
    }
}
