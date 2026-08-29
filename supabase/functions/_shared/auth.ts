// =============================================================================
// Who is calling?
// =============================================================================
// Used for logging and for the handful of places a handler needs to branch on
// role. It is not the authorisation check — that lives in the database, where
// it cannot be forgotten by a new endpoint. Anything here is a convenience on
// top of a decision already made in SQL.
// =============================================================================

import { asCaller } from "./db.ts";

export interface Caller {
  userId: string | null;
  isAdmin: boolean;
}

export async function identify(req: Request): Promise<Caller> {
  const { data, error } = await asCaller(req).auth.getUser();

  if (error || !data.user) return { userId: null, isAdmin: false };

  const role = (data.user.app_metadata as Record<string, unknown> | undefined)?.ptp_role;

  return { userId: data.user.id, isAdmin: role === "admin" };
}

export function requireSignedIn(caller: Caller): void {
  if (!caller.userId) {
    throw Object.assign(new Error("Sign in to continue"), { code: "42501" });
  }
}
