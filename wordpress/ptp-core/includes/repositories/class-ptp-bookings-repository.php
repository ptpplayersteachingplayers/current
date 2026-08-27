<?php
/**
 * Bookings.
 *
 * Every read method takes a PTP_Actor and scopes the query to that actor. There
 * is deliberately no find(int $id) that returns a row regardless of caller —
 * the audit found several handlers that fetched by request id and only then
 * (sometimes) thought about ownership. Here the scoping is in the SQL.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Bookings_Repository extends PTP_Repository
{
    protected function table_name(): string
    {
        return 'bookings';
    }

    /**
     * Fetch a booking the actor is entitled to see, or null.
     *
     * Parents see their own; trainers see bookings assigned to them; staff see
     * everything. The ownership test is part of the query, so a caller cannot
     * forget to apply it.
     */
    public function find_for(PTP_Actor $actor, int $booking_id): ?object
    {
        if ($actor->is(PTP_Guard::ROLE_STAFF)) {
            return $this->find_row($booking_id);
        }

        $column = $actor->role() === PTP_Guard::ROLE_TRAINER ? 'trainer_id' : 'parent_id';

        $row = $this->db()->get_row(
            $this->db()->prepare(
                'SELECT * FROM ' . $this->table() . " WHERE id = %d AND {$column} = %d",
                $booking_id,
                (int) $actor->id()
            )
        );

        return $row ?: null;
    }

    /** @return array<int, object> */
    public function upcoming_for(PTP_Actor $actor, int $limit = 25): array
    {
        if ($actor->is(PTP_Guard::ROLE_STAFF)) {
            return $this->db()->get_results(
                $this->db()->prepare(
                    'SELECT * FROM ' . $this->table() . ' WHERE starts_at >= %s AND status != %s ORDER BY starts_at ASC LIMIT %d',
                    $this->now(),
                    'cancelled',
                    $limit
                )
            ) ?: [];
        }

        $column = $actor->role() === PTP_Guard::ROLE_TRAINER ? 'trainer_id' : 'parent_id';

        return $this->db()->get_results(
            $this->db()->prepare(
                'SELECT * FROM ' . $this->table() . " WHERE {$column} = %d AND starts_at >= %s AND status != %s ORDER BY starts_at ASC LIMIT %d",
                (int) $actor->id(),
                $this->now(),
                'cancelled',
                $limit
            )
        ) ?: [];
    }

    /**
     * Create a booking on behalf of an actor.
     *
     * parent_id comes from the actor, never the request. player_id is verified
     * to belong to that parent before the row is written — the exact check
     * missing from the old join/leave group-session handlers, which let any
     * logged-in user attach another family's child to a session.
     */
    public function create(PTP_Actor $actor, array $input): int
    {
        $player_id = isset($input['player_id']) ? absint($input['player_id']) : 0;

        if ($player_id > 0 && !ptp_core()->players()->belongs_to($player_id, $actor)) {
            throw new PTP_Repository_Exception(__('That player is not on your account.', 'ptp'));
        }

        return $this->insert_row(
            [
                'order_id'     => isset($input['order_id']) ? absint($input['order_id']) : null,
                'parent_id'    => (int) $actor->id(),
                'player_id'    => $player_id ?: null,
                'trainer_id'   => isset($input['trainer_id']) ? absint($input['trainer_id']) : null,
                'booking_type' => isset($input['booking_type']) ? sanitize_key($input['booking_type']) : 'training',
                'starts_at'    => sanitize_text_field((string) ($input['starts_at'] ?? $this->now())),
                'ends_at'      => isset($input['ends_at']) ? sanitize_text_field((string) $input['ends_at']) : null,
                'location'     => sanitize_text_field((string) ($input['location'] ?? '')),
                'status'       => 'pending',
                'created_at'   => $this->now(),
                'updated_at'   => $this->now(),
            ],
            ['%d', '%d', '%d', '%d', '%s', '%s', '%s', '%s', '%s', '%s', '%s']
        );
    }

    /** Cancel a booking, refusing when the actor does not own it. */
    public function cancel(PTP_Actor $actor, int $booking_id): void
    {
        $booking = $this->find_for($actor, $booking_id);

        if ($booking === null) {
            throw new PTP_Repository_Exception(__('Booking not found.', 'ptp'));
        }

        $this->update_row(
            $booking_id,
            ['status' => 'cancelled', 'updated_at' => $this->now()],
            ['%s', '%s']
        );

        do_action('ptp_booking_cancelled', $booking_id, $actor->user_id());
    }

    public function mark_confirmed(int $booking_id): void
    {
        $this->update_row(
            $booking_id,
            ['status' => 'confirmed', 'updated_at' => $this->now()],
            ['%s', '%s']
        );
    }

    /**
     * Mark a session delivered.
     *
     * This is what releases the trainer's payout, so the transition is guarded
     * in SQL: only a confirmed booking becomes completed, and a repeated call
     * updates zero rows rather than firing the payout hook twice.
     */
    public function mark_completed(int $booking_id): void
    {
        // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- conditional transition must be atomic
        $updated = $this->db()->query(
            $this->db()->prepare(
                'UPDATE ' . $this->table() . ' SET status = %s, updated_at = %s WHERE id = %d AND status = %s',
                'completed',
                $this->now(),
                $booking_id,
                'confirmed'
            )
        );

        if ((int) $updated === 1) {
            do_action('ptp_booking_completed', $booking_id);
        }
    }

    /** Sessions a trainer has delivered but not yet marked complete. */
    public function awaiting_completion(PTP_Actor $actor, int $limit = 25): array
    {
        if (!$actor->is(PTP_Guard::ROLE_TRAINER) || $actor->id() === null) {
            return [];
        }

        return $this->db()->get_results(
            $this->db()->prepare(
                'SELECT * FROM ' . $this->table()
                . ' WHERE trainer_id = %d AND status = %s AND starts_at < %s ORDER BY starts_at DESC LIMIT %d',
                (int) $actor->id(),
                'confirmed',
                $this->now(),
                $limit
            )
        ) ?: [];
    }
}
