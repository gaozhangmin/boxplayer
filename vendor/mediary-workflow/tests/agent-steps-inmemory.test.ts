import { describe, expect, it } from "vitest";
import { InMemoryWorkflowRepository } from "../src/index.js";
import type { AgentStep } from "../src/index.js";

function step(ordinal: number, toolName: string): AgentStep {
  return {
    ordinal,
    toolName,
    args: { keyword: "x" },
    activity: "搜",
    phase: "search",
    at: "2026-06-22T00:00:00.000Z",
  };
}

describe("InMemory agent steps", () => {
  it("appends and lists ordered by ordinal", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.appendAgentStep("run1", step(1, "transferCandidate"));
    await repo.appendAgentStep("run1", step(0, "searchResources"));
    const steps = await repo.listAgentSteps("run1");
    expect(steps.map((s) => s.ordinal)).toEqual([0, 1]);
    expect(steps[0]!.toolName).toBe("searchResources");
  });

  it("isolates steps per run", async () => {
    const repo = new InMemoryWorkflowRepository();
    await repo.appendAgentStep("run1", step(0, "searchResources"));
    expect(await repo.listAgentSteps("run2")).toEqual([]);
  });
});
