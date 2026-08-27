<?php
/**
 * Training booking page.
 *
 * ---------------------------------------------------------------------------
 * The flow: pick a trainer, pick a slot, pick a player, go to checkout.
 *
 * The browser never sends a price or a duration. It sends a trainer id, a slot
 * start time and a player id; the server validates the slot against the
 * trainer's real availability, holds it, and derives the price from the
 * trainer's stored rate and the slot length. Everything the parent is charged
 * comes back from the server.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Page_Book extends PTP_Page
{
    private const AJAX_SLOTS = 'ptp_book_slots';
    private const AJAX_HOLD  = 'ptp_book_hold';

    public function register(): void
    {
        add_action('wp_ajax_' . self::AJAX_SLOTS, [$this, 'ajax_slots']);
        add_action('wp_ajax_nopriv_' . self::AJAX_SLOTS, [$this, 'ajax_slots']);
        add_action('wp_ajax_' . self::AJAX_HOLD, [$this, 'ajax_hold']);
    }

    protected function template(): string
    {
        return 'book';
    }

    protected function enqueue(): void
    {
        parent::enqueue();

        wp_enqueue_script('ptp-booking');
        wp_localize_script('ptp-booking', 'PTPBooking', [
            'ajaxUrl'     => admin_url('admin-ajax.php'),
            'slotsAction' => self::AJAX_SLOTS,
            'holdAction'  => self::AJAX_HOLD,
            'slotsNonce'  => $this->nonce(self::AJAX_SLOTS),
            'holdNonce'   => $this->nonce(self::AJAX_HOLD),
            'loginUrl'    => PTP_Public_Links::login(),
            'strings'     => [
                'noSlots'   => __('No times available in this range.', 'ptp'),
                'holding'   => __('Holding your slot…', 'ptp'),
                'pickPlayer' => __('Choose who is training.', 'ptp'),
            ],
        ]);
    }

    protected function data(array $atts): array
    {
        $atts = shortcode_atts(['trainer' => 0], $atts, 'ptp_book');

        $actor      = $this->actor();
        $trainer_id = absint($atts['trainer']);

        if ($trainer_id === 0 && isset($_GET['trainer'])) {
            $trainer_id = absint($_GET['trainer']);
        }

        return [
            'trainers'   => ptp_core()->trainers()->active(60),
            'trainer_id' => $trainer_id,
            'players'    => ptp_core()->players()->for_actor($actor),
            'is_guest'   => $actor->is_guest(),
            'login_url'  => PTP_Public_Links::login(),
            'horizon'    => PTP_Slots::HORIZON_DAYS,
        ];
    }

    /**
     * Return bookable slots for a trainer.
     *
     * Public — a parent browses availability before signing in, and nothing
     * here is sensitive. Still nonce-checked so it cannot be scraped from
     * another origin as a free availability feed.
     */
    public function ajax_slots(): void
    {
        if (!check_ajax_referer(self::AJAX_SLOTS, 'nonce', false)) {
            wp_send_json_error(['message' => __('Please refresh and try again.', 'ptp')], 403);
        }

        $trainer_id = isset($_POST['trainer_id']) ? absint($_POST['trainer_id']) : 0;

        if ($trainer_id === 0) {
            wp_send_json_error(['message' => __('Choose a trainer first.', 'ptp')], 400);
        }

        $grouped = ptp_core()->slots()->grouped_by_date(
            $trainer_id,
            isset($_POST['from']) ? sanitize_text_field(wp_unslash($_POST['from'])) : null,
            isset($_POST['to']) ? sanitize_text_field(wp_unslash($_POST['to'])) : null
        );

        $days = [];

        foreach ($grouped as $date => $slots) {
            $days[] = [
                'date'  => $date,
                'label' => date_i18n('D j M', strtotime($date)),
                'slots' => array_map(fn(array $s) => [
                    'startsAt' => $s['starts_at'],
                    'time'     => date_i18n(get_option('time_format'), strtotime($s['starts_at'])),
                    'minutes'  => $s['minutes'],
                    'location' => $s['location'],
                    'price'    => $this->money($this->price_for($trainer_id, $s['minutes'])),
                ], $slots),
            ];
        }

        wp_send_json_success(['days' => $days]);
    }

    /**
     * Hold the chosen slot and hand back the checkout URL.
     *
     * The hold is server-side and short-lived, so the slot is not offered to
     * another parent while this one pays — and if they abandon, it frees up
     * without anyone intervening.
     */
    public function ajax_hold(): void
    {
        $actor = ptp_core()->guard()->authorise_ajax(self::AJAX_HOLD);

        try {
            $intent_id = PTP_Booking_Intent::hold(
                $actor,
                isset($_POST['trainer_id']) ? absint($_POST['trainer_id']) : 0,
                isset($_POST['starts_at']) ? sanitize_text_field(wp_unslash($_POST['starts_at'])) : '',
                isset($_POST['player_id']) ? absint($_POST['player_id']) : 0
            );
        } catch (PTP_Repository_Exception $e) {
            wp_send_json_error(['message' => $e->getMessage()], 409);
        }

        PTP_Booking_Intent::remember($intent_id);

        wp_send_json_success(['checkoutUrl' => PTP_Public_Links::checkout()]);
    }

    /** Display price for a slot, derived the same way the quote will derive it. */
    private function price_for(int $trainer_id, int $minutes): int
    {
        global $wpdb;

        $hourly = (int) $wpdb->get_var(
            $wpdb->prepare(
                'SELECT hourly_cents FROM ' . PTP_Schema::table('trainers') . ' WHERE id = %d',
                $trainer_id
            )
        );

        return (int) round($hourly * $minutes / 60);
    }
}
