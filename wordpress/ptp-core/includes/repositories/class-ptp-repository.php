<?php
/**
 * Base repository.
 *
 * All database access in the platform goes through a repository. Feature
 * plugins never touch $wpdb directly, which is what keeps table ownership in
 * Core and keeps every query prepared.
 */

if (!defined('ABSPATH')) {
    exit;
}

abstract class PTP_Repository
{
    /** Unprefixed table name, e.g. 'bookings'. */
    abstract protected function table_name(): string;

    protected function table(): string
    {
        return PTP_Schema::table($this->table_name());
    }

    protected function db(): wpdb
    {
        global $wpdb;

        return $wpdb;
    }

    /** @return object|null */
    protected function find_row(int $id): ?object
    {
        $row = $this->db()->get_row(
            $this->db()->prepare('SELECT * FROM ' . $this->table() . ' WHERE id = %d', $id)
        );

        return $row ?: null;
    }

    /**
     * @param array<string, mixed> $data
     * @param array<int, string> $format
     */
    protected function insert_row(array $data, array $format): int
    {
        $this->db()->insert($this->table(), $data, $format);

        return (int) $this->db()->insert_id;
    }

    /**
     * @param array<string, mixed> $data
     * @param array<int, string> $format
     */
    protected function update_row(int $id, array $data, array $format): void
    {
        $this->db()->update($this->table(), $data, ['id' => $id], $format, ['%d']);
    }

    /**
     * Restrict a caller-supplied field list to columns this repository allows
     * to be written. Guards against mass-assignment: handlers pass through a
     * sanitised array, and anything not on the allowlist is dropped.
     *
     * @param array<string, mixed> $input
     * @param array<string, string> $allowed column => sprintf format
     * @return array{data: array<string, mixed>, format: array<int, string>}
     */
    protected function filter_writable(array $input, array $allowed): array
    {
        $data   = [];
        $format = [];

        foreach ($allowed as $column => $fmt) {
            if (!array_key_exists($column, $input)) {
                continue;
            }

            $data[$column]  = $input[$column];
            $format[]       = $fmt;
        }

        return ['data' => $data, 'format' => $format];
    }

    protected function now(): string
    {
        return current_time('mysql', true);
    }
}
