<?php
/**
 * Trainer availability rules and one-off exceptions.
 *
 * Writes are always scoped to the acting trainer. A trainer cannot edit another
 * trainer's calendar, and the trainer id is taken from the actor rather than the
 * request in every method here.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Availability_Repository extends PTP_Repository
{
    protected function table_name(): string
    {
        return 'availability';
    }

    /** @return array<int, object> */
    public function rules_for(PTP_Actor $actor): array
    {
        if ($actor->id() === null) {
            return [];
        }

        return $this->db()->get_results(
            $this->db()->prepare(
                'SELECT * FROM ' . $this->table() . ' WHERE trainer_id = %d ORDER BY weekday ASC, starts_time ASC',
                (int) $actor->id()
            )
        ) ?: [];
    }

    /**
     * Add a weekly availability block.
     *
     * Rejects a block whose end is not after its start, which would otherwise
     * generate zero slots silently and leave a trainer wondering why nobody can
     * book them.
     */
    public function add_rule(PTP_Actor $actor, array $input): int
    {
        $this->require_trainer($actor);

        $weekday = isset($input['weekday']) ? absint($input['weekday']) : 7;
        $start   = $this->time($input['starts_time'] ?? '');
        $end     = $this->time($input['ends_time'] ?? '');

        if ($weekday > 6) {
            throw new PTP_Repository_Exception(__('Pick a day of the week.', 'ptp'));
        }

        if ($start === null || $end === null || $end <= $start) {
            throw new PTP_Repository_Exception(__('The finish time needs to be after the start time.', 'ptp'));
        }

        $slot_minutes = isset($input['slot_minutes']) ? absint($input['slot_minutes']) : 60;

        if (!in_array($slot_minutes, [30, 45, 60, 90], true)) {
            $slot_minutes = 60;
        }

        return $this->insert_row(
            [
                'trainer_id'   => (int) $actor->id(),
                'weekday'      => $weekday,
                'starts_time'  => $start,
                'ends_time'    => $end,
                'location'     => sanitize_text_field((string) ($input['location'] ?? '')),
                'slot_minutes' => $slot_minutes,
                'active'       => 1,
                'created_at'   => $this->now(),
            ],
            ['%d', '%d', '%s', '%s', '%s', '%d', '%d', '%s']
        );
    }

    /** Delete a rule, refusing when it is not the actor's. */
    public function delete_rule(PTP_Actor $actor, int $rule_id): void
    {
        $this->require_trainer($actor);

        $owner = $this->db()->get_var(
            $this->db()->prepare('SELECT trainer_id FROM ' . $this->table() . ' WHERE id = %d', $rule_id)
        );

        if ($owner === null || (int) $owner !== (int) $actor->id()) {
            throw new PTP_Repository_Exception(__('That availability block is not yours.', 'ptp'));
        }

        $this->db()->delete($this->table(), ['id' => $rule_id], ['%d']);
    }

    /**
     * Block a single date, e.g. a holiday.
     *
     * Uses INSERT IGNORE against the unique index so blocking the same day
     * twice is harmless rather than an error the trainer has to understand.
     */
    public function block_date(PTP_Actor $actor, string $date, string $note = ''): void
    {
        $this->require_trainer($actor);

        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            throw new PTP_Repository_Exception(__('That date is not valid.', 'ptp'));
        }

        $this->db()->query(
            $this->db()->prepare(
                'INSERT IGNORE INTO ' . PTP_Schema::table('availability_exceptions')
                . ' (trainer_id, on_date, kind, note, created_at) VALUES (%d, %s, %s, %s, %s)',
                (int) $actor->id(),
                $date,
                'block',
                sanitize_text_field($note),
                $this->now()
            )
        );
    }

    public function unblock_date(PTP_Actor $actor, string $date): void
    {
        $this->require_trainer($actor);

        $this->db()->delete(
            PTP_Schema::table('availability_exceptions'),
            ['trainer_id' => (int) $actor->id(), 'on_date' => $date, 'kind' => 'block'],
            ['%d', '%s', '%s']
        );
    }

    /** @return array<int, object> */
    public function blocked_dates(PTP_Actor $actor): array
    {
        if ($actor->id() === null) {
            return [];
        }

        return $this->db()->get_results(
            $this->db()->prepare(
                'SELECT * FROM ' . PTP_Schema::table('availability_exceptions')
                . ' WHERE trainer_id = %d AND kind = %s AND on_date >= %s ORDER BY on_date ASC',
                (int) $actor->id(),
                'block',
                current_time('Y-m-d')
            )
        ) ?: [];
    }

    private function require_trainer(PTP_Actor $actor): void
    {
        if (!$actor->is(PTP_Guard::ROLE_TRAINER) || $actor->id() === null) {
            throw new PTP_Repository_Exception(__('Only a trainer can change this calendar.', 'ptp'));
        }
    }

    /** Normalise a time input to H:i:s, or null when unparseable. */
    private function time($raw): ?string
    {
        $value = sanitize_text_field((string) $raw);

        if (!preg_match('/^(\d{1,2}):(\d{2})/', $value, $m)) {
            return null;
        }

        $hour   = (int) $m[1];
        $minute = (int) $m[2];

        if ($hour > 23 || $minute > 59) {
            return null;
        }

        return sprintf('%02d:%02d:00', $hour, $minute);
    }
}
