<?php
/**
 * The slot a parent has chosen, held server-side between booking and payment.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Booking training is two steps: pick a slot, then pay. The slot has to survive
 * that gap without the browser being able to change it — otherwise a parent
 * could pick a 30-minute slot, get quoted for 30 minutes, then submit 90.
 *
 * So the chosen slot is stored server-side against the user's session and
 * re-read by the pricing resolver. The browser holds an intent id, nothing
 * more. This is the same shape as PTP_Quote: the client carries a reference,
 * the server carries the values.
 *
 * The intent also acts as a soft hold. A slot inside an unexpired intent is
 * not offered to another parent, which stops two families paying for the same
 * Tuesday 5pm and one of them getting a refund and an apology.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Booking_Intent
{
    /** A held slot is released if payment is not completed within this window. */
    private const HOLD_TTL = 20 * MINUTE_IN_SECONDS;

    private const PREFIX = 'ptp_intent_';

    /**
     * Hold a slot for the current user.
     *
     * Validates the slot against the trainer's real availability before
     * holding it, so a hand-crafted request cannot reserve 3am on a closed day.
     *
     * @return string the intent id the browser carries
     */
    public static function hold(PTP_Actor $actor, int $trainer_id, string $starts_at, int $player_id): string
    {
        if ($actor->id() === null) {
            throw new PTP_Repository_Exception(__('Please log in to book a session.', 'ptp'));
        }

        if ($player_id > 0 && !ptp_core()->players()->belongs_to($player_id, $actor)) {
            throw new PTP_Repository_Exception(__('That player is not on your account.', 'ptp'));
        }

        $slots   = ptp_core()->slots();
        $minutes = $slots->minutes_for($trainer_id, $starts_at);

        if ($minutes === null) {
            throw new PTP_Repository_Exception(__('That time is no longer available. Please pick another.', 'ptp'));
        }

        if (self::is_held_by_other($trainer_id, $starts_at, $actor->user_id())) {
            throw new PTP_Repository_Exception(__('Someone else is booking that time right now. Please pick another.', 'ptp'));
        }

        $intent_id = wp_generate_uuid4();

        set_transient(self::PREFIX . $intent_id, [
            'trainer_id' => $trainer_id,
            'starts_at'  => $starts_at,
            'minutes'    => $minutes,
            'player_id'  => $player_id,
            'user_id'    => $actor->user_id(),
            'expires_at' => time() + self::HOLD_TTL,
        ], self::HOLD_TTL);

        self::index_hold($trainer_id, $starts_at, $intent_id, $actor->user_id());

        return $intent_id;
    }

    /**
     * The held slot for the current user, or null.
     *
     * @return array{trainer_id: int, starts_at: string, minutes: int, player_id: int}|null
     */
    public static function current(PTP_Actor $actor): ?array
    {
        $intent_id = self::current_id();

        if ($intent_id === '') {
            return null;
        }

        $raw = get_transient(self::PREFIX . $intent_id);

        if (!is_array($raw) || (int) ($raw['user_id'] ?? 0) !== $actor->user_id()) {
            return null;
        }

        if (time() > (int) ($raw['expires_at'] ?? 0)) {
            return null;
        }

        return [
            'trainer_id' => (int) $raw['trainer_id'],
            'starts_at'  => (string) $raw['starts_at'],
            'minutes'    => (int) $raw['minutes'],
            'player_id'  => (int) $raw['player_id'],
        ];
    }

    /**
     * Slot length for a trainer in the current request's intent.
     *
     * Called by the training price resolver. Returns null when there is no
     * intent, which makes the resolver fall back to its default length rather
     * than pricing something the parent did not choose.
     */
    public static function minutes_for_trainer(int $trainer_id): ?int
    {
        $actor  = ptp_core()->guard()->current_actor();
        $intent = self::current($actor);

        if ($intent === null || $intent['trainer_id'] !== $trainer_id) {
            return null;
        }

        return $intent['minutes'];
    }

    /** Convert the held intent into a real booking once payment has settled. */
    public static function realise(PTP_Actor $actor, int $order_id): ?int
    {
        $intent = self::current($actor);

        if ($intent === null) {
            return null;
        }

        // Re-check availability: the hold may have expired while paying.
        if (!ptp_core()->slots()->is_bookable($intent['trainer_id'], $intent['starts_at'])) {
            do_action('ptp_booking_slot_lost', $actor->user_id(), $intent);

            return null;
        }

        $ends_at = (new DateTimeImmutable($intent['starts_at']))
            ->modify('+' . $intent['minutes'] . ' minutes')
            ->format('Y-m-d H:i:s');

        $booking_id = ptp_core()->bookings()->create($actor, [
            'order_id'     => $order_id,
            'player_id'    => $intent['player_id'],
            'trainer_id'   => $intent['trainer_id'],
            'booking_type' => 'training',
            'starts_at'    => $intent['starts_at'],
            'ends_at'      => $ends_at,
        ]);

        ptp_core()->bookings()->mark_confirmed($booking_id);
        self::release($actor);

        return $booking_id;
    }

    public static function release(PTP_Actor $actor): void
    {
        $intent_id = self::current_id();

        if ($intent_id !== '') {
            delete_transient(self::PREFIX . $intent_id);
            self::forget_cookie();
        }
    }

    /** Remember the intent id in a short-lived, http-only cookie. */
    public static function remember(string $intent_id): void
    {
        if (headers_sent()) {
            return;
        }

        setcookie(self::PREFIX . 'id', $intent_id, [
            'expires'  => time() + self::HOLD_TTL,
            'path'     => COOKIEPATH ?: '/',
            'domain'   => COOKIE_DOMAIN,
            'secure'   => is_ssl(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);

        $_COOKIE[self::PREFIX . 'id'] = $intent_id;
    }

    // -- internals ------------------------------------------------------------

    private static function current_id(): string
    {
        return isset($_COOKIE[self::PREFIX . 'id'])
            ? sanitize_text_field(wp_unslash($_COOKIE[self::PREFIX . 'id']))
            : '';
    }

    private static function forget_cookie(): void
    {
        unset($_COOKIE[self::PREFIX . 'id']);

        if (!headers_sent()) {
            setcookie(self::PREFIX . 'id', '', time() - 3600, COOKIEPATH ?: '/', COOKIE_DOMAIN);
        }
    }

    /**
     * A slot-level index of live holds, so PTP_Slots can exclude a slot another
     * parent is mid-checkout on without scanning every intent transient.
     */
    private static function index_hold(int $trainer_id, string $starts_at, string $intent_id, int $user_id): void
    {
        set_transient(
            self::hold_key($trainer_id, $starts_at),
            ['intent_id' => $intent_id, 'user_id' => $user_id],
            self::HOLD_TTL
        );
    }

    private static function is_held_by_other(int $trainer_id, string $starts_at, int $user_id): bool
    {
        $hold = get_transient(self::hold_key($trainer_id, $starts_at));

        return is_array($hold) && (int) ($hold['user_id'] ?? 0) !== $user_id;
    }

    /** Public so PTP_Slots can consult the same key. */
    public static function hold_key(int $trainer_id, string $starts_at): string
    {
        return 'ptp_hold_' . $trainer_id . '_' . md5($starts_at);
    }
}
