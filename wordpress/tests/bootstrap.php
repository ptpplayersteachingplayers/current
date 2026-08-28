<?php
/**
 * Minimal WordPress stub, enough to exercise PTP Core's logic outside WordPress.
 *
 * This is deliberately not a WordPress test suite. It exists so the pricing,
 * quote, discount and webhook-signature logic — the code that decides what a
 * customer is charged — can be run and asserted against in CI without a
 * database or a WordPress install.
 */

define('ABSPATH', __DIR__);
define('MINUTE_IN_SECONDS', 60);
define('HOUR_IN_SECONDS', 3600);
define('DAY_IN_SECONDS', 86400);
define('WEEK_IN_SECONDS', 604800);

// ---- option / transient store ------------------------------------------------
$GLOBALS['__options'] = [];
$GLOBALS['__transients'] = [];

function get_option($k, $d = false) { return $GLOBALS['__options'][$k] ?? $d; }
function update_option($k, $v, $a = null) { $GLOBALS['__options'][$k] = $v; return true; }
function set_transient($k, $v, $ttl = 0) { $GLOBALS['__transients'][$k] = $v; return true; }
function get_transient($k) { return $GLOBALS['__transients'][$k] ?? false; }
function delete_transient($k) { unset($GLOBALS['__transients'][$k]); return true; }

// ---- sanitisers --------------------------------------------------------------
function sanitize_text_field($s) { return is_string($s) ? trim(strip_tags($s)) : ''; }
function sanitize_textarea_field($s) { return sanitize_text_field($s); }
function sanitize_key($s) { return is_string($s) ? preg_replace('/[^a-z0-9_\-]/', '', strtolower($s)) : ''; }
function sanitize_email($s) { return filter_var($s, FILTER_VALIDATE_EMAIL) ?: ''; }
function sanitize_title($s) { return preg_replace('/[^a-z0-9\-]/', '-', strtolower(trim($s))); }
function esc_html($s) { return htmlspecialchars((string) $s, ENT_QUOTES); }
function esc_attr($s) { return esc_html($s); }
function esc_url($s) { return $s; }
function wp_kses_post($s) { return $s; }
function wp_strip_all_tags($s) { return strip_tags((string) $s); }
function absint($v) { return abs((int) $v); }
function wp_unslash($v) { return $v; }

