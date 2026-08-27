/**
 * Checkout client.
 * -----------------------------------------------------------------------------
 * This file holds no prices. The cart is a list of {type, id, qty} references;
 * every figure displayed comes back from the server's quote response, and the
 * amount charged is read server-side from the cached quote.
 *
 * Deliberately dependency-free and un-bundled. The previous checkout shipped
 * several competing scripts that each recalculated totals in the browser, which
 * is how a client-side "total" ended up being trusted by the server.
 * -----------------------------------------------------------------------------
 */
(function () {
    'use strict';

    var config = window.PTPCheckout || {};
    var CART_KEY = 'ptp_cart_v1';

    var state = {
        quoteId: null,
        intentId: null,
        busy: false
    };

    /** Read the cart, discarding anything that is not an item reference. */
    function readCart() {
        try {
            var raw = window.localStorage.getItem(CART_KEY);
            var parsed = raw ? JSON.parse(raw) : [];

            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed
                .filter(function (item) {
                    return item && item.type && item.id;
                })
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

    function post(action, nonce, fields) {
        var body = new window.FormData();
        body.append('action', action);
        body.append('nonce', nonce);

        Object.keys(fields).forEach(function (key) {
            body.append(key, fields[key]);
        });

        return window
            .fetch(config.ajaxUrl, { method: 'POST', body: body, credentials: 'same-origin' })
            .then(function (response) {
                return response.json();
            })
            .then(function (payload) {
                if (!payload || !payload.success) {
                    var message = payload && payload.data && payload.data.message
                        ? payload.data.message
                        : 'Something went wrong. Please try again.';
                    throw new Error(message);
                }

                return payload.data;
            });
    }

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

    function showError(message) {
        var box = document.getElementById('ptp-payment-error');

        if (!box) {
            return;
        }

        box.textContent = message;
        box.hidden = false;
    }

    function setBusy(busy) {
        var button = document.getElementById('ptp-pay-button');
        state.busy = busy;

        if (button) {
            button.disabled = busy;
            button.setAttribute('aria-disabled', busy ? 'true' : 'false');
        }
    }

    /**
     * Start payment.
     *
     * Sends the quote id only. The server re-reads the quote and charges its
     * total — the browser has no way to express an amount.
     */
    function startPayment() {
        if (state.busy) {
            return;
        }

        setBusy(true);

        refreshQuote()
            .then(function () {
                return post(config.intentAction, config.intentNonce, {
                    quote_id: state.quoteId,
                    intent_id: state.intentId || ''
                });
            })
            .then(function (intent) {
                state.intentId = intent.id;

                // Hand off to Stripe.js, which confirms against clientSecret.
                document.dispatchEvent(
                    new window.CustomEvent('ptp:intent-ready', { detail: intent })
                );
            })
            .catch(function (error) {
                showError(error.message);
            })
            .then(function () {
                setBusy(false);
            });
    }

    function init() {
        var button = document.getElementById('ptp-pay-button');
        var discount = document.getElementById('ptp-discount');

        if (!button) {
            return;
        }

        button.addEventListener('click', startPayment);

        if (discount) {
            var timer = null;
            discount.addEventListener('input', function () {
                window.clearTimeout(timer);
                timer = window.setTimeout(function () {
                    refreshQuote().catch(function (error) {
                        showError(error.message);
                    });
                }, 400);
            });
        }

        refreshQuote().catch(function (error) {
            showError(error.message);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
