<?php
/**
 * The REST surface consumed by the mobile app.
 *
 * ---------------------------------------------------------------------------
 * Lives in core because the mobile app is a client of the same data as the
 * website, not a separate product. Both go through the same repositories,
 * the same Guard, and the same pricing engine — so a bug fixed for the web is
 * fixed for mobile, and an authorisation rule cannot be enforced in one and
 * forgotten in the other.
 *
 * Every route that touches customer data declares a permission_callback built
 * by PTP_Guard. The audit found the old mobile API exposing assessments and
 * bookings on routes that authenticated the caller but never checked whether
 * the record belonged to them; here the repositories scope by actor in SQL, so
 * a route physically cannot return another family's row.
 *
 * Authentication is WordPress application passwords or a JWT plugin — this
 * class does not issue tokens. It reads whatever WordPress has already
 * resolved as the current user.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Api
{
    private const NAMESPACE = 'ptp/v2';

    public function register_hooks(): void
    {
        add_action('rest_api_init', [$this, 'register_routes']);
    }

    public function register_routes(): void
    {
        $guard = ptp_core()->guard();

        // -- public catalogue --------------------------------------------------
        $this->get('/trainers', [$this, 'trainers'], '__return_true');
        $this->get('/trainers/(?P<id>\d+)', [$this, 'trainer'], '__return_true');
        $this->get('/trainers/(?P<id>\d+)/slots', [$this, 'slots'], '__return_true');
        $this->get('/camps', [$this, 'camps'], '__return_true');

        // -- the signed-in parent ---------------------------------------------
        $this->get('/me', [$this, 'me'], $guard->rest_requires(PTP_Guard::ROLE_PARENT));
        $this->get('/me/players', [$this, 'players'], $guard->rest_requires(PTP_Guard::ROLE_PARENT));
        $this->get('/me/bookings', [$this, 'bookings'], $guard->rest_requires(PTP_Guard::ROLE_PARENT));
        $this->get('/me/orders', [$this, 'orders'], $guard->rest_requires(PTP_Guard::ROLE_PARENT));

        $this->post('/bookings/hold', [$this, 'hold_slot'], $guard->rest_requires(PTP_Guard::ROLE_PARENT));
        $this->post('/bookings/(?P<id>\d+)/cancel', [$this, 'cancel_booking'], $guard->rest_requires(PTP_Guard::ROLE_PARENT));

        // -- the signed-in trainer --------------------------------------------
        $this->get('/trainer/schedule', [$this, 'trainer_schedule'], $guard->rest_requires(PTP_Guard::ROLE_TRAINER));
        $this->get('/trainer/earnings', [$this, 'trainer_earnings'], $guard->rest_requires(PTP_Guard::ROLE_TRAINER));
        $this->get('/trainer/availability', [$this, 'trainer_availability'], $guard->rest_requires(PTP_Guard::ROLE_TRAINER));
        $this->post('/trainer/availability', [$this, 'add_availability'], $guard->rest_requires(PTP_Guard::ROLE_TRAINER));
        $this->post('/trainer/sessions/(?P<id>\d+)/complete', [$this, 'complete_session'], $guard->rest_requires(PTP_Guard::ROLE_TRAINER));
    }

    // -- public ---------------------------------------------------------------

    public function trainers(WP_REST_Request $request): WP_REST_Response
    {
        $rows = ptp_core()->trainers()->active(min(100, max(1, (int) $request->get_param('per_page') ?: 40)));

        return $this->ok(array_map([$this, 'present_trainer'], $rows));
    }

    public function trainer(WP_REST_Request $request)
    {
        global $wpdb;

        $trainer = $wpdb->get_row(
            $wpdb->prepare(
                'SELECT * FROM ' . PTP_Schema::table('trainers') . ' WHERE id = %d AND status = %s',
                (int) $request['id'],
                'active'
            )
        );

        if ($trainer === null) {
            return $this->not_found(__('Trainer not found.', 'ptp'));
        }

        return $this->ok($this->present_trainer($trainer, true));
    }

    /** Availability is public: parents browse before signing in. */
    public function slots(WP_REST_Request $request): WP_REST_Response
    {
        $grouped = ptp_core()->slots()->grouped_by_date(
            (int) $request['id'],
            $request->get_param('from') ? sanitize_text_field((string) $request->get_param('from')) : null,
            $request->get_param('to') ? sanitize_text_field((string) $request->get_param('to')) : null
        );

        $days = [];

        foreach ($grouped as $date => $slots) {
            $days[] = [
                'date'  => $date,
                'slots' => array_map(static fn(array $s) => [
                    'startsAt' => $s['starts_at'],
                    'endsAt'   => $s['ends_at'],
                    'minutes'  => $s['minutes'],
                    'location' => $s['location'],
                ], $slots),
            ];
        }

        return $this->ok($days);
    }

    public function camps(WP_REST_Request $request): WP_REST_Response
    {
        $posts = get_posts([
            'post_type'      => 'ptp_camp',
            'posts_per_page' => min(100, max(1, (int) $request->get_param('per_page') ?: 40)),
            'meta_key'       => '_ptp_starts_at',
            'orderby'        => 'meta_value',
            'order'          => 'ASC',
        ]);

        return $this->ok(array_map(static fn(WP_Post $p) => [
            'id'         => $p->ID,
            'name'       => get_the_title($p),
            'image'      => get_the_post_thumbnail_url($p, 'large') ?: null,
            'priceCents' => (int) get_post_meta($p->ID, '_ptp_price_cents', true),
            'startsAt'   => (string) get_post_meta($p->ID, '_ptp_starts_at', true),
            'location'   => (string) get_post_meta($p->ID, '_ptp_location', true),
            'url'        => get_permalink($p),
        ], $posts));
    }

    // -- parent ---------------------------------------------------------------

    public function me(): WP_REST_Response
    {
        $actor  = $this->actor();
        $parent = ptp_core()->parents()->find_for($actor);

        return $this->ok([
            'id'        => $actor->id(),
            'role'      => $actor->role(),
            'firstName' => $parent->first_name ?? '',
            'lastName'  => $parent->last_name ?? '',
            'email'     => $parent->email ?? '',
            'phone'     => $parent->phone ?? '',
        ]);
    }

    public function players(): WP_REST_Response
    {
        $rows = ptp_core()->players()->for_actor($this->actor());

        return $this->ok(array_map(static fn(object $p) => [
            'id'        => (int) $p->id,
            'firstName' => $p->first_name,
            'lastName'  => $p->last_name,
            'birthDate' => $p->birth_date,
            'position'  => $p->position,
        ], $rows));
    }

    public function bookings(): WP_REST_Response
    {
        $rows = ptp_core()->bookings()->upcoming_for($this->actor(), 50);

        return $this->ok(array_map([$this, 'present_booking'], $rows));
    }

    public function orders(): WP_REST_Response
    {
        $rows = ptp_core()->orders()->history_for($this->actor(), 50);

        return $this->ok(array_map(static fn(object $o) => [
            'id'          => (int) $o->id,
            'status'      => $o->status,
            'totalCents'  => (int) $o->total_cents,
            'createdAt'   => $o->created_at,
        ], $rows));
    }

    /**
     * Hold a slot and return the intent id.
     *
     * The app then sends the customer through the same checkout as the web,
     * so there is one payment path rather than a mobile-specific one — the
     * mistake that produced two of the audit's payment-bypass bugs.
     */
    public function hold_slot(WP_REST_Request $request)
    {
        try {
            $intent_id = PTP_Booking_Intent::hold(
                $this->actor(),
                (int) $request->get_param('trainerId'),
                sanitize_text_field((string) $request->get_param('startsAt')),
                (int) $request->get_param('playerId')
            );
        } catch (PTP_Repository_Exception $e) {
            return $this->error($e->getMessage(), 409);
        }

        PTP_Booking_Intent::remember($intent_id);

        return $this->ok([
            'intentId'    => $intent_id,
            'checkoutUrl' => add_query_arg('intent', $intent_id, home_url('/checkout/')),
        ]);
    }

    public function cancel_booking(WP_REST_Request $request)
    {
        try {
            $result = ptp_core()->bookings()->cancel($this->actor(), (int) $request['id']);
        } catch (PTP_Repository_Exception $e) {
            return $this->error($e->getMessage(), 404);
        }

        return $this->ok([
            'cancelled'      => true,
            'refundedCents'  => $result['refunded_cents'],
            'reason'         => $result['reason'],
        ]);
    }

    // -- trainer --------------------------------------------------------------

    public function trainer_schedule(): WP_REST_Response
    {
        $rows = ptp_core()->bookings()->upcoming_for($this->actor(), 100);

        return $this->ok(array_map([$this, 'present_booking'], $rows));
    }

    public function trainer_earnings(): WP_REST_Response
    {
        $earnings = ptp_core()->connect()->earnings_for($this->actor());

        return $this->ok([
            'pendingCents'  => $earnings['pending_cents'],
            'clearingCents' => $earnings['clearing_cents'],
            'paidCents'     => $earnings['paid_cents'],
            'connected'     => $earnings['connected'],
            // What this trainer earns, as assigned by staff.
            'rateCents'     => $earnings['rate_cents'],
            'rateBasis'     => $earnings['rate_basis'],
        ]);
    }

    public function trainer_availability(): WP_REST_Response
    {
        $actor = $this->actor();

        return $this->ok([
            'rules'   => array_map(static fn(object $r) => [
                'id'          => (int) $r->id,
                'weekday'     => (int) $r->weekday,
                'startsTime'  => $r->starts_time,
                'endsTime'    => $r->ends_time,
                'location'    => $r->location,
                'slotMinutes' => (int) $r->slot_minutes,
            ], ptp_core()->availability()->rules_for($actor)),
            'blocked' => array_map(static fn(object $b) => $b->on_date, ptp_core()->availability()->blocked_dates($actor)),
        ]);
    }

    public function add_availability(WP_REST_Request $request)
    {
        try {
            $id = ptp_core()->availability()->add_rule($this->actor(), [
                'weekday'      => $request->get_param('weekday'),
                'starts_time'  => $request->get_param('startsTime'),
                'ends_time'    => $request->get_param('endsTime'),
                'location'     => $request->get_param('location'),
                'slot_minutes' => $request->get_param('slotMinutes'),
            ]);
        } catch (PTP_Repository_Exception $e) {
            return $this->error($e->getMessage(), 400);
        }

        return $this->ok(['id' => $id]);
    }

    /**
     * Mark a session delivered. This is what releases the trainer's payout, so
     * the ownership check matters: find_for scopes to the acting trainer.
     */
    public function complete_session(WP_REST_Request $request)
    {
        $actor   = $this->actor();
        $booking = ptp_core()->bookings()->find_for($actor, (int) $request['id']);

        if ($booking === null) {
            return $this->not_found(__('Session not found.', 'ptp'));
        }

        if ($booking->starts_at > current_time('mysql', true)) {
            return $this->error(__('That session has not happened yet.', 'ptp'), 400);
        }

        ptp_core()->bookings()->mark_completed((int) $booking->id);

        return $this->ok(['completed' => true]);
    }

    // -- helpers --------------------------------------------------------------

    private function actor(): PTP_Actor
    {
        return ptp_core()->guard()->current_actor();
    }

    /** @return array<string, mixed> */
    private function present_trainer(object $t, bool $detailed = false): array
    {
        $data = [
            'id'          => (int) $t->id,
            'name'        => $t->display_name,
            'slug'        => $t->slug,
            'hourlyCents' => (int) $t->hourly_cents,
        ];

        if ($detailed) {
            $data['bio'] = wp_kses_post((string) $t->bio);
        }

        return $data;
    }

    /** @return array<string, mixed> */
    private function present_booking(object $b): array
    {
        $policy = ptp_core()->cancellation_policy();

        return [
            'id'       => (int) $b->id,
            'type'     => $b->booking_type,
            'startsAt' => $b->starts_at,
            'endsAt'   => $b->ends_at,
            'location' => $b->location,
            'status'   => $b->status,
            'playerId' => $b->player_id !== null ? (int) $b->player_id : null,
            /**
             * The app shows this before asking the parent to confirm, so the
             * refund rule is never a surprise after the fact.
             */
            'cancellationNote' => $policy->describe((string) $b->starts_at),
            'refundable'       => $policy->decide((string) $b->starts_at)['refund'],
        ];
    }

    private function get(string $route, callable $cb, $permission): void
    {
        register_rest_route(self::NAMESPACE, $route, [
            'methods'             => 'GET',
            'callback'            => $cb,
            'permission_callback' => $permission,
        ]);
    }

    private function post(string $route, callable $cb, $permission): void
    {
        register_rest_route(self::NAMESPACE, $route, [
            'methods'             => 'POST',
            'callback'            => $cb,
            'permission_callback' => $permission,
        ]);
    }

    private function ok($data): WP_REST_Response
    {
        return new WP_REST_Response(['data' => $data], 200);
    }

    private function error(string $message, int $status): WP_REST_Response
    {
        return new WP_REST_Response(['error' => ['message' => $message]], $status);
    }

    private function not_found(string $message): WP_REST_Response
    {
        return $this->error($message, 404);
    }
}
