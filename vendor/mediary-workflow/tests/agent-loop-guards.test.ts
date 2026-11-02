import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_STEPS,
  STEP_50_REMINDER,
  BUDGET_SOFT_REMIND_AT,
  BUDGET_REMINDER,
  budgetReflectionNudge,
  budgetSoftThreshold,
  BUDGET_SOFT_HEADROOM,
  stepReflectionNudge,
  prepareStepSystemOverride,
  buildRepetitionStop,
  buildSystemicBlockStop,
  hasSystemicTransferBlock,
  hasSuccessfulFinish,
  hasSuccessfulNoCoverageReport,
  reflectionSystemOverride,
  toStepSignature,
} from "../src/index.js";

describe("toStepSignature", () => {
  it("normalizes a step into tool/args/result (ids excluded — uses input+output)", () => {
    const step = {
      toolCalls: [{ toolName: "inspectTargetDir", input: { season: 6 } }],
      toolResults: [{ output: [] }],
    };
    expect(toStepSignature(step)).toEqual({
      tool: "inspectTargetDir",
      args: JSON.stringify([{ season: 6 }]),
      result: JSON.stringify([[]]),
    });
  });

  it("handles a final no-tool step", () => {
    expect(toStepSignature({ toolCalls: [], toolResults: [] })).toEqual({
      tool: "",
      args: "[]",
      result: "[]",
    });
  });
});

describe("buildRepetitionStop", () => {
  it("returns a StopCondition that stops on 4 identical steps", async () => {
    const stop = buildRepetitionStop();
    const same = { toolCalls: [{ toolName: "searchResources", input: { keyword: "x" } }], toolResults: [{ output: "empty" }] };
    expect(await stop({ steps: [same, same, same, same] as never })).toBe(true);
    expect(await stop({ steps: [same, same] as never })).toBe(false);
  });
});

describe("hasSystemicTransferBlock / buildSystemicBlockStop", () => {
  const blockStep = {
    toolCalls: [{ toolName: "transferCandidate", input: { candidateId: "c1" } }],
    toolResults: [{ output: { attempt: { status: "failed", providerMessage: "云下载配额不足" }, staging: [], systemicBlock: { reason: "云下载配额不足" } } }],
  };
  const okStep = {
    toolCalls: [{ toolName: "transferCandidate", input: { candidateId: "c2" } }],
    toolResults: [{ output: { attempt: { status: "succeeded", providerMessage: "" }, staging: [{ id: "f1" }] } }],
  };

  it("is true once a tool result reports a systemicBlock and nothing has landed", () => {
    expect(hasSystemicTransferBlock([blockStep])).toBe(true);
    expect(hasSystemicTransferBlock([blockStep, blockStep])).toBe(true);
  });

  it("is false when a transfer succeeded somewhere (the account CAN transfer)", () => {
    // A later systemic-looking message is not an account block if something already landed.
    expect(hasSystemicTransferBlock([okStep, blockStep])).toBe(false);
  });

  it("is false when transferUntilLanded landed something (reports transferredCandidateId, not attempt.status)", () => {
    const landedStep = {
      toolCalls: [{ toolName: "transferUntilLanded", input: { candidateIds: ["c2"] } }],
      toolResults: [{ output: { landed: [{ id: "f1" }], transferredCandidateId: "c2", attempts: [] } }],
    };
    expect(hasSystemicTransferBlock([landedStep, blockStep])).toBe(false);
  });

  it("is false when files actually LANDED even though the attempt is marked failed (e.g. quark materializes then marks failed)", () => {
    // The truth is the landing point, not the status flag: materializedFileIds /
    // staging non-empty ⇒ the account CAN transfer, so it is not a systemic block.
    const landedButFailed = {
      toolCalls: [{ toolName: "transferCandidate", input: { candidateId: "c1" } }],
      toolResults: [
        {
          output: {
            attempt: { status: "failed", providerMessage: "云下载配额不足", materializedFileIds: ["f1"] },
            staging: [{ id: "f1" }],
            systemicBlock: { reason: "云下载配额不足" },
          },
        },
      ],
    };
    expect(hasSystemicTransferBlock([landedButFailed])).toBe(false);
  });

  it("is false with no block at all", () => {
    expect(hasSystemicTransferBlock([okStep])).toBe(false);
    expect(hasSystemicTransferBlock([])).toBe(false);
  });

  it("buildSystemicBlockStop returns a StopCondition firing on a systemic block", async () => {
    const stop = buildSystemicBlockStop();
    expect(await stop({ steps: [blockStep] as never })).toBe(true);
    expect(await stop({ steps: [okStep] as never })).toBe(false);
  });
});

