import { NextResponse } from "next/server";

import { defaultProjects } from "@ssa/project-context/project-portfolio";

// PHASE-3: query the database for the acting user's projects. The template
// serves a fixed synthetic list from @ssa/project-context.
export async function GET() {
  return NextResponse.json({ projects: defaultProjects });
}
