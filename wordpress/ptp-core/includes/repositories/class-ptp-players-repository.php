<?php
/**
 * Players (children).
 *
 * The most sensitive data in the platform. belongs_to() is the check the old
 * assessment and group-session endpoints were missing, which let any logged-in
 * user read or write any child's record by walking small integer ids.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Players_Repository extends PTP_Repository
{
    protected function table_name(): string
    {
        return 'players';
    }

    /** True when the player is on the actor's account. Staff always pass. */
    public function belongs_to(int $player_id, PTP_Actor $actor): bool
    {
        if ($actor->is(PTP_Guard::ROLE_STAFF)) {
            return true;
        }

        if ($actor->id() === null) {
            return false;
        }

        $owner = $this->db()->get_var(
            $this->db()->prepare('SELECT parent_id FROM ' . $this->table() . ' WHERE id = %d', $player_id)
        );

        return $owner !== null && (int) $owner === (int) $actor->id();
    }

    /** @return array<int, object> */
    public function for_actor(PTP_Actor $actor): array
    {
        if ($actor->id() === null) {
            return [];
        }

        return $this->db()->get_results(
            $this->db()->prepare(
                'SELECT * FROM ' . $this->table() . ' WHERE parent_id = %d ORDER BY first_name ASC',
                (int) $actor->id()
            )
        ) ?: [];
    }

    public function find_for(PTP_Actor $actor, int $player_id): ?object
    {
        return $this->belongs_to($player_id, $actor) ? $this->find_row($player_id) : null;
    }

    public function create(PTP_Actor $actor, array $input): int
    {
        if ($actor->id() === null) {
            throw new PTP_Repository_Exception(__('Your account is not set up yet.', 'ptp'));
        }

        return $this->insert_row(
            [
                'parent_id'  => (int) $actor->id(),
                'first_name' => sanitize_text_field((string) ($input['first_name'] ?? '')),
                'last_name'  => sanitize_text_field((string) ($input['last_name'] ?? '')),
                'birth_date' => $this->sanitise_date($input['birth_date'] ?? null),
                'position'   => sanitize_text_field((string) ($input['position'] ?? '')),
                'notes'      => sanitize_textarea_field((string) ($input['notes'] ?? '')),
                'created_at' => $this->now(),
                'updated_at' => $this->now(),
            ],
            ['%d', '%s', '%s', '%s', '%s', '%s', '%s', '%s']
        );
    }

    /**
     * Update a player.
     *
     * Writable columns are allowlisted, so a caller cannot reassign parent_id
     * by adding it to the payload and move another family's child onto their
     * own account.
     */
    public function update(PTP_Actor $actor, int $player_id, array $input): void
    {
        if (!$this->belongs_to($player_id, $actor)) {
            throw new PTP_Repository_Exception(__('That player is not on your account.', 'ptp'));
        }

        $writable = $this->filter_writable(
            [
                'first_name' => sanitize_text_field((string) ($input['first_name'] ?? '')),
                'last_name'  => sanitize_text_field((string) ($input['last_name'] ?? '')),
                'birth_date' => $this->sanitise_date($input['birth_date'] ?? null),
                'position'   => sanitize_text_field((string) ($input['position'] ?? '')),
                'notes'      => sanitize_textarea_field((string) ($input['notes'] ?? '')),
            ],
            [
                'first_name' => '%s',
                'last_name'  => '%s',
                'birth_date' => '%s',
                'position'   => '%s',
                'notes'      => '%s',
            ]
        );

        $writable['data']['updated_at'] = $this->now();
        $writable['format'][]           = '%s';

        $this->update_row($player_id, $writable['data'], $writable['format']);
    }

    private function sanitise_date(?string $value): ?string
    {
        if ($value === null || trim($value) === '') {
            return null;
        }

        $date = date_create(sanitize_text_field($value));

        return $date ? $date->format('Y-m-d') : null;
    }
}
