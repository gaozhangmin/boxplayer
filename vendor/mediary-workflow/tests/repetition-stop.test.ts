import { describe, expect, it } from "vitest";
import { shouldStopForRepetition, type ToolStepSignature } from "../src/index.js";

function sig(tool: string, args: string, result: string): ToolStepSignature {
  return { tool, args, result };
}

describe("shouldStopForRepetition (OpenHands-style)", () => {
  it("does not stop on short or empty histories", () => {
    expect(shouldStopForRepetition([])).toBe(false);
    expect(shouldStopForRepetition([sig("searchResources", "a", "r")])).toBe(false);
  });

  it("stops on 4 identical action-observation pairs in a row", () => {
    const s = sig("inspectTargetDir", '{"season":6}', "[]");
    expect(shouldStopForRepetition([s, s, s, s])).toBe(true);
  });

  it("does NOT stop on 3 identical pairs (threshold is 4, conservative)", () => {
    const s = sig("searchResources", '{"keyword":"x"}', "empty");
    expect(shouldStopForRepetition([s, s, s])).toBe(false);
  });

  it("does NOT stop on legit consecutive transfers with different args/results", () => {
    // The false-positive guard: real back-to-back transferCandidate of DIFFERENT
    // candidates landing DIFFERENT files is progress, not a loop.
    const steps = [
      sig("transferCandidate", '{"candidateId":"c1"}', "files:[1,2]"),
      sig("transferCandidate", '{"candidateId":"c2"}', "files:[3,4]"),
      sig("transferCandidate", '{"candidateId":"c3"}', "files:[5,6]"),
      sig("transferCandidate", '{"candidateId":"c4"}', "files:[7,8]"),
    ];
    expect(shouldStopForRepetition(steps)).toBe(false);
  });

  it("stops on a 6-step A/B ping-pong", () => {
    const a = sig("searchResources", '{"keyword":"a"}', "r1");
    const b = sig("readSkill", '{"section":"tv"}', "skill");
    expect(shouldStopForRepetition([a, b, a, b, a, b])).toBe(true);
  });

  it("does NOT stop on a 4-step A/B alternation (below the ping-pong window)", () => {
    const a = sig("searchResources", '{"keyword":"a"}', "r1");
    const b = sig("readSkill", '{"section":"tv"}', "skill");
    expect(shouldStopForRepetition([a, b, a, b])).toBe(false);
  });

  it("only inspects the TAIL — earlier repetition that has since broken does not trip it", () => {
    const s = sig("searchResources", '{"keyword":"x"}', "empty");
    const fresh = sig("transferCandidate", '{"candidateId":"c1"}', "files:[1]");
    expect(shouldStopForRepetition([s, s, s, fresh])).toBe(false);
  });
});
