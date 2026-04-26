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

export async function getBetaAccessForEmail(ctx: DbCtx, email: string) {
  const normalizedEmail = normalizeEmail(email);
  const waitlistRecord = await getWaitlistRecordByEmail(ctx, normalizedEmail);
  const isAdmin = isAdminEmail(normalizedEmail);
  const waitlistStatus = waitlistRecord?.status ?? null;
  const hasBetaAccess =
    isAdmin ||
    waitlistStatus === "invited" ||
    waitlistStatus === "converted";

  return {
    email: normalizedEmail,
    isAdmin,
    hasBetaAccess,
    waitlistStatus,
    waitlistPosition: waitlistRecord?.position ?? null,
    invitedAt: waitlistRecord?.invitedAt ?? null,
    convertedAt: waitlistRecord?.convertedAt ?? null,
  };
}

export async function getCurrentUserBetaAccess(ctx: AuthCtx & DbCtx) {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) {
    return {
      authenticated: false,
      email: null,
      isAdmin: false,
      hasBetaAccess: false,
      waitlistStatus: null,
      waitlistPosition: null,
      invitedAt: null,
      convertedAt: null,
    };
  }

  const access = await getBetaAccessForEmail(ctx, authUser.email);

  return {
    authenticated: true,
    ...access,
  };
}

export async function requireBetaAccess(ctx: AuthCtx & DbCtx) {
  const access = await getCurrentUserBetaAccess(ctx);
  if (!access.authenticated) {
    throw new ConvexError("Early access required");
  }

  if (!access.hasBetaAccess) {
    throw new ConvexError("This account does not have beta access yet");
  }

  return access;
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
