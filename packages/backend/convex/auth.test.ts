import { describe, expect, test } from "vitest";

import { parseAppleAudiences } from "./auth";

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
