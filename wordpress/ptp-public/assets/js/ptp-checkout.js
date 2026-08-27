/**
 * Checkout client.
 * -----------------------------------------------------------------------------
 * This file holds no prices. The cart is a list of {type, id, qty} references;
 * every figure displayed comes back from the server's quote response, and the
 * amount charged is read server-side from the cached quote.
 *
 * Card details never touch this code or this server. Stripe Elements renders
 * the card fields in an iframe served from Stripe's domain, so the page only
 * ever holds a client secret — which is why the site stays in PCI SAQ-A scope.
 *
 * Deliberately dependency-free apart from Stripe.js. The previous checkout
 * shipped several competing scripts that each recalculated totals in the
 * browser, which is how a client-side "total" ended up being trusted.
 * -----------------------------------------------------------------------------
 */
(function () {
    'use strict';

    var config = window.PTPCheckout || {};
    var CART_KEY = 'ptp_cart_v1';

    var state = {
        quoteId: null,
        intentId: null,
        clientSecret: null,
        returnUrl: null,
        stripe: null,
        elements: null,
        mounted: false,
        busy: false
    };

    // -- cart ------------------------------------------------------------------

    /** Read the cart, discarding anything that is not an item reference. */
    function readCart() {
        try {
            var raw = window.localStorage.getItem(CART_KEY);
            var parsed = raw ? JSON.parse(raw) : [];

            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed
                .filter(function (item) { return item && item.type && item.id; })
                .map(function (item) {
                    return {
                        type: String(item.type),
                        id: parseInt(item.id, 10) || 0,
                        qty: parseInt(item.qty, 10) || 1
                    };
                });
        } catch (e) {
            // Private mode or blocked storage — an empty cart is the safe read.
            return [];
        }
    }

    function clearCart() {
        try {
            window.localStorage.removeItem(CART_KEY);
        } catch (e) {
            /* nothing to do */
        }
    }

    // -- transport -------------------------------------------------------------

    function post(action, nonce, fields) {
        var body = new window.FormData();
        body.append('action', action);
        body.append('nonce', nonce);

        Object.keys(fields).forEach(function (key) {
            body.append(key, fields[key]);
        });

        return window
            .fetch(config.ajaxUrl, { method: 'POST', body: body, credentials: 'same-origin' })
            .then(function (response) { return response.json(); })
            .then(function (payload) {
                if (!payload || !payload.success) {
                    throw new Error(
                        (payload && payload.data && payload.data.message) || config.strings.generic
                    );
                }
                return payload.data;
            });
    }

    // -- summary ---------------------------------------------------------------

    /** Ask the server to price the cart, then render exactly what it returns. */
    function refreshQuote() {
        var discountField = document.getElementById('ptp-discount');

        return post(config.quoteAction, config.quoteNonce, {
            items: JSON.stringify(readCart()),
            discount_code: discountField ? discountField.value : ''
        }).then(function (quote) {
            state.quoteId = quote.quoteId;
            renderSummary(quote);

            return quote;
        });
    }

    function renderSummary(quote) {
        var lines = document.getElementById('ptp-summary-lines');
        var total = document.getElementById('ptp-total');

        if (lines) {
            lines.textContent = '';

            quote.lines.forEach(function (line) {
                lines.appendChild(summaryRow(line.label + ' ×' + line.qty, line.amount, ''));
            });

            if (quote.discount) {
                lines.appendChild(
                    summaryRow(quote.discountLabel || 'Discount', '-' + quote.discount, 'ptp-summary__line--discount')
                );
            }
        }

        if (total) {
            total.textContent = quote.total;
        }
    }

    /** Built with textContent throughout — server strings are never parsed as HTML. */
    function summaryRow(label, amount, modifier) {
        var row = document.createElement('div');
        row.className = 'ptp-summary__line' + (modifier ? ' ' + modifier : '');

        var left = document.createElement('span');
        left.textContent = label;

        var right = document.createElement('span');
        right.textContent = amount;

        row.appendChild(left);
        row.appendChild(right);

        return row;
    }

    // -- payment ---------------------------------------------------------------

    function showError(message) {
        var box = document.getElementById('ptp-payment-error');

        if (!box) { return; }

        box.textContent = message || '';
        box.hidden = !message;
    }

    function setBusy(busy) {
        var button = document.getElementById('ptp-pay-button');
        state.busy = busy;

        if (button) {
            button.disabled = busy;
            button.setAttribute('aria-disabled', busy ? 'true' : 'false');
            button.textContent = busy ? config.strings.processing : config.strings.pay;
        }
    }

    /**
     * Create the intent and mount Stripe's payment form.
     *
     * We send the quote id; the server re-reads the quote and creates the
     * intent for its total. There is no amount in this request.
     */
    function mountPaymentElement() {
        if (state.mounted || !state.quoteId) {
            return Promise.resolve();
        }

        return post(config.intentAction, config.intentNonce, {
            quote_id: state.quoteId,
            intent_id: ''
        }).then(function (intent) {
            state.intentId = intent.id;
            state.clientSecret = intent.clientSecret;
            state.returnUrl = intent.returnUrl;

            state.stripe = window.Stripe(config.publishableKey);
            state.elements = state.stripe.elements({
                clientSecret: intent.clientSecret,
                appearance: appearance()
            });

            state.elements.create('payment', { layout: 'tabs' }).mount('#ptp-payment-element');
            state.mounted = true;
        });
    }

    /**
     * Match Elements to the site's design tokens, read from the live stylesheet
     * so the card form follows a brand change without being updated separately.
     */
    function appearance() {
        var css = window.getComputedStyle(document.documentElement);
        var token = function (name, fallback) {
            return (css.getPropertyValue(name) || '').trim() || fallback;
        };

        return {
            theme: 'stripe',
            variables: {
                colorPrimary: token('--ptp-gold', '#FCB900'),
                colorText: token('--ptp-ink', '#0E0F11'),
                colorDanger: token('--ptp-danger', '#EF4444'),
                borderRadius: token('--ptp-radius-sm', '8px'),
                fontFamily: token('--ptp-font-body', 'system-ui, sans-serif')
            }
        };
    }

    /**
     * Confirm the payment.
     *
     * Stripe either redirects to returnUrl (for methods that need it) or
     * resolves here. Either way the order is only marked paid by the webhook,
     * so a customer who closes the tab mid-redirect still gets their booking.
     */
    function pay() {
        if (state.busy || !state.mounted) { return; }

        setBusy(true);
        showError('');

        // Re-price immediately before charging, so a cart edited in another tab
        // cannot be paid at a stale total.
        refreshQuote()
            .then(function () {
                return post(config.intentAction, config.intentNonce, {
                    quote_id: state.quoteId,
                    intent_id: state.intentId
                });
            })
            .then(function () {
                return state.stripe.confirmPayment({
                    elements: state.elements,
                    confirmParams: { return_url: state.returnUrl },
                    redirect: 'if_required'
                });
            })
            .then(function (result) {
                if (result.error) {
                    throw new Error(result.error.message || config.strings.generic);
                }

                clearCart();
                window.location.href = state.returnUrl;
            })
            .catch(function (error) {
                showError(error.message);
                setBusy(false);
            });
    }

    // -- boot ------------------------------------------------------------------

    function init() {
        var button = document.getElementById('ptp-pay-button');
        var discount = document.getElementById('ptp-discount');

        if (!button) { return; }

        button.addEventListener('click', pay);

        if (discount) {
            var timer = null;
            discount.addEventListener('input', function () {
                window.clearTimeout(timer);
                timer = window.setTimeout(function () {
                    refreshQuote().catch(function (error) { showError(error.message); });
                }, 400);
            });
        }

        refreshQuote()
            .then(mountPaymentElement)
            .catch(function (error) { showError(error.message); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
