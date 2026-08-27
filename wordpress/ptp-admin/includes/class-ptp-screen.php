<?php
/**
 * Base class for every back-office screen.
 *
 * ---------------------------------------------------------------------------
 * The capability check runs inside render(), not only on the menu registration
 * that points at it. The audit found several admin methods whose only
 * protection was that WordPress happened to register them behind a
 * manage_options menu — safe until someone called them from anywhere else.
 *
 * Mutating actions run through action(), which requires a nonce even for GET
 * links. A trainer delete triggered by a bare ?delete_trainer=ID was
 * exploitable with an <img> tag on any page an admin visited.
 * ---------------------------------------------------------------------------
 */

if (!defined('ABSPATH')) {
    exit;
}

abstract class PTP_Screen
{
    abstract public function title(): string;

    abstract protected function body(): void;

    public function menu_label(): string
    {
        return $this->title();
    }

    public function capability(): string
    {
        return 'manage_options';
    }

    /** Hook AJAX handlers here. */
    public function register(): void
    {
    }

    final public function render(): void
    {
        // Checked here, independently of how this screen was reached.
        if (!current_user_can($this->capability())) {
            wp_die(esc_html__('You do not have permission to view this page.', 'ptp'), 403);
        }

        $this->handle_actions();

        echo '<div class="wrap ptp-admin">';
        printf('<h1 class="ptp-admin__title">%s</h1>', esc_html($this->title()));
        $this->body();
        echo '</div>';
    }

    /**
     * Dispatch a ?ptp_action=... request.
     *
     * Every action is nonce-verified before it runs, regardless of HTTP method.
     * Subclasses implement do_<action>() and never parse the request themselves.
     */
    private function handle_actions(): void
    {
        $action = isset($_REQUEST['ptp_action']) ? sanitize_key(wp_unslash($_REQUEST['ptp_action'])) : '';

        if ($action === '') {
            return;
        }

        $method = 'do_' . $action;

        if (!method_exists($this, $method)) {
            return;
        }

        ptp_core()->guard()->authorise_admin_request('ptp_' . $action, $this->capability());

        $this->$method();
    }

    /** Build a nonce-carrying action URL. */
    protected function action_url(string $action, array $args = []): string
    {
        $url = add_query_arg(
            array_merge(['ptp_action' => $action], $args),
            admin_url('admin.php?page=' . $this->slug())
        );

        return wp_nonce_url($url, 'ptp_' . $action);
    }

    protected function slug(): string
    {
        return isset($_GET['page']) ? sanitize_key(wp_unslash($_GET['page'])) : PTP_Admin::MENU_SLUG;
    }

    protected function notice(string $message, string $type = 'success'): void
    {
        printf(
            '<div class="notice notice-%s is-dismissible"><p>%s</p></div>',
            esc_attr($type),
            esc_html($message)
        );
    }

    protected function money(int $cents): string
    {
        return '$' . number_format($cents / 100, 2);
    }

    protected function empty_state(string $message): void
    {
        printf('<p class="ptp-admin__empty">%s</p>', esc_html($message));
    }
}
