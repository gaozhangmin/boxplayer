import type { StopCondition, ToolSet } from "ai";
import { shouldStopForRepetition, type ToolStepSignature } from "./repetition-stop.js";

/**
 * Harness guards for the agent loop. The old `stepCountIs(40)` hard-kill was the
 * wrong primitive (killed legit long tasks like the 6-season 一人之下, missed tight
 * loops). We replace it with: a higher step ceiling (60), a cheap OpenHands-style
 * repetition stop, and a calm reflection nudge in the last 10 steps that tells the
 * agent to wrap up + clean staging rather than leave a half-done mess.
 * See the 2026-06-16 design spec.
 */

/** Raised from 40 — a multi-season show needs the headroom; cost/runaway is bounded by this + the repetition stop. */
export const DEFAULT_MAX_STEPS = 60;

/** How many steps before the cap the reflection reminder kicks in. */
export const REMIND_WITHIN_STEPS = 10;

/** Calm wrap-up nudge (R3: must NOT scare the agent into dropping still-gettable episodes). */
export const STEP_50_REMINDER =
  "【进度提醒】本次任务已接近步数预算(约剩 10 步)。这是正常的收尾信号,不是失败。请:" +
  "① 不要再发起任何新的搜索或转存(searchResources / transferCandidate / transferUntilLanded 都不要);" +
  "② 把已转存好的归位(TV/动漫用 moveToSeason 入季;电影用 flattenMovie 收进影片目录)、对确实落盘的 markObtained;" +
  "③ 打扫战场:TV/动漫用 discardStaging 清空 staging;电影没有独立 staging——由 flattenMovie(见②)负责就地清掉包装目录,不要用 discardStaging;④ finish。" +
  "这次没来得及拿的集不要紧——只要没被 markObtained,下次每日巡检会自动发现并补齐。" +
  "请稳妥收尾,绝不要为赶进度草率丢弃还能拿到的资源。";

/** Default SOFT-warning threshold, used only as a fallback when the hard budget is
 *  unknown (storage without apiCallBudget). In production the threshold is DERIVED
 *  from the configured hard limit via budgetSoftThreshold so the two never drift
 *  (default hard 300 → soft 240, matching the拍板 design). */
export const BUDGET_SOFT_REMIND_AT = 240;

/** Headroom (in 115 calls) reserved between the SOFT warning and the HARD limit, so
 *  the agent's own wrap-up (markObtained / discardStaging — themselves a few 115
 *  calls) still fits before the hard stop. Default hard 300 − 60 = soft 240. */
export const BUDGET_SOFT_HEADROOM = 60;

/** Derive the SOFT-warning threshold from the configured HARD budget so they stay
 *  consistent even when MEDIA_TRACK_115_MAX_API_CALLS overrides the limit. */
export function budgetSoftThreshold(hardBudget: number): number {
  return Math.max(1, hardBudget - BUDGET_SOFT_HEADROOM);
}

/** Calm wrap-up nudge for the 115 call budget — mirrors STEP_50_REMINDER's tone.
 *  No hardcoded numbers: the threshold is configurable, so the text stays generic. */
export const BUDGET_REMINDER =
  "【网盘调用提醒】本次任务的 115 接口调用已接近预算上限。这是正常的收尾信号,不是失败。请:" +
  "① 不要再发起任何新的搜索或转存(searchResources / transferCandidate / transferUntilLanded 都不要);" +
  "② 对确实落盘的 markObtained、把已转存好的归位(TV/动漫用 moveToSeason 入季;电影用 flattenMovie 收进影片目录);" +
  "③ 打扫战场:TV/动漫用 discardStaging 清空 staging;电影已落影片目录、flattenMovie 已就地清理,不要再 discardStaging;④ finish。" +
  "这次没来得及拿的集不要紧——只要没被 markObtained,下次每日巡检会自动补齐。" +
  "请立刻稳妥收尾:调用一旦到硬上限会被强制中断,别把预算耗在还没收尾上。";

/** The step-cap reminder as a pure nudge (text or null) — within the last
 *  `within` steps before the cap. Composable with other nudges in prepareStep. */