// ---- misc --------------------------------------------------------------------
function __($s, $d = null) { return $s; }
function _n($a, $b, $n, $d = null) { return $n === 1 ? $a : $b; }
function current_time($type, $gmt = 0) { return $type === 'mysql' ? gmdate('Y-m-d H:i:s') : gmdate($type); }
function wp_generate_uuid4() { return sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x', ...array_map(fn() => random_int(0, 0xffff), range(1, 8))); }
function apply_filters($tag, $value, ...$args) {
    foreach ($GLOBALS['__filters'][$tag] ?? [] as $cb) { $value = $cb($value, ...$args); }
    return $value;
}
function add_filter($tag, $cb, $prio = 10, $args = 1) { $GLOBALS['__filters'][$tag][] = $cb; }
function do_action($tag, ...$args) { foreach ($GLOBALS['__actions'][$tag] ?? [] as $cb) { $cb(...$args); } }
function add_action($tag, $cb, $prio = 10, $args = 1) { $GLOBALS['__actions'][$tag][] = $cb; }
function user_can($u, $c) { return $GLOBALS['__caps'][$u][$c] ?? false; }
function get_current_user_id() { return $GLOBALS['__current_user'] ?? 0; }
function wp_json_encode($d) { return json_encode($d); }
if (!defined('AUTH_SALT')) { define('AUTH_SALT', 'test-salt-not-a-real-secret'); }
function trailingslashit($s) { return rtrim($s, '/\\') . '/'; }

// ---- $wpdb stub --------------------------------------------------------------
class WPDB_Stub {
    public $prefix = 'wp_';
    public $insert_id = 0;
    public array $rows = [];      // table => [row objects]
    public array $queries = [];

    public function get_charset_collate() { return ''; }

    /** Faithful enough placeholder substitution to catch unprepared SQL. */
    public function prepare($sql, ...$args) {
        if ($args && is_array($args[0]) && count($args) === 1) { $args = $args[0]; }
        $this->queries[] = $sql;
        foreach ($args as $a) {
            $rep = is_int($a) || is_float($a) ? (string) $a : "'" . addslashes((string) $a) . "'";
            $sql = preg_replace('/%[dfs]/', $rep, $sql, 1);
        }
        return $sql;
    }
    public function get_row($sql) { return $this->lookup($sql); }
    public function get_var($sql) { $r = $this->lookup($sql); return $r ? reset($r) : null; }
    /**
     * Route results by the table named in the SQL, so a class that issues
     * several queries in one call (PTP_Slots reads rules, exceptions and
     * bookings) gets the right fixture for each rather than one shared queue.
     *
     * Set $GLOBALS['__rows']['availability'] = [...] to seed a table.
     */
    public function get_results($sql) {
        foreach (($GLOBALS['__rows'] ?? []) as $table => $rows) {
            if (strpos($sql, 'ptp_' . $table) !== false) { return $rows; }
        }
        return $GLOBALS['__next_results'] ?? [];
    }
    public function get_col($sql) {
        foreach (($GLOBALS['__cols'] ?? []) as $table => $rows) {
            if (strpos($sql, 'ptp_' . $table) !== false) { return $rows; }
        }
        return $GLOBALS['__next_col'] ?? [];
    }
    public function query($sql) { $this->queries[] = $sql; return 1; }
    public function insert($t, $d, $f = null) { $this->rows[$t][] = (object) $d; $this->insert_id = count($this->rows[$t] ?? []); return 1; }
    public function update($t, $d, $w, $df = null, $wf = null) { $this->queries[] = "UPDATE $t"; return 1; }
    /** wpdb returns objects, so arrays seeded by tests are cast to match. */
    private function lookup($sql) {
        $row = $GLOBALS['__next_row'] ?? null;
        return is_array($row) ? (object) $row : $row;
    }
}
$GLOBALS['wpdb'] = new WPDB_Stub();

// ---- extra WP stubs used by the training side --------------------------------
function wp_validate_redirect($url, $fallback = '/') { return $url ?: $fallback; }
function home_url($path = '/') { return 'https://example.test' . $path; }
function add_query_arg($k, $v, $url) { return $url . (strpos($url, '?') === false ? '?' : '&') . $k . '=' . rawurlencode((string) $v); }
function is_ssl() { return true; }
function wp_remote_request($url, $args) { return $GLOBALS['__http'] ?? ['body' => '{}']; }
function wp_remote_retrieve_body($r) { return is_array($r) ? ($r['body'] ?? '') : ''; }
function is_wp_error($t) { return $t instanceof WP_Error; }
class WP_Error { public function __construct(public $c = '', public $m = '') {} public function get_error_message() { return $this->m; } }
if (!defined('COOKIEPATH')) { define('COOKIEPATH', '/'); }
if (!defined('COOKIE_DOMAIN')) { define('COOKIE_DOMAIN', ''); }

// ---- load PTP core -----------------------------------------------------------
$core = dirname(__DIR__) . '/ptp-core/includes/';
require_once $core . 'class-ptp-autoloader.php';
foreach ([
    'class-ptp-schema.php', 'class-ptp-guard.php', 'class-ptp-actor.php',
    'class-ptp-quote.php', 'class-ptp-pricing.php', 'class-ptp-pricing-exception.php',
    'class-ptp-discounts.php', 'class-ptp-discount.php', 'class-ptp-order.php',
    'repositories/class-ptp-repository.php', 'repositories/class-ptp-repository-exception.php',
    'services/class-ptp-stripe.php', 'services/class-ptp-stripe-exception.php',
    'services/class-ptp-connect.php', 'class-ptp-slots.php', 'class-ptp-booking-intent.php',
    'class-ptp-cancellation-policy.php', 'services/class-ptp-refunds.php',
] as $f) { require_once $core . $f; }

// ---- ptp_core() container stub ------------------------------------------------
/**
 * PTP_Actor::from_user() resolves the caller's domain id through the container,
 * so the container has to exist even for pure pricing tests. Noted as coupling:
 * Actor depends on ptp_core() rather than receiving its repositories.
 */
final class FakeRepo {
    public array $map = [];               // wp user id => domain id
    public array $owned = [];             // player id => parent id
    public function id_for_user(int $u): ?int { return $this->map[$u] ?? null; }
    public function belongs_to(int $player_id, $actor): bool {
        if ($actor->is(PTP_Guard::ROLE_STAFF)) { return true; }
        return ($this->owned[$player_id] ?? null) === $actor->id();
    }
}
final class FakeCore {
    public FakeRepo $parents;
    public FakeRepo $trainers;
    public FakeRepo $players;
    public function __construct() {
        $this->parents = new FakeRepo();
        $this->trainers = new FakeRepo();
        $this->players = new FakeRepo();
    }
    public function parents(): FakeRepo { return $this->parents; }
    public function trainers(): FakeRepo { return $this->trainers; }
    public function players(): FakeRepo { return $this->players; }
    public function slots(): PTP_Slots { return $this->slots ??= new PTP_Slots(); }
    public function connect(): PTP_Connect { return $this->connect ??= new PTP_Connect(); }
    private ?PTP_Slots $slots = null;
    private ?PTP_Connect $connect = null;
}
$GLOBALS['__core'] = new FakeCore();
function ptp_core(): FakeCore { return $GLOBALS['__core']; }

// ---- tiny assertion harness --------------------------------------------------
final class T {
    public static int $pass = 0;
    public static int $fail = 0;
    public static array $failures = [];

    public static function ok(bool $cond, string $what): void {
        if ($cond) { self::$pass++; echo "  ok   $what\n"; }
        else { self::$fail++; self::$failures[] = $what; echo "  FAIL $what\n"; }
    }
    public static function eq($a, $b, string $what): void {
        self::ok($a === $b, $what . ($a === $b ? '' : sprintf('  (got %s, want %s)', var_export($a, true), var_export($b, true))));
    }
    public static function throws(callable $fn, string $class, string $what): void {
        try { $fn(); self::ok(false, $what . ' (did not throw)'); }
        catch (Throwable $e) { self::ok($e instanceof $class, $what . ($e instanceof $class ? '' : ' (wrong type: ' . get_class($e) . ')')); }
    }
    public static function summary(): int {
        echo "\n" . str_repeat('=', 62) . "\n";
        printf("  %d passed, %d failed\n", self::$pass, self::$fail);
        foreach (self::$failures as $f) { echo "    FAILED: $f\n"; }
        echo str_repeat('=', 62) . "\n";
        return self::$fail === 0 ? 0 : 1;
    }
}
