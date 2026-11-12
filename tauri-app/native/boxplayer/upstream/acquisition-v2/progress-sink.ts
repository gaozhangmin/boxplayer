import type { WorkflowRepository } from "../repository.js";
import { phaseProgress, type AgentToolEvent } from "./activity.js";

/**
 * Build the per-tool-call progress sink the runner wires into the agent loop. It
 * turns each real tool event into a monotonic, phase-weighted progress write on
 * the run (for the activity page). Fire-and-forget + error-swallowing: a progress
 * write must NEVER throw and fail an otherwise-good acquisition.
 *
 * `neededHint` (the run's missing-episode count) lets the mark phase show a real
 * obtained/needed fraction. For every other phase the bar advances WITHIN the band
 * by an asymptotic step-count fraction (n/(n+2)) — so a long phase (several searches
 * / transfer retries) creeps forward instead of freezing at the midpoint, while
 * never escaping the band. `obtained` accumulates across markObtained calls (the
 * MOVIE sentinel is not an episode and is not counted).
 */
export function makeProgressSink(input: {
  repository: Pick<WorkflowRepository, "updateWorkflowRunProgress">;
  workflowRunId: string;
  neededHint?: number;
  now?: () => string;
}): (event: AgentToolEvent) => void {
  const now = input.now ?? (() => new Date().toISOString());
  const needed = input.neededHint ?? 0;
  let percent = 0;
  let obtained = 0;
  // Track how many tool calls the agent has made in the CURRENT phase, so the bar
  // creeps forward within a long phase (e.g., several searches / transfer retries)
  // instead of freezing at the band midpoint — it should reflect ongoing work.
  let currentPhase: AgentToolEvent["phase"] | null = null;
  let stepsInPhase = 0;

  return (event: AgentToolEvent) => {
    if (event.toolName === "markObtained") {
      const codes = Array.isArray(event.args.codes) ? event.args.codes : [];
      obtained += codes.filter((code) => code !== "MOVIE").length;
    }
    if (event.phase !== currentPhase) {
      currentPhase = event.phase;
      stepsInPhase = 0;
    }
    stepsInPhase += 1;
    // The mark phase uses its REAL obtained/needed fraction; every other phase uses
    // an asymptotic step-count fraction n/(n+2) (1st≈0.33, climbing toward — but
    // never reaching — the band end, so it stays honest within the band).
    const subFraction =
      event.phase === "mark" && needed > 0 ? obtained / needed : stepsInPhase / (stepsInPhase + 2);
    percent = Math.max(percent, phaseProgress(event.phase, subFraction));
    void Promise.resolve(
      input.repository.updateWorkflowRunProgress(input.workflowRunId, {
        activity: event.activity,
        phase: event.phase,
        percent,
        updatedAt: now(),
        ...(needed > 0 ? { obtained, needed } : {}),
      }),
    ).catch(() => {
      // Progress is a display nicety; never let its write failure surface.
    });
  };
}
