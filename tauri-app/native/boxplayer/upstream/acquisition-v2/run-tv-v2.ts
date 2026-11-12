import type { LanguageModel } from "ai";
import type { MediaTitle } from "../domain.js";
import type { ResourceProvider, StorageExecutor } from "../ports.js";
import {
  bridgeV2WorkflowToResult,
  type BridgedV2Result,
  type V2BridgeMode,
  type V2BridgeSeasonIntent,
} from "./workflow-v2-bridge.js";
import type { DeadLinkStore } from "./dead-links.js";
import { runAcquisitionV2Workflow } from "./workflow-v2.js";
import { getQualityGuidance, getSearchRecipe, searchProfile } from "./search-profile.js";
import type { AgentToolEvent } from "./activity.js";

function defaultNowIso(): string {
  return new Date().toISOString();
}

/**
 * Phase 7d — the single TV/anime acquisition entry on the V2 engine. type2 init,
 * series init, and type3 patrol are all the SAME resource-sync workflow
 * (verify-or-create dirs → sync need → strong agent → reconcile); they differ
 * only in the notification framing, captured by `mode`. Returns the bridged
 * per-season WorkflowResult facts; persistence is the runner's job.
 */
export interface RunTvAcquisitionV2Request {
  title: MediaTitle;
  mode: V2BridgeMode;
  seasons: V2BridgeSeasonIntent[];
  /** Library category parent (Movies/TV/Anime), chosen by title.type upstream. */
  categoryParentId: string;
  resourceProvider: ResourceProvider;
  storage: StorageExecutor;
  model: LanguageModel;
  workflowRunId: string;
  /** 实有 = the DB obtained marks (agent's prior markObtained); empty for a first
   *  acquisition, the type-3 patrol passes the DB obtained codes. */
  priorObtained?: string[];
  searchBudget?: number;
  maxSteps?: number;
  preferredLanguage?: string;
  /** Global quality preference ("high"/"medium"); undefined = 不限 (no guidance). */
  qualityPreference?: "high" | "medium";
  /** The run's drive brand ("pan115" | "quark") — selects brand-specific skill. */
  storageProvider?: string;
  /** assrt token (Settings → 字幕来源). Undefined = 字幕流程不触发。 */
  assrtToken?: string;
  deadLinkStore?: DeadLinkStore;
  onProgress?: (event: AgentToolEvent) => void;
  now?: () => string;
}

export async function runTvAcquisitionV2(request: RunTvAcquisitionV2Request): Promise<BridgedV2Result> {
  if (request.seasons.length === 0) {
    throw new Error("runTvAcquisitionV2 requires at least one season in scope");
  }
  // The fine-grained profile drives BOTH the keyword recipe and the quality
  // guidance (e.g. anime → "4K is scarce, don't over-search for it").
  const profile = searchProfile({
    type: request.title.type,
    originCountries: request.title.originCountries ?? [],
  });
  const qualityGuidance = getQualityGuidance(profile, request.qualityPreference);
  const v2 = await runAcquisitionV2Workflow({
    provider: request.resourceProvider,
    executor: request.storage,
    model: request.model,
    workflowRunId: request.workflowRunId,
    title: {
      name: request.title.title,
      year: request.title.year ?? 0,
      aliases: request.title.aliases ?? [],
    },
    categoryParentId: request.categoryParentId,
    seasons: request.seasons.map((season) => ({
      seasonNumber: season.seasonNumber,
      latestAiredEpisode: season.latestAiredEpisode,
    })),
    qualityPreference: request.seasons[0]!.qualityPreference,
    searchHints: getSearchRecipe(profile),
    searchProfile: profile,
    ...(qualityGuidance === "" ? {} : { qualityGuidance }),
    ...(request.priorObtained === undefined ? {} : { priorObtained: request.priorObtained }),
    ...(request.searchBudget === undefined ? {} : { searchBudget: request.searchBudget }),
    ...(request.maxSteps === undefined ? {} : { maxSteps: request.maxSteps }),
    ...(request.preferredLanguage === undefined ? {} : { preferredLanguage: request.preferredLanguage }),
    ...(request.title.originCountries === undefined ? {} : { originCountries: request.title.originCountries }),
    ...(request.storageProvider === undefined ? {} : { storageProvider: request.storageProvider }),
    ...(request.assrtToken === undefined ? {} : { assrtToken: request.assrtToken }),
    ...(request.deadLinkStore ? { deadLinkStore: request.deadLinkStore } : {}),
    ...(request.onProgress ? { onProgress: request.onProgress } : {}),
  });

  return bridgeV2WorkflowToResult({
    title: request.title,
    mode: request.mode,
    seasons: request.seasons,
    v2,
    workflowRunId: request.workflowRunId,
    now: request.now ?? defaultNowIso,
  });
}
