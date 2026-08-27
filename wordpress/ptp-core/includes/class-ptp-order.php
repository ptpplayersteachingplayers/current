<?php
/**
 * Read model for an order row.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Order
{
    private int $id;
    private int $parent_id;
    private string $status;
    private int $total_cents;
    private int $paid_cents;
    private string $quote_id;

    private function __construct(int $id, int $parent_id, string $status, int $total_cents, int $paid_cents, string $quote_id)
    {
        $this->id          = $id;
        $this->parent_id   = $parent_id;
        $this->status      = $status;
        $this->total_cents = $total_cents;
        $this->paid_cents  = $paid_cents;
        $this->quote_id    = $quote_id;
    }

    public static function from_row(object $row): PTP_Order
    {
        return new self(
            (int) $row->id,
            (int) $row->parent_id,
            (string) $row->status,
            (int) $row->total_cents,
            (int) $row->paid_cents,
            (string) $row->quote_id
        );
    }

    public function id(): int
    {
        return $this->id;
    }

    public function parent_id(): int
    {
        return $this->parent_id;
    }

    public function status(): string
    {
        return $this->status;
    }

    public function total_cents(): int
    {
        return $this->total_cents;
    }

    public function paid_cents(): int
    {
        return $this->paid_cents;
    }

    public function quote_id(): string
    {
        return $this->quote_id;
    }

    public function is_paid(): bool
    {
        return $this->status === 'paid';
    }
}
