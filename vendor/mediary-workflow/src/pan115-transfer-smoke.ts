import type {
  ResourceCandidate,
  ResourceSnapshot,
  TransferAttempt,
  VerifiedFile,
} from "./domain.js";
import type { ResourceProvider, StorageExecutor } from "./ports.js";

export type Pan115ShareAdapterSmokeStatus =
  | "succeeded"
  | "exhausted"
  | "no_115_candidates"
  | "aborted";

export interface Pan115ShareAdapterSmokeResult {
  status: Pan115ShareAdapterSmokeStatus;
  snapshot: ResourceSnapshot | null;
  transferAttempts: TransferAttempt[];
  finalFiles: VerifiedFile[];
  failureReasons: string[];
  abortReason: string | null;
}

/**
 * Adapter smoke harness only.
 *
 * This probes PanSou -> 115 transfer/verification behavior and records provider
 * failure surfaces. Production workflow fallback must remain agent-decision
 * driven through selected snapshot candidates, not this sequential harness.
 */
export async function runPan115ShareAdapterSmoke(input: {
  keyword: string;
  workflowRunId: string;
  directoryId: string;
  resourceProvider: ResourceProvider;
  storage: StorageExecutor;
  maxCandidates?: number;
}): Promise<Pan115ShareAdapterSmokeResult> {
  const snapshot = await input.resourceProvider.search({ keyword: input.keyword });
  const candidates = snapshot.candidates
    .filter(is115ShareCandidate)
    .slice(0, input.maxCandidates ?? snapshot.candidates.length);

  if (candidates.length === 0) {
    return {
      status: "no_115_candidates",
      snapshot,
      transferAttempts: [],
      finalFiles: [],
      failureReasons: [],
      abortReason: null,
    };
  }

  const transferAttempts: TransferAttempt[] = [];
  const failureReasons: string[] = [];

  for (const candidate of candidates) {
    try {
      const attempt = await input.storage.transfer({
        workflowRunId: input.workflowRunId,
        directoryId: input.directoryId,
        candidate,
      });
      transferAttempts.push(attempt);

      if (attempt.status === "succeeded" && attempt.materializedFileIds.length > 0) {
        return {
          status: "succeeded",
          snapshot,
          transferAttempts,
          finalFiles: await input.storage.listVideoFiles(input.directoryId),
          failureReasons,
          abortReason: null,
        };
      }

      if (attempt.providerMessage) {
        failureReasons.push(attempt.providerMessage);
      } else {
        failureReasons.push(attempt.status);
      }
    } catch (error) {
      const message = errorMessage(error);
      if (isAbortError(message, error)) {
        return {
          status: "aborted",
          snapshot,
          transferAttempts,
          finalFiles: await input.storage.listVideoFiles(input.directoryId),
          failureReasons,
          abortReason: message,
        };
      }
      failureReasons.push(message);
    }
  }

  return {
    status: "exhausted",
    snapshot,
    transferAttempts,
    finalFiles: await input.storage.listVideoFiles(input.directoryId),
    failureReasons,
    abortReason: null,
  };
}

function is115ShareCandidate(candidate: ResourceCandidate): boolean {
  const url = candidate.providerPayload["url"];
  return (
    candidate.type === "115" &&
    typeof url === "string" &&
    (url.startsWith("https://115.com/s/") || url.startsWith("https://115cdn.com/s/"))
  );
}

function isAbortError(message: string, error: unknown): boolean {
  if (error instanceof Error && error.name === "Pan115RiskControlError") {
    return true;
  }
  return (
    message.includes("PAN115_RATE_LIMIT") ||
    message.includes("WRITE_SCOPE_VIOLATION") ||
    message.includes("SAFETY_VIOLATION")
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "unknown transfer error";
}
