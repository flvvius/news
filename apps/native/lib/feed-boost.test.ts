import { describe, expect, test } from "vitest";

import { stableTopicBoost } from "./feed-boost";

type Row = { id: string; followed: boolean };
const isFollowed = (r: Row) => r.followed;

describe("stableTopicBoost (Ticket 12: no scroll reorder)", () => {
  test("boosts followed rows within the first page only", () => {
    const rest: Row[] = [
      { id: "a", followed: false },
      { id: "b", followed: true },
      { id: "c", followed: false },
      { id: "d", followed: true },
    ];
    // firstPageRestCount = 4 → all are first page.
    expect(stableTopicBoost(rest, 4, isFollowed).map((r) => r.id)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
  });

  test("later pages append in natural order and never reorder the first page", () => {
    // First page contributed 3 rows; page 2 adds 2 more.
    const firstPage: Row[] = [
      { id: "a", followed: false },
      { id: "b", followed: true },
      { id: "c", followed: false },
    ];
    const page2: Row[] = [
      { id: "e", followed: true },
      { id: "f", followed: false },
    ];

    const afterPage1 = stableTopicBoost(firstPage, 3, isFollowed).map(
      (r) => r.id,
    );
    const afterPage2 = stableTopicBoost(
      [...firstPage, ...page2],
      3,
      isFollowed,
    ).map((r) => r.id);

    expect(afterPage1).toEqual(["b", "a", "c"]);
    // First-page order is identical after loading page 2 — no reorder. Page 2
    // appends in natural order (followed "e" is NOT hoisted into page 1).
    expect(afterPage2).toEqual(["b", "a", "c", "e", "f"]);
    expect(afterPage2.slice(0, 3)).toEqual(afterPage1);
  });

  test("no first page (count <= 0) returns input unchanged", () => {
    const rest: Row[] = [{ id: "a", followed: true }];
    expect(stableTopicBoost(rest, 0, isFollowed)).toEqual(rest);
  });
});
