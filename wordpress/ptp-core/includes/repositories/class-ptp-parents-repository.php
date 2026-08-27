<?php
/**
 * Parents (household / customer identity).
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Parents_Repository extends PTP_Repository
{
    protected function table_name(): string
    {
        return 'parents';
    }

    /** Resolve the parent record for a WP user, or null. Used by PTP_Actor. */
    public function id_for_user(int $user_id): ?int
    {
        $id = $this->db()->get_var(
            $this->db()->prepare('SELECT id FROM ' . $this->table() . ' WHERE user_id = %d', $user_id)
        );

        return $id !== null ? (int) $id : null;
    }

    public function find_for(PTP_Actor $actor): ?object
    {
        return $actor->id() !== null ? $this->find_row((int) $actor->id()) : null;
    }

    /** Create the parent record for a newly registered user. */
    public function create_for_user(int $user_id, array $input): int
    {
        return $this->insert_row(
            [
                'user_id'    => $user_id,
                'first_name' => sanitize_text_field((string) ($input['first_name'] ?? '')),
                'last_name'  => sanitize_text_field((string) ($input['last_name'] ?? '')),
                'email'      => sanitize_email((string) ($input['email'] ?? '')),
                'phone'      => sanitize_text_field((string) ($input['phone'] ?? '')),
                'created_at' => $this->now(),
                'updated_at' => $this->now(),
            ],
            ['%d', '%s', '%s', '%s', '%s', '%s', '%s']
        );
    }

    /**
     * Update contact details. Allowlisted so user_id and
     * stripe_customer_id can never be rewritten from a form post.
     */
    public function update_profile(PTP_Actor $actor, array $input): void
    {
        if ($actor->id() === null) {
            throw new PTP_Repository_Exception(__('Your account is not set up yet.', 'ptp'));
        }

        $writable = $this->filter_writable(
            [
                'first_name' => sanitize_text_field((string) ($input['first_name'] ?? '')),
                'last_name'  => sanitize_text_field((string) ($input['last_name'] ?? '')),
                'phone'      => sanitize_text_field((string) ($input['phone'] ?? '')),
            ],
            ['first_name' => '%s', 'last_name' => '%s', 'phone' => '%s']
        );

        $writable['data']['updated_at'] = $this->now();
        $writable['format'][]           = '%s';

        $this->update_row((int) $actor->id(), $writable['data'], $writable['format']);
    }

    public function set_stripe_customer(int $parent_id, string $customer_id): void
    {
        $this->update_row(
            $parent_id,
            ['stripe_customer_id' => sanitize_text_field($customer_id), 'updated_at' => $this->now()],
            ['%s', '%s']
        );
    }
}
