import { NextResponse } from "next/server";

// PHASE-3: persist the acting user's membership state (e.g. archived). The
// template acknowledges the change so the optimistic UI settles; nothing is
// stored.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectSlug: string }> }
) {
  const { projectSlug } = await params;
  const body = (await request.json().catch(() => ({}))) as { archived?: boolean };
  const archivedAt = body.archived ? new Date().toISOString() : null;
  return NextResponse.json({ slug: projectSlug, archivedAt });
}
