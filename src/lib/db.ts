import { PrismaClient } from "@prisma/client";

/**
 * Single shared Prisma client. Next.js hot-reloads modules in dev, which
 * would otherwise create a new PrismaClient (and a new SQLite connection)
 * on every edit — so it's cached on `globalThis` in non-production.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
