import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@ssa/db";
import { requireProjectAccess } from "@ssa/server/access-service";

// The Sample Tracker module's API — the reference server slice. It reads and
// writes SampleItem rows scoped to a project, gating on requireProjectAccess the
// same way real SSA Pro module routes do. Copy this shape for your own module.

const createSchema = z.object({
  title: z.string().trim().min(1, "Title is required."),
  category: z.string().trim().min(1, "Category is required."),
  owner: z.string().trim().min(1, "Owner is required.")
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectSlug: string }> }
) {
  const { projectSlug } = await params;
  await requireProjectAccess(projectSlug, "sampleTracker");

  const items = await prisma.sampleItem.findMany({
    where: { projectSlug },
    orderBy: { createdAt: "asc" }
  });

  return NextResponse.json({ items });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectSlug: string }> }
) {
  const { projectSlug } = await params;
  await requireProjectAccess(projectSlug, "sampleTracker");

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid item." },
      { status: 400 }
    );
  }

  const item = await prisma.sampleItem.create({
    data: { projectSlug, ...parsed.data }
  });

  return NextResponse.json({ item }, { status: 201 });
}
