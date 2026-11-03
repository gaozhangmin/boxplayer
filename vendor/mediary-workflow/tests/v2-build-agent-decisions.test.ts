import { describe, expect, it } from "vitest";
import { buildAgentDecisions } from "../src/acquisition-v2/orchestrator.js";
import type { ResourceSnapshot, TransferAttempt } from "../src/domain.js";

/** The exact invariant validateWorkflowRunSnapshot enforces (repository.ts:365):
 *  every selected candidate in a decision must belong to that decision's snapshot. */
function assertDecisionsSatisfyPersistInvariant(decisions: ReturnType<typeof buildAgentDecisions>, snapshots: ResourceSnapshot[]) {
  const candidatesBySnapshot = new Map(snapshots.map((s) => [s.id, new Set(s.candidates.map((c) => c.id))]));
  for (const decision of decisions) {
    const allowed = candidatesBySnapshot.get(decision.snapshotId);
    expect(allowed, `decision.snapshotId ${decision.snapshotId} must be a persisted snapshot`).toBeDefined();
    for (const candidateId of decision.selectedCandidateIds) {
      expect(allowed!.has(candidateId), `${candidateId} must belong to ${decision.snapshotId}`).toBe(true);
    }
  }
}

/**
 * Live e2e (2026-06-15) caught this: when the agent searches several times and
 * transfers a candidate from a LATER snapshot, the old assembly tagged the single
 * decision with resourceSnapshots[0].id — so persist validation ("decision
 * referenced candidates outside persisted resource snapshots") rejected a run the
 * agent had actually SUCCEEDED. Decisions must be grouped by each candidate's REAL
 * snapshot.
 */
function snap(id: string, candidateIds: string[]): ResourceSnapshot {
  return {
    id,
    keyword: id,
    provider: "pansou",
    createdAt: "2026-06-15T00:00:00.000Z",
    candidates: candidateIds.map((cid, index) => ({
      id: cid,
      snapshotId: id,
      index,
      title: cid,
      type: "115",
      source: "pansou",
      providerPayload: {},
    })),
  };
}

function attempt(candidateId: string): TransferAttempt {
  return { id: `att_${candidateId}`, workflowRunId: "run1", candidateId, status: "succeeded", providerMessage: "", materializedFileIds: ["f1"] };
}

describe("buildAgentDecisions — groups selected candidates by their REAL snapshot", () => {
  it("tags a candidate transferred from a later snapshot with THAT snapshot, not the first", () => {
    const snapshots = [snap("snap_1", ["snap_1_c1", "snap_1_c2"]), snap("snap_2", ["snap_2_c1"])];
    const transferAttempts = [attempt("snap_2_c1")]; // transferred from the 2nd search

    const decisions = buildAgentDecisions({ transferAttempts, resourceSnapshots: snapshots, coverageMet: true, reason: "ok" });

    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.snapshotId).toBe("snap_2"); // not "snap_1"
    expect(decisions[0]!.selectedCandidateIds).toEqual(["snap_2_c1"]);
    // And the result must satisfy the persist invariant that was rejecting it live.
    assertDecisionsSatisfyPersistInvariant(decisions, snapshots);
  });

  it("emits one decision per snapshot when transfers span multiple snapshots", () => {
    const snapshots = [snap("snap_1", ["snap_1_c1"]), snap("snap_2", ["snap_2_c1"])];
    const transferAttempts = [attempt("snap_1_c1"), attempt("snap_2_c1")];

    const decisions = buildAgentDecisions({ transferAttempts, resourceSnapshots: snapshots, coverageMet: true, reason: "ok" });

    expect(decisions.map((d) => d.snapshotId).sort()).toEqual(["snap_1", "snap_2"]);
    assertDecisionsSatisfyPersistInvariant(decisions, snapshots);
  });

  it("no transfers → no decisions", () => {
    expect(buildAgentDecisions({ transferAttempts: [], resourceSnapshots: [snap("s", ["c"])], coverageMet: false, reason: "" })).toEqual([]);
  });
});
