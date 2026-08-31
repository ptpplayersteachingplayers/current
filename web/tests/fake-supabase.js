// =============================================================================
// A stand-in for supabase-js
// =============================================================================
// Enough of the client for the portals to run in a browser with no network:
// the same chained query builder, the same { data, error } shape, the same
// auth surface. Seeded with the demo season so what the tests see is what the
// seed produces.
//
// This is a test double, not a mock framework — it returns rows, it does not
// assert on calls. The tests below check what the page renders.
// =============================================================================

export function fakeSupabase(fixtures) {
  const listeners = [];
  let session = fixtures.session ?? null;

  const result = (data, error = null) => Promise.resolve({ data, error });

  function from(table) {
    const rows = () => (fixtures.tables[table] ?? []).slice();
    const filters = [];

    const builder = {
      select() { return builder; },
      order() { return builder; },
      limit() { return builder; },
      in(column, values) { filters.push((r) => values.includes(r[column])); return builder; },
      eq(column, value) { filters.push((r) => r[column] === value); return builder; },
      gte(column, value) { filters.push((r) => r[column] >= value); return builder; },
      lte(column, value) { filters.push((r) => r[column] <= value); return builder; },
      // Applies the filters. The first version patched every row in the
      // table, which meant an update with the wrong id looked like a success.
      update(patch) {
        for (const row of rows().filter((r) => filters.every((f) => f(r)))) {
          const live = (fixtures.tables[table] ?? []).find((r) => r === row || r.id === row.id);
          if (live) Object.assign(live, patch);
        }
        return builder;
      },
      then(resolve) {
        const filtered = rows().filter((row) => filters.every((f) => f(row)));
        return result(filtered).then(resolve);
      },
      // PostgREST errors when .single() matches other than one row, and a
      // page's error branch should be exercised rather than assumed.
      single() {
        const filtered = rows().filter((row) => filters.every((f) => f(row)));
        if (filtered.length !== 1) {
          return result(null, {
            code: "PGRST116",
            message: `Expected one row, found ${filtered.length}`,
          });
        }
        return result(filtered[0]);
      },
      maybeSingle() {
        const filtered = rows().filter((row) => filters.every((f) => f(row)));
        return result(filtered[0] ?? null);
      },
    };

    return builder;
  }

  return {
    from,
    // An RPC the fixture does not define is a mistake in the page or in the
    // fixture, and either way the test should see it. Returning null quietly
    // made a call to a function that does not exist invisible.
    rpc: (name, args) => {
      const handler = fixtures.rpc?.[name];
      if (!handler) {
        return Promise.resolve({
          data: null,
          error: { code: "42883", message: `No stub for rpc ${name}` },
        });
      }
      // The real client returns an error, it does not throw. A stub that throws
      // is how a test says "the database refused this".
      try {
        const value = handler(args);
        return Promise.resolve({ data: value, error: null, single: () => Promise.resolve({ data: value, error: null }) });
      } catch (thrown) {
        const error = { message: thrown.message, code: thrown.code ?? "P0001" };
        return Promise.resolve({ data: null, error, single: () => Promise.resolve({ data: null, error }) });
      }
    },
    auth: {
      getUser: () => result(session ? { user: session.user } : { user: null }),
      getSession: () => result({ session }),
      signInWithPassword: ({ email }) => {
        session = { user: { id: "u1", email }, access_token: "test-token" };
        listeners.forEach((l) => l("SIGNED_IN", session));
        return result({ session });
      },
      signInWithOtp: () => result({}),
      signOut: () => {
        session = null;
        listeners.forEach((l) => l("SIGNED_OUT", null));
        return result({});
      },
      onAuthStateChange: (handler) => {
        listeners.push(handler);
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  };
}
