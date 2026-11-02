import { describe, expect, it } from "vitest";
import { Pan115ApiGuard } from "../src/index.js";

describe("Pan115ApiGuard.callsSpent", () => {
  it("counts each api call attempt, including ones that throw", async () => {
    const guard = new Pan115ApiGuard();
    expect(guard.callsSpent()).toBe(0);
    await guard.run("listItems", async () => []);
    await guard.run("createFolder", async () => "id");
    expect(guard.callsSpent()).toBe(2);
    // callCount increments BEFORE the call runs, so a throwing call still counts
    // as a spent API attempt (the budget is about calls made, not calls that won).
    await expect(
      guard.run("deleteItems", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow();
    expect(guard.callsSpent()).toBe(3);
  });
});