describe("reflectionSystemOverride", () => {
  const base = "BASE SYSTEM";

  it("injects the reminder once within the last N steps before the cap", () => {
    // maxSteps 60, remind within last 10 → from step 50.
    expect(reflectionSystemOverride({ stepNumber: 50, maxSteps: 60, baseSystem: base })).toContain(
      STEP_50_REMINDER,
    );
    expect(reflectionSystemOverride({ stepNumber: 55, maxSteps: 60, baseSystem: base })).toContain(base);
  });

  it("does NOT inject before the threshold", () => {
    expect(reflectionSystemOverride({ stepNumber: 49, maxSteps: 60, baseSystem: base })).toBeUndefined();
    expect(reflectionSystemOverride({ stepNumber: 0, maxSteps: 60, baseSystem: base })).toBeUndefined();
  });

  it("reminder is calm, not scary — frames a normal wrap-up + next-patrol safety net", () => {
    // R3 in the spec: must not panic the agent into dropping still-gettable episodes.
    expect(STEP_50_REMINDER).toContain("巡检"); // remaining caught next patrol
    expect(STEP_50_REMINDER).toContain("discardStaging"); // TV/anime cleanup
    expect(STEP_50_REMINDER).toContain("flattenMovie"); // movie cleanup (not discardStaging)
    expect(STEP_50_REMINDER).toMatch(/不是失败|正常|稳/); // reassuring framing
  });
});

describe("stepReflectionNudge", () => {
  it("returns the step reminder within the window, null before", () => {
    expect(stepReflectionNudge(50, 60)).toBe(STEP_50_REMINDER);
    expect(stepReflectionNudge(59, 60)).toBe(STEP_50_REMINDER);
    expect(stepReflectionNudge(49, 60)).toBeNull();
  });
});

describe("budgetReflectionNudge (115 call-budget soft warning)", () => {
  it("fires at/after the soft threshold (240), not before", () => {
    expect(budgetReflectionNudge(239)).toBeNull();
    expect(budgetReflectionNudge(240)).toBe(BUDGET_REMINDER);
    expect(budgetReflectionNudge(299)).toBe(BUDGET_REMINDER);
  });

  it("no nudge when spent is unknown (fakes/sim without apiCallCount)", () => {
    expect(budgetReflectionNudge(undefined)).toBeNull();
  });

  it("soft threshold is 240 (hard limit 300 is the guard's throw)", () => {
    expect(BUDGET_SOFT_REMIND_AT).toBe(240);
  });

  it("reminder is a calm wrap-up: markObtained + next-patrol safety net", () => {
    expect(BUDGET_REMINDER).toContain("markObtained");
    expect(BUDGET_REMINDER).toMatch(/不是失败|正常|巡检/);
  });

  it("cleanup step is movie-aware: TV uses discardStaging, movie uses flattenMovie (not discardStaging)", () => {
    // Injected for both TV and movie runs — must not tell a movie to discardStaging
    // (movies have no separate staging; that path is wrong/harmful). Copilot PR#22.
    expect(BUDGET_REMINDER).toContain("discardStaging"); // still the TV/anime path
    expect(BUDGET_REMINDER).toContain("flattenMovie"); // movie path explicitly covered
    expect(BUDGET_REMINDER).toMatch(/电影.*不要再?\s*discardStaging|电影.*flattenMovie/);
  });
});

describe("budgetSoftThreshold (derive soft from configured hard)", () => {
  it("default hard 300 → soft 240 (作者拍板)", () => {
    expect(budgetSoftThreshold(300)).toBe(240);
  });
  it("tracks an overridden hard limit (stays headroom below it)", () => {
    expect(budgetSoftThreshold(500)).toBe(500 - BUDGET_SOFT_HEADROOM);
  });
  it("clamps to ≥1 for a tiny budget (never negative)", () => {
    expect(budgetSoftThreshold(10)).toBe(1);
  });
});

