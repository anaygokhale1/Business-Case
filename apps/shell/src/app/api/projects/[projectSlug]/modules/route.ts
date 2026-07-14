import { NextResponse } from "next/server";
import { z } from "zod";

import { requireProjectAccess } from "@ssa/server/access-service";

// Per-project module enablement toggle. In real SSA Pro this writes the enabled
// flag to the database and records an audit entry. The template acknowledges the
// change (PHASE-3 persists it).
//
// When you add a module, extend the enum and moduleLabel() below so the toggle
// recognizes it. This mirrors the real route's shape.
const patchSchema = z.object({
  moduleKey: z.enum(["sampleTracker"]),
  enabled: z.boolean().optional(),
  externalAccess: z.boolean().optional()
});

function moduleLabel(key: z.infer<typeof patchSchema>["moduleKey"]): string {
  switch (key) {
    case "sampleTracker":
      return "Sample Tracker";
    default:
      return key;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectSlug: string }> }
) {
  const { projectSlug } = await params;
  await requireProjectAccess(projectSlug, "sampleTracker");

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid module change." }, { status: 400 });
  }

  return NextResponse.json({
    projectSlug,
    module: parsed.data.moduleKey,
    label: moduleLabel(parsed.data.moduleKey),
    enabled: parsed.data.enabled ?? null,
    externalAccess: parsed.data.externalAccess ?? null
  });
}
