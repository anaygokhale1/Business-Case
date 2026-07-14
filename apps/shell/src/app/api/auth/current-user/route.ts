import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";

// PHASE-3: derive the user from the session. Template returns the static Demo
// User so the AccessProvider resolves an admin identity with no login.
export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json(user);
}
