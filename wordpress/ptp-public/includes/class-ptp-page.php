<?php
/**
 * Base class for every front-end page.
 *
 * Gives each page one render path, one template, one stylesheet dependency and
 * an escaping-by-default view helper. Pages never echo directly — they hand a
 * data array to a template, which keeps output escaping in one reviewable place
 * instead of scattered through 3,000-line procedural templates.
 */

if (!defined('ABSPATH')) {
    exit;
}

abstract class PTP_Page
{
    /** Template file under templates/, without extension. */
    abstract protected function template(): string;

    /**
     * Build the view model. Return an array; the template receives it as $data.
     *
     * @param array<string, mixed> $atts
     * @return array<string, mixed>
     */
    abstract protected function data(array $atts): array;

    /** Optional: register AJAX handlers, rewrite tags, etc. */
    public function register(): void
    {
    }

    /** Shortcode entry point. */
    public function render($atts = [], $content = null): string
    {
        $atts = is_array($atts) ? $atts : [];

        $this->enqueue();

        try {
            $data = $this->data($atts);
        } catch (Throwable $e) {
            return $this->render_error($e);
        }

        return $this->view($this->template(), $data);
    }

    protected function enqueue(): void
    {
        wp_enqueue_style('ptp-public');
    }

    /** The current caller, resolved from the session by Core. */
    protected function actor(): PTP_Actor
    {
        return ptp_core()->guard()->current_actor();
    }

    /**
     * Render a template with a scoped data array.
     *
     * @param array<string, mixed> $data
     */
    protected function view(string $template, array $data): string
    {
        $path = PTP_PUBLIC_DIR . 'templates/' . $template . '.php';

        if (!is_readable($path)) {
            return '';
        }

        ob_start();
        require $path;

        return (string) ob_get_clean();
    }

    /**
     * Errors are shown to customers as plain language and logged with detail.
     * The exception message is never printed — several old handlers leaked
     * internal state into the page this way.
     */
    protected function render_error(Throwable $e): string
    {
        do_action('ptp_page_error', static::class, $e->getMessage());

        $message = $e instanceof PTP_Pricing_Exception || $e instanceof PTP_Repository_Exception
            ? $e->getMessage()
            : __('Something went wrong loading this page. Please refresh and try again.', 'ptp');

        return sprintf(
            '<div class="ptp-notice ptp-notice--error" role="alert">%s</div>',
            esc_html($message)
        );
    }

    /** Nonce value for this page's AJAX action. */
    protected function nonce(string $action): string
    {
        return wp_create_nonce($action);
    }

    protected function money(int $cents): string
    {
        return '$' . number_format($cents / 100, 2);
    }
}
