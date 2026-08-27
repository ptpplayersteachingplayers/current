/**
 * Shared portal behaviour.
 * -----------------------------------------------------------------------------
 * Both dashboards do the same thing: a button carries an action, a nonce and an
 * id; clicking it posts to admin-ajax and reflects the result. Rather than two
 * bespoke scripts, one delegated listener handles every `js-ptp-action` button.
 *
 * Every button declares its own action and nonce in data attributes, so adding
 * a new one needs no JavaScript change.
 * -----------------------------------------------------------------------------
 */
(function () {
    'use strict';

    var ajaxUrl = (window.PTPPortal && window.PTPPortal.ajaxUrl) ||
        (window.ajaxurl) ||
        '/wp-admin/admin-ajax.php';

    function post(button) {
        var body = new window.FormData();
        body.append('action', button.dataset.action);
        body.append('nonce', button.dataset.nonce);

        /**
         * Any data-field-* attribute becomes a POST field, so a button can
         * carry whatever its handler needs without new code here.
         *
         * Write the field name in snake_case after the prefix:
         *
         *   data-field-booking_id="12"  ->  POST booking_id=12
         *
         * HTML attribute names are lowercased before `dataset` sees them, so
         * `data-field-bookingId` would arrive as `fieldBookingid` and post
         * `bookingid` — a silently wrong field name. Underscores survive the
         * conversion intact; capitals do not.
         */
        Object.keys(button.dataset).forEach(function (key) {
            if (key.indexOf('field') === 0 && key.length > 5) {
                var name = key.charAt(5).toLowerCase() + key.slice(6);
                body.append(name, button.dataset[key]);
            }
        });

        return window
            .fetch(ajaxUrl, { method: 'POST', body: body, credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (payload) {
                if (!payload || !payload.success) {
                    throw new Error(
                        (payload && payload.data && payload.data.message) || 'Something went wrong.'
                    );
                }
                return payload.data;
            });
    }

    function feedback(button, message, isError) {
        var box = button.parentElement
            ? button.parentElement.querySelector('.js-ptp-feedback')
            : null;

        if (!box) {
            box = document.createElement('p');
            box.className = 'js-ptp-feedback ptp-muted';
            if (button.parentElement) { button.parentElement.appendChild(box); }
        }

        box.textContent = message;
        box.classList.toggle('ptp-field__error', Boolean(isError));
    }

    function handle(button) {
        if (button.disabled) { return; }

        var confirmText = button.dataset.confirm;

        if (confirmText && !window.confirm(confirmText)) { return; }

        button.disabled = true;

        post(button)
            .then(function (data) {
                // A handler returning a URL is an onboarding hand-off.
                if (data && data.url) {
                    window.location.href = data.url;
                    return;
                }

                feedback(button, (data && data.message) || 'Done.', false);

                if (button.dataset.reload === '1') {
                    window.location.reload();
                }
            })
            .catch(function (error) {
                feedback(button, error.message, true);
                button.disabled = false;
            });
    }

    document.addEventListener('click', function (event) {
        var button = event.target.closest ? event.target.closest('.js-ptp-action') : null;

        if (button) {
            event.preventDefault();
            handle(button);
        }
    });
})();
