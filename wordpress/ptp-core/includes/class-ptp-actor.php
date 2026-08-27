<?php
/**
 * The authenticated caller.
 *
 * An Actor is always constructed from the session. It carries the PTP-domain
 * id (parent id or trainer id) alongside the WordPress user id, so handlers
 * scope queries with $actor->id() instead of trusting a request parameter.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Actor
{
    private int $user_id;
    private string $role;
    private ?int $domain_id;

    private function __construct(int $user_id, string $role, ?int $domain_id)
    {
        $this->user_id   = $user_id;
        $this->role      = $role;
        $this->domain_id = $domain_id;
    }

    public static function from_user(int $user_id): PTP_Actor
    {
        if ($user_id <= 0) {
            return new self(0, 'guest', null);
        }

        if (user_can($user_id, 'manage_options')) {
            return new self($user_id, PTP_Guard::ROLE_STAFF, $user_id);
        }

        $trainer_id = ptp_core()->trainers()->id_for_user($user_id);
        if ($trainer_id !== null) {
            return new self($user_id, PTP_Guard::ROLE_TRAINER, $trainer_id);
        }

        $parent_id = ptp_core()->parents()->id_for_user($user_id);
        if ($parent_id !== null) {
            return new self($user_id, PTP_Guard::ROLE_PARENT, $parent_id);
        }

        return new self($user_id, 'authenticated', null);
    }

    /**
     * The domain id to scope queries by — parent id for parents, trainer id
     * for trainers. Null when the user has no PTP record yet.
     */
    public function id(): ?int
    {
        return $this->domain_id;
    }

    public function user_id(): int
    {
        return $this->user_id;
    }

    public function role(): string
    {
        return $this->role;
    }

    /** Staff satisfy every role check; the back office acts on all records. */
    public function is(string $role): bool
    {
        if ($this->role === PTP_Guard::ROLE_STAFF) {
            return true;
        }

        return $this->role === $role && $this->domain_id !== null;
    }

    public function is_guest(): bool
    {
        return $this->user_id === 0;
    }
}
