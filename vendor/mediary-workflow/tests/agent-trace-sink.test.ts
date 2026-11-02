import { describe, expect, it, vi } from "vitest";
import { makeAgentTraceSink, combineToolEventSinks } from "../src/acquisition-v2/agent-trace-sink.js";
import type { AgentToolEvent } from "../src/acquisition-v2/activity.js";
import { InMemoryWorkflowRepository } from "../src/index.js";
import type { AgentStep } from "../src/index.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const ev = (toolName: string, args: Record<string, unknown>): AgentToolEvent => ({
  toolName,
  args,
  activity: "x",
  phase: "search",
});

describe("makeAgentTraceSink", () => {
  it("appends one ordered step per event with apiCalls + ts", async () => {
    const appended: Array<{ id: string; step: AgentStep }> = [];
    const sink = makeAgentTraceSink({
      repository: {
        appendAgentStep: async (id, step) => {
          appended.push({ id, step });
        },
      },
      workflowRunId: "run1",
      apiCallCount: () => (appended.length === 0 ? 3 : 7),
      now: () => "2026-06-22T00:00:00.000Z",
    });
    sink(ev("searchResources", { keyword: "莉可丽丝" }));
    sink(ev("transferCandidate", { candidateId: "c1" }));
    // fire-and-forget; let the microtasks flush
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(appended.map((a) => a.step.ordinal)).toEqual([0, 1]);
    expect(appended[0]!.id).toBe("run1");
    expect(appended[0]!.step.toolName).toBe("searchResources");
    expect(appended[0]!.step.args.keyword).toBe("莉可丽丝");
    expect(appended[0]!.step.apiCalls).toBe(3);
    expect(appended[0]!.step.at).toBe("2026-06-22T00:00:00.000Z");
  });

  it("omits apiCalls when no counter, and swallows repo errors", () => {
    const sink = makeAgentTraceSink({
      repository: {
        appendAgentStep: async () => {
          throw new Error("db down");
        },
      },
      workflowRunId: "run1",
    });
    expect(() => sink(ev("searchResources", {}))).not.toThrow();
  });

  it("caps pathologically large args", async () => {
    const appended: AgentStep[] = [];
    const sink = makeAgentTraceSink({
      repository: { appendAgentStep: async (_id, step) => { appended.push(step); } },
      workflowRunId: "run1",
    });
    const huge = { moves: Array.from({ length: 5000 }, (_, i) => ({ fileIds: [`f${i}`] })) };
    sink(ev("moveToSeason", huge));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(appended[0]!.args).toEqual({ _truncated: true });
  });

  it("a retried run (fresh sink, same runId) replaces the prior attempt's trace", async () => {
    // retryFailedWorkflowRun / auto-requeue reuse the SAME run id; a fresh sink
    // restarts ordinal at 0. Without clearing, those re-collide (PG drops them,
    // InMemory duplicates) — the retry's trace would be wrong. (Copilot PR#19.)
    const repo = new InMemoryWorkflowRepository();
    const first = makeAgentTraceSink({ repository: repo, workflowRunId: "run1" });
    first(ev("searchResources", { keyword: "first" }));
    first(ev("transferCandidate", { candidateId: "c" }));
    first(ev("markObtained", { codes: ["S01E01"] }));
    await tick();
    expect((await repo.listAgentSteps("run1")).length).toBe(3);

    const retry = makeAgentTraceSink({ repository: repo, workflowRunId: "run1" });
    retry(ev("searchResources", { keyword: "second" }));
    retry(ev("reportNoCoverage", { reason: "none" }));
    await tick();

    const steps = await repo.listAgentSteps("run1");
    expect(steps.map((s) => s.ordinal)).toEqual([0, 1]);
    expect(steps[0]!.args.keyword).toBe("second");
  });

  it("appends stay ordered even though writes are fire-and-forget", async () => {
    const repo = new InMemoryWorkflowRepository();
    const sink = makeAgentTraceSink({ repository: repo, workflowRunId: "run1" });
    for (let i = 0; i < 6; i++) sink(ev("searchResources", { keyword: `k${i}` }));
    await tick();
    const steps = await repo.listAgentSteps("run1");
    expect(steps.map((s) => s.ordinal)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("combineToolEventSinks", () => {
  it("fans out to every sink and isolates a throwing one", () => {
    const a = vi.fn();
    const b = vi.fn((_event: AgentToolEvent) => {
      throw new Error("boom");
    });
    const c = vi.fn();
    const combined = combineToolEventSinks(a, (e) => b(e), c);
    expect(() => combined(ev("searchResources", {}))).not.toThrow();
    expect(a).toHaveBeenCalledOnce();
    expect(c).toHaveBeenCalledOnce();
  });
});
