// =============================================================================
// Every network call, in one file
// =============================================================================
// Two ways out of the browser and no third:
//
//   * PostgREST, for reads. RLS decides what comes back, so a query that
//     forgets a filter returns nothing rather than someone else's family.
//   * Edge functions, for anything that changes money or commitment. Those
//     paths need a service key or a Stripe secret, and neither exists here.
//
// Nothing in this file computes a price, a capacity or a refund. If a page
// needs a number like that, it asks.
// =============================================================================

export function createApi(client, { functionsBase, timeZone = "America/New_York" } = {}) {
  async function callFunction(name, body, { method = "POST" } = {}) {
    const { data: sessionData } = await client.auth.getSession();
    const token = sessionData?.session?.access_token;

    const response = await fetch(`${functionsBase}/${name}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      // The database's own message, where there is one — "That group is full"
      // is better than anything this layer could invent.
      throw Object.assign(new Error(payload.error ?? "Something went wrong"), {
        status: response.status,
      });
    }

    return payload;
  }

  return {
    timeZone,

    // ---- who is here ------------------------------------------------------
    auth: {
      async current() {
        const { data } = await client.auth.getUser();
        return data?.user ?? null;
      },
      signIn: (email, password) => client.auth.signInWithPassword({ email, password }),
      sendMagicLink: (email) => client.auth.signInWithOtp({ email }),
      signOut: () => client.auth.signOut(),
      onChange: (handler) => client.auth.onAuthStateChange((_event, session) => handler(session)),
    },

    // ---- settings the interface must not hard-code ------------------------
    // free_cancel_hours in particular: the page warns about the policy before
    // a parent taps, and the warning has to match whatever the policy is now.
    async settings(keys) {
      const { data, error } = await client.from("system_settings").select("key, value").in("key", keys);
      if (error) throw error;

      const out = {};
      for (const row of data ?? []) out[row.key] = row.value;
      return out;
    },

    // ---- browsing ---------------------------------------------------------
    async catalog(playerId = null) {
      const query = playerId ? `?player_id=${encodeURIComponent(playerId)}` : "";
      return await callFunction(`catalog${query}`, null, { method: "GET" });
    },

    // ---- a parent's own family -------------------------------------------
    async household() {
      const { data, error } = await client
        .from("players")
        .select("id, first_name, last_name, birth_date, skill_level, household_id")
        .order("first_name");
      if (error) throw error;
      return data ?? [];
    },

    async bookings() {
      const { data, error } = await client
        .from("bookings")
        .select(
          "id, status, price_cents, credit_id, payment_id, created_at, player_id, " +
            "players(first_name, last_name), " +
            "sessions(id, starts_at, ends_at, kind, status, group_id, " +
            "training_groups(name), locations(name, address_line, city))",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Flattened once, here, so no page has to know that PostgREST names an
      // embedded table in the plural.
      return (data ?? []).map((row) => ({
        ...row,
        player: row.players,
        session: row.sessions
          ? {
              ...row.sessions,
              group: row.sessions.training_groups,
              location: row.sessions.locations,
            }
          : null,
      }));
    },

    async credits() {
      const { data, error } = await client
        .from("package_credits")
        .select("id, state, expires_on, consumed_at, origin, booking_id")
        .order("expires_on");
      if (error) throw error;
      return data ?? [];
    },

    async payments() {
      const { data, error } = await client
        .from("payments")
        .select("id, amount_cents, refunded_cents, status, description, created_at, succeeded_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },

    // A checkout that has been paid but whose webhook has not landed yet. The
    // gap is usually a second or two and occasionally longer, and a parent who
    // has just been charged and sees nothing has every reason to pay again.
    async pendingCheckouts() {
      const { data, error } = await client
        .from("checkout_intents")
        .select("id, kind, amount_cents, state, created_at, group_id, player_id, training_groups(name)")
        .in("state", ["submitted"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },

    async waitlistPlaces() {
      const { data, error } = await client
        .from("waitlists")
        .select("id, state, position, invited_at, invite_expires_at, group_id, player_id, training_groups(name)")
        .in("state", ["waiting", "invited"]);
      if (error) throw error;
      return data ?? [];
    },

    // ---- a trainer's own work --------------------------------------------
    async mySessions(fromIso, toIso) {
      const { data, error } = await client
        .from("sessions")
        .select(
          "id, kind, status, starts_at, ends_at, paid_count, location_id, group_id, " +
            "training_groups(name), locations(name, address_line, city, parking_notes, meeting_instructions)",
        )
        .gte("starts_at", fromIso)
        .lte("starts_at", toIso)
        .order("starts_at");
      if (error) throw error;
      return data ?? [];
    },

    async myShifts(fromIso, toIso) {
      const { data, error } = await client
        .from("trainer_shifts")
        .select("id, starts_at, ends_at, status, hourly_pay_cents, anchor_session_id, acknowledged_at")
        .gte("starts_at", fromIso)
        .lte("starts_at", toIso)
        .order("starts_at");
      if (error) throw error;
      return data ?? [];
    },

    async myHours(fromIso) {
      const { data, error } = await client
        .from("trainer_hours")
        .select("id, shift_id, hours, amount_cents, worked_on, paid_out_at")
        .gte("worked_on", fromIso)
        .order("worked_on", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },

    async sessionRoster(sessionId) {
      const [bookingsResult, attendanceResult] = await Promise.all([
        client
          .from("bookings")
          .select("id, player_id, status, players(first_name, last_name)")
          .eq("session_id", sessionId),
        client.from("attendance").select("player_id, state, note").eq("session_id", sessionId),
      ]);

      if (bookingsResult.error) throw bookingsResult.error;
      if (attendanceResult.error) throw attendanceResult.error;

      return { bookings: bookingsResult.data ?? [], attendance: attendanceResult.data ?? [] };
    },

    // A trainer says yes to a block. They cannot confirm, reprice or delete
    // one — the RLS policy allows exactly this transition and no other.
    async acknowledgeShift(shiftId) {
      const { error } = await client
        .from("trainer_shifts")
        .update({ status: "acknowledged", acknowledged_at: new Date().toISOString() })
        .eq("id", shiftId);
      if (error) throw error;
    },

    // ---- things that change the world ------------------------------------
    // All of these go through an edge function. None of them takes a price.
    actions: {
      startCheckout: ({ kind, playerId, targetId, idempotencyKey }) =>
        callFunction("checkout", {
          kind,
          player_id: playerId,
          target_id: targetId,
          idempotency_key: idempotencyKey,
        }),

      bookWithCredit: ({ sessionId, playerId }) =>
        callFunction("book-with-credit", { session_id: sessionId, player_id: playerId }),

      cancelBooking: ({ bookingId, reason }) =>
        callFunction("cancel-booking", { booking_id: bookingId, reason }),

      joinWaitlist: ({ groupId, playerId }) =>
        callFunction("waitlist", { action: "join", group_id: groupId, player_id: playerId }),

      acceptWaitlist: ({ waitlistId, idempotencyKey }) =>
        callFunction("waitlist", {
          action: "accept",
          waitlist_id: waitlistId,
          idempotency_key: idempotencyKey,
        }),

      declineWaitlist: ({ waitlistId }) =>
        callFunction("waitlist", { action: "decline", waitlist_id: waitlistId }),

      recordAttendance: ({ sessionId, entries }) =>
        callFunction("attendance", { session_id: sessionId, entries }),
    },
  };
}

// An idempotency key that survives a reload, so the parent who refreshes
// mid-checkout resumes the same purchase instead of starting a second one.
export function checkoutKey(kind, playerId, targetId) {
  const name = `ptp.checkout.${kind}.${playerId}.${targetId}`;

  let key = null;
  try {
    key = localStorage.getItem(name);
  } catch {
    // Private browsing, storage disabled. A fresh key each time is worse than
    // a stable one, but begin_checkout() is still keyed on the household, and
    // Stripe still gets an idempotency key derived from the intent.
  }

  if (!key) {
    key = `${name}.${crypto.randomUUID()}`;
    try {
      localStorage.setItem(name, key);
    } catch { /* as above */ }
  }

  return key;
}

export function clearCheckoutKey(kind, playerId, targetId) {
  try {
    localStorage.removeItem(`ptp.checkout.${kind}.${playerId}.${targetId}`);
  } catch { /* nothing to clear */ }
}