export function stepReflectionNudge(
  stepNumber: number,
  maxSteps: number,
  within: number = REMIND_WITHIN_STEPS,
): string | null {
  return stepNumber >= maxSteps - within ? STEP_50_REMINDER : null;
}

/** The 115 call-budget reminder as a pure nudge (text or null) — at/after the soft
 *  threshold. `spent` undefined (storage without apiCallCount, e.g. fakes) → null. */
export function budgetReflectionNudge(
  spent: number | undefined,
  softAt: number = BUDGET_SOFT_REMIND_AT,
): string | null {
  return typeof spent === "number" && spent >= softAt ? BUDGET_REMINDER : null;
}

// Minimal structural view of an AI-SDK StepResult — only the fields we read.
interface StepLike {
  toolCalls?: ReadonlyArray<{ toolName: string; input: unknown }>;
  toolResults?: ReadonlyArray<{ output: unknown }>;
}

/** Normalize one loop step into a comparable signature (ids/timestamps excluded — input+output only). */
export function toStepSignature(step: StepLike): ToolStepSignature {
  const calls = step.toolCalls ?? [];
  const results = step.toolResults ?? [];
  return {
    tool: calls.map((c) => c.toolName).join("+"),
    args: JSON.stringify(calls.map((c) => c.input)),
    result: JSON.stringify(results.map((r) => r.output)),
  };
}

/** A StopCondition (for `generateText({ stopWhen })`) that fires on repetition/ping-pong. */
export function buildRepetitionStop<TOOLS extends ToolSet = ToolSet>(): StopCondition<TOOLS> {
  return ({ steps }) => shouldStopForRepetition((steps as ReadonlyArray<StepLike>).map(toStepSignature));
}

/**
 * Does the step history contain a systemic transfer block (quota / auth / VIP) with
 * nothing landed? The agent loop should stop — every candidate will fail the same way.
 * Reads the systemicBlock field that transferCandidate / transferUntilLanded surface.
 */
export function hasSystemicTransferBlock(steps: ReadonlyArray<StepLike>): boolean {
  let hasBlock = false;
  let anythingLanded = false;
  for (const step of steps) {
    for (const result of step.toolResults ?? []) {
      const output = result.output as
        | {
            systemicBlock?: { reason: string };
            attempt?: { status?: string; materializedFileIds?: ReadonlyArray<unknown> };
            transferredCandidateId?: string | null;
            staging?: ReadonlyArray<unknown>;
            landed?: ReadonlyArray<unknown>;
          }
        | undefined;
      if (output?.systemicBlock) {
        hasBlock = true;
      }
      // Something landed ⇒ the account CAN transfer, so a later systemic-looking
      // message is not an account block. Check the ACTUAL landed files, not just the
      // status flag: a provider can materialize files yet mark the attempt failed
      // (e.g. quark), and the truth is the landing point (materializedFileIds /
      // staging / landed tree), per the "trust the reread, not the prediction" rule.
      if (
        output?.attempt?.status === "succeeded" ||
        Boolean(output?.transferredCandidateId) ||
        (output?.attempt?.materializedFileIds?.length ?? 0) > 0 ||
        (output?.staging?.length ?? 0) > 0 ||
        (output?.landed?.length ?? 0) > 0
      ) {
        anythingLanded = true;
      }
    }
  }
  // Only a block if nothing landed — if something transferred, the account works.
  return hasBlock && !anythingLanded;
}

/** A StopCondition that fires when a systemic transfer block is detected. */
export function buildSystemicBlockStop<TOOLS extends ToolSet = ToolSet>(): StopCondition<TOOLS> {
  return ({ steps }) => hasSystemicTransferBlock(steps as ReadonlyArray<StepLike>);
}

/**
 * 病1 fix (2026-07-06 GITS incident): reportNoCoverage was registered as an
 * ordinary evidence tool, so an honest no-coverage report did NOT end the run —
 * the model idled, re-read skills, and double-reported (2.5 min of dead tail).
 * A SUCCESSFUL report (the sandbox's §9 evidence check passed — output carries
 * no `error`) is a terminal declaration: stop the loop immediately. A REFUSED
 * report ({error: SANDBOX_NO_PROVIDER_EVIDENCE...}) keeps the loop alive — that
 * refusal is an infrastructure guard, not an honest result.
 */
