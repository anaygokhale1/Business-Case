import { PrismaClient } from "@prisma/client";

// Single shared Prisma client (@ssa/db). Modules import `prisma` from here and
// never construct their own client. A globalThis singleton avoids exhausting
// connections during Next.js dev hot-reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
