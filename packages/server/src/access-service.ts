import { demoUsers, type DemoUser } from "@ssa/project-context/access-model";
import type { ProjectModuleKey } from "@ssa/project-context/project-portfolio";

// Server-side access checks for module API routes (@ssa/server/access-service).
//
// PHASE-3: in real SSA Pro these resolve the session user and verify their
// membership + module access against the database, throwing 401/403 otherwise.
// The template runs with a single static admin Demo User and no auth, so access
// is always granted. Keep calling these in your module's API routes anyway —
// the shape matches production, so wiring real auth later is a drop-in.

export class AccessError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = "AccessError";
    this.status = status;
  }
}

const DEMO_USER = demoUsers[0];

// Resolve the acting user. PHASE-3: read the real session.
export async function requireCurrentUser(): Promise<DemoUser> {
  return DEMO_USER;
}

// Authorize the acting user for a project + (optional) module, returning the
// user on success. PHASE-3: check DB membership and module enablement.
export async function requireProjectAccess(
  _projectSlug: string,
  _moduleKey?: ProjectModuleKey
): Promise<{ user: DemoUser }> {
  return { user: DEMO_USER };
}
