import { demoUsers, type DemoUser } from "@ssa/project-context/access-model";

// PHASE-3: real SSA Pro resolves the signed-in user from a next-auth session and
// the database here. The template has no auth and runs as a single static admin
// "Demo User". Keep this module as the one place the acting user is resolved, so
// swapping in real auth later is a single-file change.
export type SessionUser = DemoUser & { status: "ACTIVE" | "PENDING" | "DISABLED" };

export async function getCurrentUser(): Promise<SessionUser> {
  return { ...demoUsers[0], status: "ACTIVE" };
}

export async function requireCurrentUser(): Promise<SessionUser> {
  return getCurrentUser();
}
