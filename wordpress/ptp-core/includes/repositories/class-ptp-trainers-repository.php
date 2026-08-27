<?php
/**
 * Trainers.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Trainers_Repository extends PTP_Repository
{
    protected function table_name(): string
    {
        return 'trainers';
    }

    public function id_for_user(int $user_id): ?int
    {
        $id = $this->db()->get_var(
            $this->db()->prepare(
                'SELECT id FROM ' . $this->table() . ' WHERE user_id = %d AND status = %s',
                $user_id,
                'active'
            )
        );

        return $id !== null ? (int) $id : null;
    }

    /** Public directory listing. Only active trainers are ever exposed. */
    public function active(int $limit = 60): array
    {
        return $this->db()->get_results(
            $this->db()->prepare(
                'SELECT * FROM ' . $this->table() . ' WHERE status = %s ORDER BY display_name ASC LIMIT %d',
                'active',
                $limit
            )
        ) ?: [];
    }

    public function find_by_slug(string $slug): ?object
    {
        $row = $this->db()->get_row(
            $this->db()->prepare(
                'SELECT * FROM ' . $this->table() . ' WHERE slug = %s AND status = %s',
                sanitize_title($slug),
                'active'
            )
        );

        return $row ?: null;
    }

    /**
     * Applications land as 'pending' and require an explicit staff transition
     * to 'active'. The old quick-apply endpoint inserted trainers straight to
     * active from an unauthenticated POST, bypassing vetting entirely.
     */
    public function create_application(array $input): int
    {
        return $this->insert_row(
            [
                'user_id'      => 0,
                'slug'         => $this->unique_slug((string) ($input['display_name'] ?? 'trainer')),
                'display_name' => sanitize_text_field((string) ($input['display_name'] ?? '')),
                'bio'          => wp_kses_post((string) ($input['bio'] ?? '')),
                'status'       => 'pending',
                'created_at'   => $this->now(),
                'updated_at'   => $this->now(),
            ],
            ['%d', '%s', '%s', '%s', '%s', '%s', '%s']
        );
    }

    public function set_status(int $trainer_id, string $status): void
    {
        $allowed = ['pending', 'active', 'paused', 'archived'];

        if (!in_array($status, $allowed, true)) {
            throw new PTP_Repository_Exception(__('Unknown trainer status.', 'ptp'));
        }

        $this->update_row($trainer_id, ['status' => $status, 'updated_at' => $this->now()], ['%s', '%s']);
    }

    private function unique_slug(string $name): string
    {
        $base = sanitize_title($name) ?: 'trainer';
        $slug = $base;
        $i    = 2;

        while ($this->db()->get_var($this->db()->prepare('SELECT id FROM ' . $this->table() . ' WHERE slug = %s', $slug))) {
            $slug = $base . '-' . $i++;
        }

        return $slug;
    }
}
