/**
 * Booking client.
 * -----------------------------------------------------------------------------
 * Holds a trainer id, a slot start time and a player id. Nothing else. Prices
 * and durations come back from the server with the slot list and are rendered,
 * never sent — the server re-derives both when it prices the quote.
 * -----------------------------------------------------------------------------
 */
(function () {
    'use strict';

    var config = window.PTPBooking || {};

    var state = {
        trainerId: null,
        startsAt: null,
        busy: false
    };

    function el(id) {
        return document.getElementById(id);
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

    function showError(message) {
        var box = el('ptp-book-error');
        if (!box) { return; }
        box.textContent = message || '';
        box.hidden = !message;
    }

    function setContinueEnabled(enabled) {
        var button = el('ptp-book-continue');
        if (!button) { return; }
        button.disabled = !enabled;
        button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    }

    /** Render the day/slot list. Built with DOM nodes, never innerHTML. */
    function renderSlots(days) {
        var container = el('ptp-slots');
        if (!container) { return; }

        container.textContent = '';

        if (!days || days.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'ptp-empty';
            empty.textContent = config.strings.noSlots;
            container.appendChild(empty);
            return;
        }

        days.forEach(function (day) {
            var group = document.createElement('div');
            group.className = 'ptp-slots__day';

            var heading = document.createElement('h3');
            heading.className = 'ptp-slots__date';
            heading.textContent = day.label;
            group.appendChild(heading);

            var list = document.createElement('div');
            list.className = 'ptp-slots__times';

            day.slots.forEach(function (slot) {
                var button = document.createElement('button');
                button.type = 'button';
                button.className = 'ptp-slot';
                button.dataset.startsAt = slot.startsAt;

                var time = document.createElement('span');
                time.className = 'ptp-slot__time';
                time.textContent = slot.time;

                var meta = document.createElement('span');
                meta.className = 'ptp-slot__meta';
                meta.textContent = slot.minutes + ' min · ' + slot.price;

                button.appendChild(time);
                button.appendChild(meta);

                if (slot.location) {
                    var where = document.createElement('span');
                    where.className = 'ptp-slot__meta';
                    where.textContent = slot.location;
                    button.appendChild(where);
                }

                button.addEventListener('click', function () {
                    selectSlot(slot.startsAt, button);
                });

                list.appendChild(button);
            });

            group.appendChild(list);
            container.appendChild(group);
        });
    }

    function selectSlot(startsAt, button) {
        state.startsAt = startsAt;

        Array.prototype.forEach.call(
            document.querySelectorAll('.ptp-slot'),
            function (node) {
                node.classList.toggle('ptp-slot--selected', node === button);
                node.setAttribute('aria-pressed', node === button ? 'true' : 'false');
            }
        );

        showError('');
        setContinueEnabled(true);
    }

    function loadSlots() {
        var container = el('ptp-slots');

        if (!state.trainerId) {
            if (container) { container.textContent = ''; }
            setContinueEnabled(false);
            return;
        }

        state.startsAt = null;
        setContinueEnabled(false);

        post(config.slotsAction, config.slotsNonce, { trainer_id: state.trainerId })
            .then(function (data) { renderSlots(data.days); })
            .catch(function (error) { showError(error.message); });
    }

    /**
     * Hold the slot, then follow the server's checkout URL. The hold is what
     * stops a second parent buying the same slot during this checkout.
     */
    function continueToPayment() {
        if (state.busy || !state.startsAt) { return; }

        var playerSelect = el('ptp-player');
        state.busy = true;
        setContinueEnabled(false);
        showError('');

        post(config.holdAction, config.holdNonce, {
            trainer_id: state.trainerId,
            starts_at: state.startsAt,
            player_id: playerSelect ? playerSelect.value : 0
        })
            .then(function (data) {
                window.location.href = data.checkoutUrl;
            })
            .catch(function (error) {
                showError(error.message);
                // A lost slot means the list is stale, so refresh it.
                loadSlots();
            })
            .then(function () {
                state.busy = false;
            });
    }

    function init() {
        var trainerSelect = el('ptp-trainer');
        var continueButton = el('ptp-book-continue');

        if (!trainerSelect) { return; }

        trainerSelect.addEventListener('change', function () {
            state.trainerId = trainerSelect.value || null;
            loadSlots();
        });

        if (continueButton) {
            continueButton.addEventListener('click', continueToPayment);
        }

        // Deep link from a trainer profile arrives with the select pre-filled.
        if (trainerSelect.value) {
            state.trainerId = trainerSelect.value;
            loadSlots();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
