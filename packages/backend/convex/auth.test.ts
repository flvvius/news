import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";

import {
  collectTrustedOrigins,
  healUserProfileForSession,
  isProductionDeployment,
  parseAppleAudiences,
} from "./auth";
import schema from "./schema";

// Same documented convex-test glob as interactions.test.ts: drops
// `convex.config.ts` (no Better Auth component instantiation) plus test/d.ts
// files.
const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

type ConvexT = TestConvex<typeof schema>;

// Ticket 4: idToken `aud` must accept BOTH bundle ids (dev com.biviant.dev,
// prod com.biviant.app). The bug class is parsing the Convex env value in the
// wrong shape, so cover every shape the value might be set in.
describe("parseAppleAudiences (Ticket 4: Apple aud allow-list)", () => {
  test("defaults to both dev + prod bundle ids when unset/blank", () => {
    expect(parseAppleAudiences(undefined)).toEqual([
      "com.biviant.dev",
      "com.biviant.app",
    ]);
    expect(parseAppleAudiences("")).toEqual([
      "com.biviant.dev",
      "com.biviant.app",
    ]);
    expect(parseAppleAudiences("   ")).toEqual([
      "com.biviant.dev",
      "com.biviant.app",
    ]);
  });

  test("parses a JSON array", () => {
    expect(
      parseAppleAudiences('["com.biviant.dev", "com.biviant.app"]'),
    ).toEqual(["com.biviant.dev", "com.biviant.app"]);
  });

  test("parses a comma-separated list (with stray whitespace)", () => {
    expect(parseAppleAudiences("com.biviant.dev, com.biviant.app")).toEqual([
      "com.biviant.dev",
      "com.biviant.app",
    ]);
    expect(
      parseAppleAudiences("  com.biviant.dev ,com.biviant.app  "),
    ).toEqual(["com.biviant.dev", "com.biviant.app"]);
  });

  test("parses a whitespace-separated list", () => {
    expect(parseAppleAudiences("com.biviant.dev com.biviant.app")).toEqual([
      "com.biviant.dev",
      "com.biviant.app",
    ]);
  });

  test("accepts a single bundle id", () => {
    expect(parseAppleAudiences("com.biviant.app")).toEqual(["com.biviant.app"]);
  });

  test("falls back to defaults on an empty JSON array (never yields empty)", () => {
    expect(parseAppleAudiences("[]")).toEqual([
      "com.biviant.dev",
      "com.biviant.app",
    ]);
  });
});

