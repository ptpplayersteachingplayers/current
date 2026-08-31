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

    // Camps are read straight through PostgREST rather than an edge function:
    // the RLS policy already says exactly which ones are public, so a second
    // filter in a function would be a second place to get it wrong.
    async camps({ state = null, limit = 24 } = {}) {
      let query = client
        .from("camps")
        .select(
          "id, name, slug, city, state, region, postal_code, field_name, address_line, " +
            "starts_on, ends_on, daily_starts_at, daily_ends_at, half_day_ends_at, " +
            "min_age, max_age, full_day_price_cents, half_day_price_cents, " +
            "offers_full_day, offers_half_day, capacity, status, featured_image_url",
        )
        .in("status", ["registration_open", "limited", "full", "waitlist", "early_access"])
        .order("starts_on")
        .limit(limit);

      if (state) query = query.eq("state", state);

      const { data, error } = await query;
      if (error) throw error;

      const camps = await withOccupancy(data ?? []);
      return { camps };
    },

    // The ZIP search. camps_near() is the same function behind the state and
    // city pages, so all three agree about what is on sale.
    async campsNear({ zip = null, radius = 40, state = null, city = null,
                      age = null, dayOption = null } = {}) {
      const { data: rows, error } = await client.rpc("camps_near", {
        p_postal_code: zip,
        p_radius_miles: radius,
        p_state: state,
        p_city: city,
        p_age: age,
        p_day_option: dayOption,
      });
      if (error) throw error;

      if ((rows ?? []).length === 0) return { camps: [] };

      const { data: camps, error: campError } = await client
        .from("camps")
        .select(
          "id, name, slug, city, state, region, postal_code, field_name, address_line, " +
            "starts_on, ends_on, daily_starts_at, daily_ends_at, half_day_ends_at, " +
            "min_age, max_age, full_day_price_cents, half_day_price_cents, " +
            "offers_full_day, offers_half_day, capacity, status, featured_image_url",
        )
        .in("id", rows.map((r) => r.camp_id));
      if (campError) throw campError;

      const distance = new Map(rows.map((r) => [r.camp_id, r]));

      const ordered = rows
        .map((r) => {
          const camp = (camps ?? []).find((c) => c.id === r.camp_id);
          return camp && { ...camp, distance_miles: r.distance_miles, spots_left: r.spots_left };
        })
        .filter(Boolean);

      return { camps: ordered, distances: distance };
    },

    async camp(slug) {
      const { data: camp, error } = await client
        .from("camps")
        .select("*")
        .eq("slug", slug)
        .single();
      if (error) throw error;

      const [days, staffing, addons, occupancy] = await Promise.all([
        client.from("camp_sessions").select("id, session_date, starts_at, ends_at, status")
          .eq("camp_id", camp.id).order("session_date"),
        client.from("camp_staffing").select("role, is_featured, trainers(display_name, slug, bio)")
          .eq("camp_id", camp.id).eq("status", "accepted"),
        client.from("camp_addons").select("id, code, name, description, price_cents")
          .eq("camp_id", camp.id).eq("active", true),
        client.rpc("camp_occupancy", { p_camp_id: camp.id }).single(),
      ]);

      return {
        camp,
        days: days.data ?? [],
        staffing: staffing.data ?? [],
        addons: addons.data ?? [],
        occupancy: occupancy.data ?? null,
      };
    },

    // Is the person signed in a coach? The trainers table is readable to
    // anonymous visitors as a directory, so this asks specifically for the row
    // that belongs to this sign-in.
    async myTrainerProfile() {
      const { data: userData } = await client.auth.getUser();
      if (!userData?.user) return null;

      const { data, error } = await client
        .from("trainers")
        .select("id, display_name, slug, status")
        .eq("auth_user_id", userData.user.id)
        .maybeSingle();

      if (error) throw error;
      return data ?? null;
    },

    // The public private-training board. The block rule is applied in the
    // database, so this cannot show a slot that would send a coach across town
    // for one isolated hour.
    async privateSlots({ from = null, to = null } = {}) {
      const { data, error } = await client.rpc("offerable_private_slots_all", {
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return data ?? [];
    },

    async trainers() {
      const { data, error } = await client
        .from("trainers")
        .select("id, display_name, slug, bio, photo_url")
        .eq("status", "active")
        .order("display_name");
      if (error) throw error;
      return data ?? [];
    },

    // Early access. Anyone may add themselves; nobody may read the list back,
    // which is what the insert-only policy on camp_interest says.
    async registerInterest(payload) {
      const { error } = await client.from("camp_interest").insert(payload);
      if (error) throw error;
    },

    async myCampRegistrations() {
      const { data, error } = await client
        .from("camp_registrations")
        .select("id, status, day_option, price_cents, created_at, " +
                "players(first_name, last_name), " +
                "camps(name, slug, city, state, field_name, starts_on, ends_on, daily_starts_at, daily_ends_at)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
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

    // The family's own thread. RLS returns their conversations and nothing
    // else, so there is no household filter here to forget.
    async thread() {
      const { data: conversations, error } = await client
        .from("conversations")
        .select("id, channel, state, last_message_at, human_owned")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1);

      if (error) throw error;
      if (!conversations?.length) return { conversation: null, messages: [] };

      const { data: messages, error: messageError } = await client
        .from("messages")
        .select("id, direction, sender_kind, body, created_at, channel")
        .eq("conversation_id", conversations[0].id)
        .order("created_at");

      if (messageError) throw messageError;
      return { conversation: conversations[0], messages: messages ?? [] };
    },

    async sendMessage(conversationId, body) {
      const { error } = await client.from("messages").insert({
        conversation_id: conversationId,
        direction: "inbound",
        sender_kind: "parent",
        body,
      });
      if (error) throw error;
    },

    async household_() {
      const { data, error } = await client
        .from("households")
        .select("id, display_name")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async contacts() {
      const { data, error } = await client
        .from("contacts")
        .select("id, first_name, last_name, email, phone, is_primary, sms_consent, email_consent")
        .order("is_primary", { ascending: false });
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
        .select("id, shift_id, minutes, amount_cents, worked_on, paid_at, status")
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

    // ---- waivers ----------------------------------------------------------
    // A player, not a booking: a season is sixteen sessions, and asking for the
    // same agreement sixteen times teaches a parent to click through it.

    async waiverStatus(playerId) {
      const { data, error } = await client.rpc("player_waiver_status", { p_player_id: playerId });
      if (error) throw error;
      return data;
    },

    async signWaiver(playerId, details) {
      const { data, error } = await client.rpc("record_player_waiver", {
        p_player_id: playerId, p_details: details,
      });
      if (error) throw error;
      return data;
    },

    // ---- administration ---------------------------------------------------
    // Every one of these asserts staff inside the database. Nothing here is
    // gated by the interface hiding a button.
    admin: {
      today: async () => {
        const { data, error } = await client.rpc("operations_today");
        if (error) throw error;
        return data;
      },

      week: async (ending = null) => {
        const { data, error } = await client.rpc("weekly_summary", { p_ending: ending });
        if (error) throw error;
        return data;
      },

      camps: async () => {
        const { data, error } = await client.rpc("camp_utilisation", { p_season_year: null });
        if (error) throw error;
        return data ?? [];
      },

      groups: async () => {
        const { data, error } = await client.rpc("group_utilisation", { p_season_id: null });
        if (error) throw error;
        return data ?? [];
      },

      // ---- running the training side --------------------------------------
      // The write half. Each of these is a single database function that
      // asserts staff in its own body, so the screen is a form and not a
      // second copy of the rules.

      seasons: async () => {
        const { data, error } = await client
          .from("seasons")
          .select("id, name, starts_on, ends_on, weeks, status")
          .order("starts_on", { ascending: false });
        if (error) throw error;
        return data ?? [];
      },

      locations: async () => {
        const { data, error } = await client
          .from("locations")
          .select("id, name, city, state, permit_status, verified_at, active")
          .order("name");
        if (error) throw error;
        return data ?? [];
      },

      trainerList: async () => {
        const { data, error } = await client
          .from("trainers")
          .select("id, first_name, last_name, status, background_check_status")
          .order("first_name");
        if (error) throw error;
        return data ?? [];
      },

      groupDetail: async (groupId) => {
        const { data, error } = await client
          .from("training_groups")
          .select("id, name, slug, season_id, location_id, trainer_id, min_age, max_age, " +
                  "min_skill, max_skill, min_players, target_players, max_players, " +
                  "status, dropin_price_cents, group_meeting_times(id, weekday, starts_time, duration_minutes)")
          .eq("id", groupId)
          .single();
        if (error) throw error;
        return data;
      },

      saveLocation: async (details) => {
        const { data, error } = await client.rpc("upsert_location", { p_details: details });
        if (error) throw error;
        return data;
      },

      verifyLocation: async (locationId, verified = true) => {
        const { data, error } = await client.rpc("verify_location", {
          p_location_id: locationId, p_verified: verified,
        });
        if (error) throw error;
        return data;
      },

      saveSeason: async (details) => {
        const { data, error } = await client.rpc("upsert_season", { p_details: details });
        if (error) throw error;
        return data;
      },

      saveGroup: async (details) => {
        const { data, error } = await client.rpc("upsert_training_group", { p_details: details });
        if (error) throw error;
        return data;
      },

      setMeetingTimes: async (groupId, times) => {
        const { data, error } = await client.rpc("set_group_meeting_times", {
          p_group_id: groupId, p_times: times,
        });
        if (error) throw error;
        return data;
      },

      publishGroup: async (groupId) => {
        const { data, error } = await client.rpc("publish_training_group", { p_group_id: groupId });
        if (error) throw error;
        return data;
      },

      cancelGroup: async (groupId, reason, force = false) => {
        const { data, error } = await client.rpc("cancel_training_group", {
          p_group_id: groupId, p_reason: reason, p_force: force,
        });
        if (error) throw error;
        return data;
      },

      saveTrainer: async (details) => {
        const { data, error } = await client.rpc("upsert_trainer", { p_details: details });
        if (error) throw error;
        return data;
      },

      payroll: async (from, to) => {
        const { data, error } = await client.rpc("payroll_for_period", { p_from: from, p_to: to });
        if (error) throw error;
        return data ?? [];
      },

      markPaid: async (trainerId, from, to, reference) => {
        const { data, error } = await client.rpc("mark_payroll_paid", {
          p_trainer_id: trainerId, p_from: from, p_to: to, p_reference: reference,
        });
        if (error) throw error;
        return data;
      },

      acknowledge: async (id) => {
        const { error } = await client.rpc("acknowledge_escalation", { p_escalation_id: id });
        if (error) throw error;
      },

      resolve: async (id, resolution, resumeAgent) => {
        const { error } = await client.rpc("resolve_escalation", {
          p_escalation_id: id, p_resolution: resolution, p_reopen_conversation: resumeAgent,
        });
        if (error) throw error;
      },

      setPaused: async (paused, reason) => {
        const { data, error } = await client.rpc("set_automation_paused", {
          p_paused: paused, p_reason: reason,
        });
        if (error) throw error;
        return data;
      },
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

      startCampRegistration: ({ campId, playerId, dayOption, addonIds, details, idempotencyKey }) =>
        callFunction("camp-checkout", {
          camp_id: campId,
          player_id: playerId,
          day_option: dayOption,
          addon_ids: addonIds ?? [],
          details,
          idempotency_key: idempotencyKey,
        }),

      joinCampWaitlist: ({ campId, playerId }) =>
        callFunction("waitlist", { action: "join_camp", camp_id: campId, player_id: playerId }),
    },
  };

  // Occupancy is a function rather than a column because it counts live holds
  // as well as paid places. One call per camp, in parallel.
  async function withOccupancy(camps) {
    const counts = await Promise.all(
      camps.map((camp) => client.rpc("camp_occupancy", { p_camp_id: camp.id }).single()),
    );

    return camps.map((camp, index) => ({
      ...camp,
      occupancy: counts[index]?.data ?? null,
      spots_left: counts[index]?.data
        ? Math.max(0, counts[index].data.capacity - counts[index].data.total)
        : null,
    }));
  }
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
