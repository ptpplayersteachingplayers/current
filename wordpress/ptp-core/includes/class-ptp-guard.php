<?php
/**
 * Request authorisation.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS CLASS EXISTS
 * ---------------------------------------------------------------------------
 * The security audit of the previous codebase found the same defect repeated
 * across unrelated files: a handler verified a nonce (proving the request came
 * from the site) and then acted on a record ID taken straight from the request
 * without ever checking the caller owned that record. A nonce is not
 * authorisation. Confirmed instances included cancelling another family's
 * clinic registration, reading any child's skill assessments, marking an
 * arbitrary booking paid, and releasing another trainer's payout.
 *
 * Every handler in every PTP plugin therefore opens with exactly one Guard
 * call. The Guard resolves the actor from the session — never from the
 * request — and returns a context object. There is no code path that accepts
 * a caller-supplied parent_id, trainer_id or user_id as proof of identity.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Guard
{
    public const ROLE_PARENT  = 'parent';
    public const ROLE_TRAINER = 'trainer';
    public const ROLE_STAFF   = 'staff';

    /**
     * Authorise a front-end AJAX request.
     *
     * Verifies the nonce, resolves the actor from the current session, and
     * returns a context the caller uses to scope every subsequent query.
     * Sends a JSON error and exits on failure — handlers never have to
     * remember to bail out themselves.
     */
    public function authorise_ajax(string $action, string $required_role = self::ROLE_PARENT): PTP_Actor
    {
        if (!check_ajax_referer($action, 'nonce', false)) {
            wp_send_json_error(['message' => __('Your session expired. Please refresh and try again.', 'ptp')], 403);
        }

        $actor = $this->current_actor();

        if (!$actor->is($required_role)) {
            wp_send_json_error(['message' => __('You do not have permission to do that.', 'ptp')], 403);
        }

        return $actor;
    }

    /**
     * Authorise a back-office request. Capability is checked in addition to
     * the nonce, never instead of it, and never by relying on the screen only
     * being reachable from a capability-gated menu.
     */
    public function authorise_admin_ajax(string $action, string $capability = 'manage_options'): PTP_Actor
    {
        if (!check_ajax_referer($action, 'nonce', false)) {
            wp_send_json_error(['message' => __('Your session expired. Please refresh and try again.', 'ptp')], 403);
        }

        if (!current_user_can($capability)) {
            wp_send_json_error(['message' => __('You do not have permission to do that.', 'ptp')], 403);
        }

        return $this->current_actor();
    }

    /**
     * Authorise a state-changing admin page request (form POST or action link).
     * Mutating GET links must still carry a nonce — the audit found a trainer
     * delete triggered by a bare ?delete_trainer=ID, exploitable with an <img>.
     */
    public function authorise_admin_request(string $action, string $capability = 'manage_options'): void
    {
        if (!current_user_can($capability)) {
            wp_die(esc_html__('You do not have permission to do that.', 'ptp'), 403);
        }

        check_admin_referer($action);
    }

    /**
     * REST permission callback factory.
     *
     * Use as: 'permission_callback' => ptp_core()->guard()->rest_requires('parent')
     * Never use __return_true on a route that reads or writes customer data.
     */
    public function rest_requires(string $role = self::ROLE_PARENT): callable
    {
        return function () use ($role) {
            return $this->current_actor()->is($role)
                ? true
                : new WP_Error('ptp_forbidden', __('You do not have permission to do that.', 'ptp'), ['status' => 403]);
        };
    }

    /**
     * Resolve the acting user from the session. The request body is never consulted.
     *
     * Memoised per user id rather than per request: the logged-in user can change
     * mid-request — registration calls wp_set_current_user() immediately after
     * creating an account — and a plain static would keep serving the identity
     * resolved before that switch.
     */
    public function current_actor(): PTP_Actor
    {
        static $actors = [];

        $user_id = get_current_user_id();

        if (!isset($actors[$user_id])) {
            $actors[$user_id] = PTP_Actor::from_user($user_id);
        }

        return $actors[$user_id];
    }

    /**
     * Assert the actor owns the given record, or stop the request.
     *
     * $owner_id is read from the database row, never from the request. Staff
     * bypass ownership deliberately: the back office is a single-tenant
     * management surface where staff legitimately act on every record.
     */
    public function require_ownership(PTP_Actor $actor, ?int $owner_id, string $what = 'record'): void
    {
        if ($actor->is(self::ROLE_STAFF)) {
            return;
        }

        if ($owner_id === null || $owner_id !== $actor->id()) {
            $this->deny($actor, $what);
        }
    }

    /**
     * Ownership check that returns rather than exits, for callers that need to
     * filter a collection instead of rejecting a single request.
     */
    public function owns(PTP_Actor $actor, ?int $owner_id): bool
    {
        return $actor->is(self::ROLE_STAFF) || ($owner_id !== null && $owner_id === $actor->id());
    }

    private function deny(PTP_Actor $actor, string $what): void
    {
        /**
         * Denials are logged with the actor, not the target, so a probe that
         * walks IDs shows up as a burst from one account.
         */
        do_action('ptp_authorisation_denied', $actor->user_id(), $what);

        if (wp_doing_ajax()) {
            wp_send_json_error(['message' => __('You do not have permission to do that.', 'ptp')], 403);
        }

        wp_die(esc_html__('You do not have permission to do that.', 'ptp'), 403);
    }
}