// BIV-809: the Convex runtime reports NODE_ENV="production" on dev
// deployments too, so environment detection must honor the explicit
// DEPLOY_ENV override or localhost auth breaks (login → "Invalid origin").
describe("isProductionDeployment (BIV-809: DEPLOY_ENV override)", () => {
  test("DEPLOY_ENV=development wins over NODE_ENV=production (Convex dev reality)", () => {
    expect(
      isProductionDeployment({
        DEPLOY_ENV: "development",
        NODE_ENV: "production",
      }),
    ).toBe(false);
  });

  test("DEPLOY_ENV=production is production regardless of NODE_ENV", () => {
    expect(
      isProductionDeployment({
        DEPLOY_ENV: "production",
        NODE_ENV: "development",
      }),
    ).toBe(true);
    expect(isProductionDeployment({ DEPLOY_ENV: "prod" })).toBe(true);
  });

  test("without DEPLOY_ENV, falls back to NODE_ENV (safe default on Convex)", () => {
    expect(isProductionDeployment({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionDeployment({ NODE_ENV: "test" })).toBe(false);
    expect(isProductionDeployment({})).toBe(false);
  });

  test("prod: CONVEX_DEPLOYMENT marks production when nothing else is set", () => {
    expect(
      isProductionDeployment({ CONVEX_DEPLOYMENT: "prod:some-animal-123" }),
    ).toBe(true);
    expect(
      isProductionDeployment({ CONVEX_DEPLOYMENT: "dev:grateful-bison-659" }),
    ).toBe(false);
  });
});

describe("collectTrustedOrigins (BIV-809: localhost trusted in dev)", () => {
  const devEnv = {
    // Exactly what a Convex dev deployment looks like at runtime: NODE_ENV
    // claims production, DEPLOY_ENV is the explicit dev marker.
    NODE_ENV: "production",
    DEPLOY_ENV: "development",
    SITE_URL: "http://localhost:3001",
    CONVEX_SITE_URL: "https://grateful-bison-659.convex.site",
  };

  test("regression: dev deployment trusts the localhost web origin", () => {
    const origins = collectTrustedOrigins(devEnv);
    expect(origins).toContain("http://localhost:3001");
    expect(origins).toContain("http://127.0.0.1:3001");
  });

  test("production deployment does NOT trust localhost origins", () => {
    const origins = collectTrustedOrigins({
      NODE_ENV: "production",
      SITE_URL: "https://biviant.com",
    });
    expect(origins).not.toContain("http://localhost:3001");
    expect(origins).not.toContain("http://127.0.0.1:3001");
    expect(origins).toContain("https://biviant.com");
    expect(origins).toContain("https://www.biviant.com");
  });

  test("CONVEX_ALLOW_LOCALHOST=true is an explicit escape hatch in production", () => {
    const origins = collectTrustedOrigins({
      NODE_ENV: "production",
      SITE_URL: "https://biviant.com",
      CONVEX_ALLOW_LOCALHOST: "true",
    });
    expect(origins).toContain("http://localhost:3001");
  });

  test("ALLOWED_ORIGINS entries and the native app scheme are included", () => {
    const origins = collectTrustedOrigins({
      ...devEnv,
      ALLOWED_ORIGINS: "https://biviant.com,https://staging.biviant.com",
      NATIVE_APP_URL: "mybettertapp://",
    });
    expect(origins).toContain("https://biviant.com");
    expect(origins).toContain("https://staging.biviant.com");
    expect(origins).toContain("mybettertapp://");
  });

  test("native scheme defaults when NATIVE_APP_URL is unset", () => {
    expect(collectTrustedOrigins(devEnv)).toContain("news-app://");
  });
});

// BIV-814 regression: Google OAuth completed, the session cookie was stored
// and valid, convex/token issued a JWT — yet /activitate bounced to the
// sign-in prompt. Cause: the auth user predated the users-table onCreate
// trigger, so no app profile row existed and getCurrentUser (a query, cannot
// insert) returned null. The session onCreate trigger must heal that state.
describe("healUserProfileForSession (BIV-814: sign-in bounce)", () => {
  const legacyAuthUser = {
    _id: "authuser_legacy_1",
    email: "  Legacy.User@Gmail.com ",
    name: "Legacy User",
    image: "https://example.com/avatar.png",
  };

  async function readProfile(t: ConvexT, authUserId: string) {
    return await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUserId))
        .unique();
      const stats = user
        ? await ctx.db
            .query("userStats")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .unique()
        : null;
      return { user, stats };
    });
  }

  test("regression: session creation heals the missing profile row", async () => {
    const t = convexTest(schema, modules);

    // Reproduce the broken state: the auth user exists (sign-in succeeds,
    // session row is written) but there is NO app users row.
    await t.run(async (ctx) => {
      await healUserProfileForSession(
        ctx,
        { userId: legacyAuthUser._id },
        async (id) => (id === legacyAuthUser._id ? legacyAuthUser : null),
      );
    });

    const { user, stats } = await readProfile(t, legacyAuthUser._id);
    expect(user).not.toBeNull();
    // Email is normalized exactly like the user onCreate trigger does.
    expect(user!.email).toBe("legacy.user@gmail.com");
    expect(user!.profile.name).toBe("Legacy User");
    expect(user!.profile.avatar).toBe("https://example.com/avatar.png");
    // Stats row must exist too — dashboards read it.
    expect(stats).not.toBeNull();
    expect(stats!.currentStreak).toBe(0);
  });

  test("idempotent: repeat sign-ins never duplicate profile or stats rows", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await healUserProfileForSession(
          ctx,
          { userId: legacyAuthUser._id },
          async () => legacyAuthUser,
        );
      }
    });

    const rows = await t.run(async (ctx) => {
      const users = await ctx.db.query("users").collect();
      const stats = await ctx.db.query("userStats").collect();
      return { users, stats };
    });
    expect(rows.users).toHaveLength(1);
    expect(rows.stats).toHaveLength(1);
  });

  test("keeps an existing profile untouched (no clobbering on sign-in)", async () => {
    const t = convexTest(schema, modules);

    const existingId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        authUserId: legacyAuthUser._id,
        email: "legacy.user@gmail.com",
        profile: { name: "Customized Name" },
      });
      await ctx.db.insert("userStats", {
        userId,
        currentStreak: 4,
        longestStreak: 9,
        articlesRead: 42,
        biasBalance: -10,
      });
      return userId;
    });

    await t.run(async (ctx) => {
      await healUserProfileForSession(
        ctx,
        { userId: legacyAuthUser._id },
        async () => legacyAuthUser,
      );
    });

    const { user, stats } = await readProfile(t, legacyAuthUser._id);
    expect(user!._id).toBe(existingId);
    expect(user!.profile.name).toBe("Customized Name");
    expect(stats!.articlesRead).toBe(42);
  });

  test("best-effort: a throwing lookup never propagates (would abort sign-in)", async () => {
    const t = convexTest(schema, modules);

    // The trigger runs inside the component's session-create mutation; if
    // this rejected, session creation (= every sign-in) would fail.
    await t.run(async (ctx) => {
      await expect(
        healUserProfileForSession(ctx, { userId: "authuser_boom" }, async () => {
          throw new Error("transient adapter failure");
        }),
      ).resolves.toBeUndefined();
    });
  });

  test("skips the auth-user lookup entirely when the profile already exists", async () => {
    const t = convexTest(schema, modules);
    let lookups = 0;

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        authUserId: legacyAuthUser._id,
        email: "legacy.user@gmail.com",
        profile: {},
      });
      await healUserProfileForSession(
        ctx,
        { userId: legacyAuthUser._id },
        async () => {
          lookups++;
          return legacyAuthUser;
        },
      );
    });

    expect(lookups).toBe(0);
  });

  test("no-op when the auth user lookup misses (nothing to heal)", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await healUserProfileForSession(
        ctx,
        { userId: "authuser_ghost" },
        async () => null,
      );
    });

    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(0);
  });
});
