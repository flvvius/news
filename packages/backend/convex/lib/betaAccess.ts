import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { authComponent } from "../auth";

type DbCtx = QueryCtx | MutationCtx;
type AuthCtx = Parameters<typeof authComponent.safeGetAuthUser>[0];
let cachedAdminEmails: Set<string> | null = null;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getAdminEmails(): string[] {
  if (cachedAdminEmails === null) {
    cachedAdminEmails = new Set(
      (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((email) => normalizeEmail(email))
        .filter(Boolean),
    );
  }

  return Array.from(cachedAdminEmails);
}

export function isAdminEmail(email: string): boolean {
  if (cachedAdminEmails === null) {
    getAdminEmails();
  }

  return cachedAdminEmails!.has(normalizeEmail(email));
}

export async function getWaitlistRecordByEmail(
  ctx: DbCtx,
  email: string,
): Promise<Doc<"waitlist"> | null> {
  return await ctx.db
    .query("waitlist")
    .withIndex("by_email", (q) => q.eq("email", normalizeEmail(email)))
    .first();
}

export async function requireAdminUser(ctx: AuthCtx & DbCtx) {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) {
    throw new ConvexError("Not authenticated");
  }

  if (!isAdminEmail(authUser.email)) {
    throw new ConvexError("Unauthorized: admin access required");
  }

  return authUser;
}
