import { describe, expect, test } from "vitest";

import {
  collectTrustedOrigins,
  isProductionDeployment,
  parseAppleAudiences,
} from "./auth";

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