describe("prepareStepSystemOverride (composes step-cap + budget nudges)", () => {
  const base = "BASE SYSTEM";
  it("budget only: over 240 calls, far from step cap → budget nudge, no step nudge", () => {
    const s = prepareStepSystemOverride({ stepNumber: 5, maxSteps: 60, baseSystem: base, apiCallsSpent: 250 })!;
    expect(s).toContain(BUDGET_REMINDER);
    expect(s).not.toContain(STEP_50_REMINDER);
    expect(s).toContain(base);
  });
  it("step only: near cap, under budget → step nudge, no budget nudge", () => {
    const s = prepareStepSystemOverride({ stepNumber: 55, maxSteps: 60, baseSystem: base, apiCallsSpent: 10 })!;
    expect(s).toContain(STEP_50_REMINDER);
    expect(s).not.toContain(BUDGET_REMINDER);
  });
  it("both: near cap AND over budget → both nudges appended", () => {
    const s = prepareStepSystemOverride({ stepNumber: 55, maxSteps: 60, baseSystem: base, apiCallsSpent: 260 })!;
    expect(s).toContain(STEP_50_REMINDER);
    expect(s).toContain(BUDGET_REMINDER);
  });
  it("neither → undefined (no override)", () => {
    expect(prepareStepSystemOverride({ stepNumber: 5, maxSteps: 60, baseSystem: base, apiCallsSpent: 10 })).toBeUndefined();
    expect(prepareStepSystemOverride({ stepNumber: 5, maxSteps: 60, baseSystem: base })).toBeUndefined();
  });
});

describe("DEFAULT_MAX_STEPS", () => {
  it("is 60 (raised from the old 40 that killed 一人之下)", () => {
    expect(DEFAULT_MAX_STEPS).toBe(60);
  });
});

describe("hasSuccessfulFinish — finish 后即停(复联4 live:finish ×3 尾巴)", () => {
  it("成功的 finish 结果(带 coverageMet)→ true", () => {
    const steps = [
      {
        toolCalls: [{ toolName: "finish", input: {} }],
        toolResults: [
          { output: { coverageMet: true, obtained: ["MOVIE"], missing: [], subtitleFallback: true } },
        ],
      },
    ];
    expect(hasSuccessfulFinish(steps)).toBe(true);
  });

  it("coverageMet:false 的 finish → false(早产 finish 可恢复;sandbox.finish 无护栏,连环 finish 由 repetition 停兜底)", () => {
    const steps = [
      {
        toolCalls: [{ toolName: "finish", input: {} }],
        toolResults: [
          { output: { coverageMet: false, obtained: [], missing: ["S01E01"], subtitleFallback: false } },
        ],
      },
    ];
    expect(hasSuccessfulFinish(steps)).toBe(false);
  });

  it("finish 带 {error} 结果 → false(循环继续,可恢复)", () => {
    const steps = [
      {
        toolCalls: [{ toolName: "finish", input: {} }],
        toolResults: [{ output: { error: "SANDBOX: not ready" } }],
      },
    ];
    expect(hasSuccessfulFinish(steps)).toBe(false);
  });

  it("其他工具的成功结果 → false", () => {
    const steps = [
      {
        toolCalls: [{ toolName: "markObtained", input: { codes: ["MOVIE"] } }],
        toolResults: [{ output: { confirmed: ["MOVIE"] } }],
      },
    ];
    expect(hasSuccessfulFinish(steps)).toBe(false);
  });
});

describe("hasSuccessfulNoCoverageReport — 病1: 报后即停", () => {
  it("成功的 reportNoCoverage 结果 → true", () => {
    const steps = [
      {
        toolCalls: [{ toolName: "reportNoCoverage", input: { reason: "no results" } }],
        toolResults: [{ output: { reason: "no results", searchesPerformed: 3 } }],
      },
    ];
    expect(hasSuccessfulNoCoverageReport(steps)).toBe(true);
  });

  it("被 §9 护栏拒绝（{error} 结果）→ false（循环继续）", () => {
    const steps = [
      {
        toolCalls: [{ toolName: "reportNoCoverage", input: { reason: "premature" } }],
        toolResults: [{ output: { error: "SANDBOX_NO_PROVIDER_EVIDENCE: ..." } }],
      },
    ];
    expect(hasSuccessfulNoCoverageReport(steps)).toBe(false);
  });

  it("其他工具的成功结果 → false", () => {
    const steps = [
      {
        toolCalls: [{ toolName: "searchResources", input: { keyword: "x" } }],
        toolResults: [{ output: { snapshot: { id: "s1" } } }],
      },
    ];
    expect(hasSuccessfulNoCoverageReport(steps)).toBe(false);
  });

  it("output 非对象（字符串/null）→ false", () => {
    const steps = [
      {
        toolCalls: [{ toolName: "reportNoCoverage", input: { reason: "x" } }],
        toolResults: [{ output: "some string error" }, { output: null }],
      },
    ];
    expect(hasSuccessfulNoCoverageReport(steps)).toBe(false);
  });
});
