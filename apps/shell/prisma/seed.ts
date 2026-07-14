import { prisma } from "@ssa/db";

// Synthetic seed for the Sample Tracker module. Idempotent: it only inserts when
// the table is empty, so ./scripts/run.sh can call it on every start. Run
// ./scripts/reset.sh to wipe and reseed.
const PROJECT_SLUG = "northwind-rollout";

const SAMPLE_ITEMS = [
  { title: "Kickoff checklist", category: "Planning", owner: "Demo User" },
  { title: "Stakeholder map", category: "Planning", owner: "Sam Rivera" },
  { title: "Data access request", category: "Data", owner: "Sam Rivera" },
  { title: "Environment setup", category: "Engineering", owner: "Demo User" },
  { title: "Draft milestone plan", category: "Planning", owner: "Jordan Lee" },
  { title: "Risk register", category: "Governance", owner: "Jordan Lee" },
  { title: "Weekly status template", category: "Reporting", owner: "Demo User" },
  { title: "Retro notes", category: "Reporting", owner: "Sam Rivera" }
];

async function main() {
  const existing = await prisma.sampleItem.count();
  if (existing > 0) {
    console.log(`Seed skipped: ${existing} sample item(s) already present.`);
    return;
  }

  await prisma.sampleItem.createMany({
    data: SAMPLE_ITEMS.map((item) => ({ projectSlug: PROJECT_SLUG, ...item }))
  });
  console.log(`Seeded ${SAMPLE_ITEMS.length} sample item(s) for "${PROJECT_SLUG}".`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
