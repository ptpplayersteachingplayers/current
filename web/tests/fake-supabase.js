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
      update(patch) {
        for (const row of fixtures.tables[table] ?? []) Object.assign(row, patch);
        return builder;
      },
      then(resolve) {
        const filtered = rows().filter((row) => filters.every((f) => f(row)));
        return result(filtered).then(resolve);
      },
      single() {
        const filtered = rows().filter((row) => filters.every((f) => f(row)));
        return result(filtered[0] ?? null);
      },
    };

    return builder;
  }

  return {
    from,
    rpc: (name, args) => result(fixtures.rpc?.[name]?.(args) ?? null),
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