export function hasSuccessfulNoCoverageReport(steps: ReadonlyArray<StepLike>): boolean {
  for (const step of steps) {
    if (!(step.toolCalls ?? []).some((c) => c.toolName === "reportNoCoverage")) {
      continue;
    }
    for (const result of step.toolResults ?? []) {
      // NOTE: TransferToolResult carries systemicBlock.reason at a NESTED level;
      // this shallow cast only sees top-level fields, so a systemic-block result
      // can never trip the reason check.
      const output = result.output as
        | { error?: unknown; reason?: unknown; searchesPerformed?: number }
        | undefined;
      if (output && output.error === undefined && output.reason !== undefined) {
        return true;
      }
    }
  }
  return false;
}

/** A StopCondition that ends the loop once the agent has successfully reported no coverage. */
export function buildNoCoverageStop<TOOLS extends ToolSet = ToolSet>(): StopCondition<TOOLS> {
  return ({ steps }) => hasSuccessfulNoCoverageReport(steps as ReadonlyArray<StepLike>);
}

/** Whether any step carries a SUCCESSFUL finish result — the coverage summary,
 *  error-free AND coverageMet:true. Mirrors hasSuccessfulNoCoverageReport: finish
 *  is the symmetric terminal declaration — 复联4 live (2026-07-17) showed the model
 *  calling finish ×3 in a row (~2 wasted steps) because only reportNoCoverage had
 *  a mechanical stop. Two cases deliberately do NOT stop:
 *  - {error} result (premature call stays recoverable);
 *  - coverageMet:false — unlike reportNoCoverage (whose §9 guard REJECTS a
 *    premature report), sandbox.finish() has no guard and always returns the
 *    summary, so a first-move premature finish would otherwise hard-kill the run
 *    with nothing done. Unmet coverage hands judgment back to the model; a model
 *    that loops finish anyway is caught by the repetition stop / step cap. */
export function hasSuccessfulFinish(steps: ReadonlyArray<StepLike>): boolean {
  for (const step of steps) {
    if (!(step.toolCalls ?? []).some((c) => c.toolName === "finish")) {
      continue;
    }
    for (const result of step.toolResults ?? []) {
      const output = result.output as { error?: unknown; coverageMet?: unknown } | undefined;
      if (output && output.error === undefined && output.coverageMet === true) {
        return true;
      }
    }
  }
  return false;
}

/** A StopCondition that ends the loop once the agent has successfully declared finish. */
export function buildFinishStop<TOOLS extends ToolSet = ToolSet>(): StopCondition<TOOLS> {
  return ({ steps }) => hasSuccessfulFinish(steps as ReadonlyArray<StepLike>);
}

/**
 * The reflection nudge, as a pure decision: within the last REMIND_WITHIN_STEPS
 * steps before the cap, return the base system text + reminder (to override the
 * step's system message); otherwise undefined (no override). Pure → unit-testable.
 */
export function reflectionSystemOverride(input: {
  stepNumber: number;
  maxSteps: number;
  baseSystem: string;
  remindWithinSteps?: number;
}): string | undefined {
  const nudge = stepReflectionNudge(input.stepNumber, input.maxSteps, input.remindWithinSteps);
  return nudge ? `${input.baseSystem}\n\n${nudge}` : undefined;
}

/**
 * Compose the applicable wrap-up nudges (step-cap AND/OR 115 budget) onto the base
 * system for one step. Returns the overridden system text, or undefined when no
 * nudge applies. Both can fire at once (near the step cap AND over budget) — then
 * both are appended. Pure → unit-testable; prepareStep just calls this.
 */
export function prepareStepSystemOverride(input: {
  stepNumber: number;
  maxSteps: number;
  baseSystem: string;
  apiCallsSpent?: number;
  remindWithinSteps?: number;
  budgetSoftAt?: number;
}): string | undefined {
  const nudges = [
    stepReflectionNudge(input.stepNumber, input.maxSteps, input.remindWithinSteps),
    budgetReflectionNudge(input.apiCallsSpent, input.budgetSoftAt),
  ].filter((nudge): nudge is string => nudge !== null);
  return nudges.length > 0 ? [input.baseSystem, ...nudges].join("\n\n") : undefined;
}
