import { describe, expect, test } from "bun:test";
import { checkNbaScoreSum, checkMonotonic } from "../lib/statsSanity.js";

describe("checkNbaScoreSum", () => {
  test("null when the box-score sum is 0 (pregame, no box score yet)", () => {
    expect(checkNbaScoreSum(0, 0, "Home")).toBeNull();
  });

  test("null when postedScore is undefined", () => {
    expect(checkNbaScoreSum(35, undefined, "Home")).toBeNull();
  });

  test("null when sum matches posted score within tolerance", () => {
    expect(checkNbaScoreSum(35, 36, "Home")).toBeNull(); // off by 1, within default tolerance
  });

  test("warns when sum differs from posted score beyond tolerance", () => {
    const warning = checkNbaScoreSum(35, 50, "Home");
    expect(warning).not.toBeNull();
    expect(warning).toContain("Home");
    expect(warning).toContain("35");
    expect(warning).toContain("50");
  });

  test("respects a custom tolerance", () => {
    expect(checkNbaScoreSum(40, 40, "Home", 10)).toBeNull();
    expect(checkNbaScoreSum(30, 40, "Home", 1)).not.toBeNull();
  });
});

describe("checkMonotonic", () => {
  const fields = [{ key: "actualPts" as const, label: "PTS" }];

  test("null when there's no previous roster", () => {
    const curr = [{ id: "1", name: "A", actualPts: 10 }];
    expect(checkMonotonic(undefined, curr, fields)).toBeNull();
  });

  test("null when every tracked field stayed the same or increased", () => {
    const prev = [{ id: "1", name: "A", actualPts: 10 }];
    const curr = [{ id: "1", name: "A", actualPts: 14 }];
    expect(checkMonotonic(prev, curr, fields)).toBeNull();
  });

  test("flags a field that decreased", () => {
    const prev = [{ id: "1", name: "A", actualPts: 20 }];
    const curr = [{ id: "1", name: "A", actualPts: 18 }];
    const warning = checkMonotonic(prev, curr, fields);
    expect(warning).not.toBeNull();
    expect(warning).toContain("A");
    expect(warning).toContain("PTS");
    expect(warning).toContain("20");
    expect(warning).toContain("18");
  });

  test("ignores players not present in the previous roster (new to the box score)", () => {
    const prev = [{ id: "1", name: "A", actualPts: 10 }];
    const curr = [{ id: "1", name: "A", actualPts: 10 }, { id: "2", name: "B", actualPts: 5 }];
    expect(checkMonotonic(prev, curr, fields)).toBeNull();
  });

  test("checks multiple fields, flagging whichever regresses first", () => {
    const multiFields = [
      { key: "actualPts" as const, label: "PTS" },
      { key: "actualAst" as const, label: "AST" },
    ];
    const prev = [{ id: "1", name: "A", actualPts: 10, actualAst: 8 }];
    const curr = [{ id: "1", name: "A", actualPts: 10, actualAst: 6 }];
    const warning = checkMonotonic(prev, curr, multiFields);
    expect(warning).not.toBeNull();
    expect(warning).toContain("AST");
  });
});
