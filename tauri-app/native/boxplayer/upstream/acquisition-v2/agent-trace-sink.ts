import type { WorkflowRepository } from "../repository.js";
import type { AgentStep } from "../domain.js";
import type { AgentToolEvent } from "./activity.js";

const MAX_ARGS_JSON = 2000;

/** Defensive cap: a pathologically large args object (e.g. a giant moveToSeason
 *  plan) collapses to a marker so one trace row can't bloat unbounded. */
function cappedArgs(args: Record<string, unknown>): Record<string, unknown> {
  try {
    if (JSON.stringify(args).length <= MAX_ARGS_JSON) {
      return args;
    }
  } catch {
    // non-serializable → fall through to marker
  }
  return { _truncated: true };
}

/**
 * A tool-event sink that appends each agent tool call to the durable step trace.
 * Fire-and-forget + error-swallowing: observability MUST NEVER fail an acquisition.
 * Fires from `onToolCall` (pre-execution), so even a tool that then throws/hangs
 * (e.g. a 115 budget exhaustion) still leaves its step — crash-safe by construction.
 * `apiCallCount` (optional) stamps the cumulative 115 API calls so far, making the
 * budget-burn curve visible across the trace.
 */
export function makeAgentTraceSink(input: {
  repository: Pick<WorkflowRepository, "appendAgentStep"> &
    Partial<Pick<WorkflowRepository, "clearAgentSteps">>;
  workflowRunId: string;
  apiCallCount?: () => number | undefined;
  now?: () => string;
}): (event: AgentToolEvent) => void {
  const now = input.now ?? (() => new Date().toISOString());
  let ordinal = 0;
  // A manual retry / auto-requeue re-runs under the SAME run id, but this fresh
  // sink restarts ordinal at 0 — so the prior attempt's rows must be cleared first,
  // or the new steps collide (PG: dropped via ON CONFLICT; InMemory: duplicated).
  // The clear is the head of a serialized chain: every append waits for it (and for
  // the previous append), so writes land in order and never race the clear — while
  // the agent itself never awaits any of this (fire-and-forget).
  let tail: Promise<unknown> = Promise.resolve(
    input.repository.clearAgentSteps?.(input.workflowRunId),
  ).catch(() => {
    // best-effort; a failed clear must never surface
  });
  return (event: AgentToolEvent) => {
    const apiCalls = input.apiCallCount?.();
    const step: AgentStep = {
      ordinal: ordinal++,
      toolName: event.toolName,
      args: cappedArgs(event.args),
      activity: event.activity,
      phase: event.phase,
      ...(typeof apiCalls === "number" ? { apiCalls } : {}),
      at: now(),
    };
    tail = tail
      .then(() => input.repository.appendAgentStep(input.workflowRunId, step))
      .catch(() => {
        // trace is best-effort; never surface its write failure
      });
  };
}

/** Run several tool-event sinks for one event; each is isolated so one throwing
 *  sink never starves the others (progress must survive a trace failure & vice versa). */
export function combineToolEventSinks(
  ...sinks: Array<(event: AgentToolEvent) => void>
): (event: AgentToolEvent) => void {
  return (event: AgentToolEvent) => {
    for (const sink of sinks) {
      try {
        sink(event);
      } catch {
        // isolate: a misbehaving sink must not break the others
      }
    }
  };
}
