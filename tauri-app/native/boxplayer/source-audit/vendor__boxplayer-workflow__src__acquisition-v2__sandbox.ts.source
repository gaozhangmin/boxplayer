import {
  MAX_DISTINCT_PLANNING_SEARCHES,
  MOVIE_SEARCH_BUDGET,
  MOVIE_SEARCH_SOFT_THRESHOLD,
  decideSearchGate,
  keywordReferencesTitle,
  normalizeSearchKeyword,
} from "../planning-search-gate.js";
import type { AssrtCandidate, AssrtSubtitleFile, AssrtProviderPort } from "../subtitle-provider.js";
import type { ResourceProviderV2, ResourceSnapshotV2 } from "./fake-provider.js";
import type { SimTreeFile, StorageV2, TransferAttemptResult } from "./storage-115-simulator.js";
import { isSystemicTransferBlockMessage } from "./transfer-block.js";
import { animeSearchTabooWarnings, type SearchProfile } from "./search-profile.js";
import type { AuditEvent } from "../domain.js";

/** Quality / subtitle / source tokens that PanSou share titles almost never carry,
 *  so appending them collapses recall (实测归零). Case-insensitive; word-ish so
 *  "1080p" / "WEB-DL" / "BluRay" match as units. 中字/国语/双语/字幕 are CJK so they
 *  match anywhere. */
const QUALITY_SUBTITLE_TOKEN =
  /\b(?:4k|2160p|1080p|720p|hdr|dv|remux|web-?dl|bluray|bdrip)\b|蓝光|中字|国语|双语|字幕/gi;

const SUBTITLE_NAME_PATTERN = /\.(srt|ass|ssa|sub|idx|vtt|sup|smi)$/i;

const STRIP_NOTICE =
  "已从关键词移除画质/字幕词(如 4K/1080p/蓝光/中字/字幕):PanSou 是通配符匹配,加这些只会把召回打成子集或归零,raw 裸标题召回最全。已改用裸标题搜索。";

/** Threshold for large snapshot digestion hint (病3). */
const LARGE_SNAPSHOT_DIGEST_THRESHOLD = 10;

/** Strip quality/subtitle tokens from a search keyword and fold the resulting
 *  whitespace. `stripped` is true ONLY when an actual QUALITY_SUBTITLE_TOKEN was
 *  removed — NOT when mere whitespace was collapsed (so "奥本海默   第二季" does
 *  not falsely trip the strip notice). */
function stripQualitySubtitleTokens(keyword: string): { keyword: string; stripped: boolean } {
  // QUALITY_SUBTITLE_TOKEN has the /g flag → RegExp.test() is stateful on lastIndex.
  // Reset BEFORE and after the test so a non-zero lastIndex (from any prior/concurrent
  // use of this shared regex) can never make `stripped` a false negative.
  QUALITY_SUBTITLE_TOKEN.lastIndex = 0;
  const stripped = QUALITY_SUBTITLE_TOKEN.test(keyword);
  QUALITY_SUBTITLE_TOKEN.lastIndex = 0;
  const cleaned = keyword.replace(QUALITY_SUBTITLE_TOKEN, " ").replace(/\s+/g, " ").trim();
  return { keyword: cleaned, stripped };
}

/**
 * The task sandbox for the Acquisition V2 rebuild — the permission cage the
 * strong agent runs inside. It owns the budgets, the scope, the observed
 * snapshots, and (later) the storage handles, and exposes the agent's tools.
 * The agent drives its own observe-act-verify loop through these tools; the
 * sandbox only makes the documented mistakes impossible — it does NOT plan.
 *
 * This file grows one tool at a time (TDD). First tool: searchResources.
 */
export interface TaskSandboxOptions {
  provider: ResourceProviderV2;
  /** Max distinct PanSou searches per task (the system's search budget). */
  searchBudget?: number;
  /** Scoped storage + the staging handle this task may transfer into. */
  storage?: StorageV2;
  stagingDirectoryId?: string;
  /** TV/anime: season number -> scoped Season directory. A multi-season / complete-
   *  series pack's files are distributed across these per season (§2 targetSeasons +
   *  moveToSeason(fileIds, season); architecture §Multi-season; permission-audit 105/209). */
  targetSeasonDirectoryIds?: Record<number, string>;
  /** Movie: the single scoped movie directory (§2 targetMovieDir). A movie has no
   *  seasons, so its moveToSeason omits `season`. TV tasks NEVER use this — even a
   *  single-season TV task uses targetSeasonDirectoryIds so the season stays known. */
  targetMovieDirectoryId?: string;
  /** Coverage need: the missing episode codes — which MAY span multiple seasons,
   *  e.g. ["S01E13","S04E07"] — or ["MOVIE"]. Coverage is met when every token
   *  has a markObtained-confirmed entry. Drives the §3 "no more side effects once
   *  satisfied" gate. The need is just "what's still missing"; sync computes it. */
  need?: string[];
  /** Title + aliases + original title. A search keyword that references NONE of
   *  these is rejected at the tool boundary (the agent's "2026 电影" genre/year
   *  fallback only returns noise). Empty/omitted → no title check (fail open). */
  titleTerms?: string[];
  /** Movie-only "中文字幕软兜底": when true, the search budget becomes 8+2 (a
   *  RESERVE the agent is told about), and on budget exhaustion the agent is
   *  authorized to land a raw-name match of the CORRECT film as last-resort
   *  coverage (flagged 可能无中字) rather than reportNoCoverage. TV/anime leave
   *  this false so the 中文 floor stays HARD (no 生肉 dumping). */
  subtitleFallback?: boolean;
  /** assrt subtitle provider — when present AND the run is non-CN on a 115 drive,
   *  the orchestrator pre-warms a subtitle snapshot and the agent gets
   *  viewSubtitleSnapshot / transferSubtitle tools. Undefined = no subtitle flow. */
  subtitleProvider?: AssrtProviderPort;
  /** The task's fine-grained search profile — enables the anime taboo-keyword
   *  validator (warnings only, never blocking). 病2b。 */
  searchProfile?: SearchProfile;
}

export interface SearchToolResult {
  /** Present on a fresh search and on a dedup (the prior snapshot). */
  snapshot?: ResourceSnapshotV2;
  /** True when the keyword was already searched — returned without re-hitting the provider. */
  deduped?: boolean;
  /** Set when the search budget is exhausted; the agent must decide from what it has. */
  refused?: string;
  /** Movie 8+2 reserve: set on a search performed in the reserve zone (after the
   *  normal 8) — tells the agent it is on its last searches and the subtitle
   *  fallback policy is now in play. */
  note?: string;
  /** Set when quality/subtitle tokens were stripped from the agent's keyword
   *  (C5 guardrail): tells the agent the words were dropped and raw recalls more. */
  notice?: string;
  /** Set when a deduped search is repeated: escalating warning with repeat count.
   *  病2a: 模型必须看见「这是重复」。 */
  repeatNotice?: string;
  /** Anime taboo-keyword validator warnings (year / subtype word / suspected
   *  cross-series token). Warnings only — the search still runs. 病2b。 */
  warnings?: string[];
  /** One-shot reminder that the PREVIOUS large snapshot (≥10 candidates) is
   *  still unfiltered when the agent switches keywords. 病3: 先消化再换词。 */
  digestHint?: string;
}

export interface TransferToolResult {
  attempt: TransferAttemptResult;
  /** The TRUE staging contents after a forced reread — the only evidence the
   *  agent should trust about what actually landed. */
  staging: SimTreeFile[];
  /** When the transfer failed with a SYSTEMIC message (quota / auth / VIP), the
   *  agent should STOP — every candidate will fail. Present only on a systemic
   *  block; absent means ordinary failure (iterate to the next candidate). */
  systemicBlock?: { reason: string };
}

export class TaskSandbox {
  private readonly provider: ResourceProviderV2;
  private readonly searchBudget: number;
  private readonly storage: StorageV2 | undefined;
  private readonly stagingDirectoryId: string | undefined;
  /** TV: season number -> scoped Season directory (multi-season distribution). */
  private readonly seasonDirs: Map<number, string>;
  /** A movie task's one target directory (movies have no seasons). */
  private readonly movieDir: string | undefined;
  private readonly need: readonly string[];
  private readonly titleTerms: readonly string[];
  private readonly subtitleFallback: boolean;
  /** Reserve-zone threshold (movie 8+2) — undefined disables the reserve zone. */
  private readonly softThreshold: number | undefined;
  private readonly profile: SearchProfile | undefined;
  private readonly seenKeywords = new Set<string>();
  private readonly snapshotByKeyword = new Map<string, ResourceSnapshotV2>();
  /** 每个（规范化）关键词被搜索的次数——prime 记 1，agent fresh 记 1，dedup 命中递增。 */
  private readonly searchCountByKeyword = new Map<string, number>();
  private readonly observedSnapshots = new Map<string, ResourceSnapshotV2>();
  private readonly obtainedCodes = new Set<string>();
  /** Set when the agent landed a movie via the 中文字幕 last-resort fallback (no
   *  confirmed 中字). Surfaced in finish() → notification 可能无中文字幕(兜底). */
  private subtitleFallbackUsed = false;
  /** Raw snapshot from pre-warming (system-initiated search). Stored so
   *  viewResourceSnapshot can return it multiple times without cost. */
  private rawSnapshot: ResourceSnapshotV2 | null = null;
  /** assrt provider remembered from primeSubtitleSnapshot so transferSubtitle can
   *  later call detail() without the agent re-passing it. Reassigned on prime, so
   *  NOT readonly — mirrors rawSnapshot. */
  private subtitleProvider: TaskSandboxOptions["subtitleProvider"];
  /** Pre-warmed assrt candidates (id + title + lang), like rawSnapshot for video.
   *  Reassigned by primeSubtitleSnapshot, so NOT readonly. */
  private subtitleSnapshot: AssrtCandidate[] | null = null;
  /** 病3: 待消化的上一大快照（换词搜索时提醒一次，随即清空）。 */
  private pendingDigest: { keyword: string; count: number } | null = null;
  /** 病4: 本任务的审计事件（no_coverage 上报/dedup 重复/禁忌词警告）。runner 持久化到 workflowRun.auditEvents。 */
  private readonly auditEvents: AuditEvent[] = [];

  constructor(options: TaskSandboxOptions) {
    this.provider = options.provider;
    this.subtitleFallback = options.subtitleFallback ?? false;
    // Movie 8+2: default to MOVIE_SEARCH_BUDGET (10) with a reserve at 8 when the
    // subtitle fallback is on; otherwise the normal hard-8 (no reserve zone).
    this.searchBudget =
      options.searchBudget ?? (this.subtitleFallback ? MOVIE_SEARCH_BUDGET : MAX_DISTINCT_PLANNING_SEARCHES);
    this.softThreshold = this.subtitleFallback ? MOVIE_SEARCH_SOFT_THRESHOLD : undefined;
    this.storage = options.storage;
    this.stagingDirectoryId = options.stagingDirectoryId;
    this.profile = options.searchProfile;
    this.seasonDirs = new Map(
      Object.entries(options.targetSeasonDirectoryIds ?? {}).map(([season, id]) => [Number(season), id]),
    );
    this.movieDir = options.targetMovieDirectoryId;
    this.need = options.need ?? [];
    this.titleTerms = options.titleTerms ?? [];
    this.subtitleProvider = options.subtitleProvider;
  }

  /** Every scoped target directory (all seasons + the movie) — the union used for
   *  presence checks and full-target inspection. */
  private allTargetDirIds(): string[] {
    const ids = [...this.seasonDirs.values()];
    if (this.movieDir !== undefined) ids.push(this.movieDir);
    return ids;
  }

  /** Resolve which scoped target directory a move/inspect/delete addresses. A TV
   *  task ALWAYS names the season explicitly — single-season included, so the
   *  season number stays known and a file can never land in an unknown season.
   *  Only a movie task (no seasons) resolves without a season. */
  private resolveTargetDir(season?: number): string | undefined {
    if (season !== undefined) return this.seasonDirs.get(season);
    return this.seasonDirs.size === 0 ? this.movieDir : undefined;
  }

  /** Whether every needed token has been confirmed obtained — the gate that
   *  stops the agent from acquiring past the point of coverage (莉可丽丝 scar). */
  isCoverageMet(): boolean {
    return this.need.length > 0 && this.need.every((token) => this.obtainedCodes.has(token));
  }

  private missingNeed(): string[] {
    return this.need.filter((token) => !this.obtainedCodes.has(token));
  }

  /** Search one keyword. Repeats are deduped (no extra provider hit); distinct
   *  searches are capped by the budget. Every observed snapshot is recorded so a
   *  later transferCandidate can be bound to a snapshot seen in THIS task. */
  async searchResources(keyword: string): Promise<SearchToolResult> {
    // C5 guardrail: PanSou wildcard-matches share titles, which almost never carry
    // 画质/字幕 markers — so a quality/subtitle-laden keyword collapses recall to a
    // subset or to ZERO (实测 铁拳教育 84→+1080p=0, 奥本海默 185→+中字=0). Strip those
    // tokens BEFORE the title gate so the bare title still passes, and tell the
    // agent the words were dropped (raw recalls the most). Not a hard reject — it
    // does not second-guess the agent's title choice, only removes proven-dead noise.
    const stripped = stripQualitySubtitleTokens(keyword);
    const effectiveKeyword = stripped.keyword;

    // Hard guard: a keyword that names no title term is a genre/year-only
    // fallback ("2026 电影") — it can only return noise. Reject it BEFORE the
    // budget/provider so it costs nothing and the agent must re-keyword with the
    // real title. (asEvidence turns this throw into the {error} the agent reads.)
    if (!keywordReferencesTitle(effectiveKeyword, this.titleTerms)) {
      throw new Error(
        `搜索关键词必须包含片名(片名/原名/别名)。"${keyword}" 不含片名,只会返回噪音,已拒绝。请用包含片名的关键词(裸标题召回最全;繁体/英文/原名 可作升级。注意:画质/字幕词会被自动移除,年份/季 等词虽不移除但同样会减召回,别加),不要用纯类型或纯年份(如 "电影"、"2026 电影")。`,
      );
    }
    const normalized = normalizeSearchKeyword(effectiveKeyword);
    const notice = stripped.stripped ? STRIP_NOTICE : undefined;

    // 病2b: anime taboo-keyword validator (warnings only, after title gate, before dedup).
    const tabooWarnings = this.profile
      ? animeSearchTabooWarnings({ keyword: effectiveKeyword, profile: this.profile, titleTerms: this.titleTerms })
      : [];
    if (tabooWarnings.length > 0) {
      this.auditEvents.push({
        type: "search_taboo_warning",
        message: `搜索词「${effectiveKeyword}」触发动漫禁忌词警告 ${tabooWarnings.length} 条`,
        data: { keyword: effectiveKeyword, warnings: tabooWarnings },
      });
    }

    // 病3: take the digestion hint — only when switching keywords (the current
    // normalized keyword differs from the pending one). The stored keyword is the
    // EFFECTIVE (original-case) form for display — case-consistent with
    // repeatNotice — so the comparison normalizes it first.
    const digestHint =
      this.pendingDigest && normalizeSearchKeyword(this.pendingDigest.keyword) !== normalized
        ? `提示：上一快照「${this.pendingDigest.keyword}」有 ${this.pendingDigest.count} 个候选尚未筛过——候选列表就在你此前那次 searchResources 的返回里，回读不花预算；先消化再换词通常更快。`
        : undefined;
    if (digestHint) this.pendingDigest = null;

    // Check dedup FIRST — if this keyword was already searched (either by agent
    // or by system pre-warming), return the cached snapshot without hitting the
    // provider or consuming budget. This covers both agent re-searches and agent
    // searching a keyword that was pre-warmed.
    const cachedSnapshot = this.snapshotByKeyword.get(normalized);
    if (cachedSnapshot) {
      const count = (this.searchCountByKeyword.get(normalized) ?? 1) + 1;
      this.searchCountByKeyword.set(normalized, count);
      this.auditEvents.push({
        type: "search_dedup",
        message: `重复搜索「${effectiveKeyword}」第 ${count} 次`,
        data: { keyword: effectiveKeyword, count },
      });
      return {
        snapshot: cachedSnapshot,
        deduped: true,
        repeatNotice: this.repeatNotice(effectiveKeyword, count, cachedSnapshot.candidates.length),
        ...(notice ? { notice } : {}),
        ...(tabooWarnings.length > 0 ? { warnings: tabooWarnings } : {}),
        ...(digestHint ? { digestHint } : {}),
      };
    }

    const decision = decideSearchGate({
      normalizedKeyword: normalized,
      seenKeywords: this.seenKeywords,
      maxDistinctSearches: this.searchBudget,
      ...(this.softThreshold === undefined ? {} : { softThreshold: this.softThreshold }),
    });
    if (decision === "duplicate") {
      // This branch should now be unreachable since we check snapshotByKeyword above,
      // but keep it for backward compatibility in case seenKeywords has an entry but
      // snapshotByKeyword doesn't (should never happen in practice).
      return { deduped: true, ...(notice ? { notice } : {}) };
    }
    if (decision === "exhausted") {
      return { refused: this.budgetExhaustedMessage() };
    }
    // "fresh" and "reserve" both perform the search; "reserve" (movie 8+2) attaches
    // the note that flips the agent into last-resort subtitle-fallback mode.
    this.seenKeywords.add(normalized);
    const snapshot = await this.provider.search(effectiveKeyword);
    this.snapshotByKeyword.set(normalized, snapshot);
    this.searchCountByKeyword.set(normalized, 1);
    this.observedSnapshots.set(snapshot.id, snapshot);

    // 病3: register a large fresh snapshot for later digestion hint. Store the
    // effective (original-case) keyword for display; the trigger comparison
    // normalizes it.
    if (snapshot.candidates.length >= LARGE_SNAPSHOT_DIGEST_THRESHOLD) {
      this.pendingDigest = { keyword: effectiveKeyword, count: snapshot.candidates.length };
    }

    return {
      snapshot,
      ...(decision === "reserve" ? { note: this.reserveNote() } : {}),
      ...(notice ? { notice } : {}),
      ...(tabooWarnings.length > 0 ? { warnings: tabooWarnings } : {}),
      ...(digestHint ? { digestHint } : {}),
    };
  }

  /** Budget-exhausted refusal. For a movie (subtitle fallback) it authorizes the
   *  last-resort raw landing; otherwise the original hard-stop message (the 中文
   *  floor stays hard for TV/anime). */
  private budgetExhaustedMessage(): string {
    if (this.subtitleFallback) {
      return `搜索预算已用尽(${this.searchBudget} 次)。立刻从已有证据决策:若已确认正确影片的 raw 名匹配,就兜底 transferCandidate 落它,并在 markObtained 时带 subtitleFallback(系统会标注「可能无中文字幕」);只有连正确影片的任何候选都没有时,才 reportNoCoverage。`;
    }
    return `search budget exhausted (${this.searchBudget} distinct searches); decide from the evidence already gathered`;
  }

  /** The reserve-zone note (movie 8+2) attached to searches 9–10. */
  private reserveNote(): string {
    const reserve = this.searchBudget - (this.softThreshold ?? this.searchBudget);
    return `⚠️ 中字搜索预算(${this.softThreshold})已用满,还剩 ${reserve} 次预留。用它做最后的裸名/抖动复搜;若仍找不到带中字的版本、但已确认正确影片的 raw 名匹配,就直接 transferCandidate 兜底落它(markObtained 带 subtitleFallback,系统标注「可能无中字」),不要 reportNoCoverage —— 有正片胜过没有,且该版实际未必无中字。`;
  }

  /** 病2a: dedup 强提示。第 2 次报次数；第 3-4 次升级警告；第 5 次起文本固定——
   *  固定是刻意的：递增计数会让重复步骤的 result 每次不同，反而令 repetition-stop
   *  的「4 连相同」永远不命中。 */
  private repeatNotice(keyword: string, count: number, candidateCount: number): string {
    if (count >= 5) {
      return `⚠️ 「${keyword}」已重复多次搜索，结果不会再变（共 ${candidateCount} 候选）。这已被视为无进展：立即基于已有证据决策（transferCandidate 或 reportNoCoverage）。`;
    }
    const escalation = count >= 3 ? "再重复将视为无进展。" : "";
    return `⚠️ 「${keyword}」已是第 ${count} 次搜索（结果与上次相同，共 ${candidateCount} 候选）。换实质不同的新词，或立即基于已有证据决策。${escalation}`;
  }

  /** Whether a snapshot id was actually observed in this task — the gate for
   *  snapshot-bound transfers (no acting on stale/unseen ids). */
  hasObservedSnapshot(snapshotId: string): boolean {
    return this.observedSnapshots.has(snapshotId);
  }

  /** Read-only full raw tree of THIS task's staging handle — the agent's
   *  "看现场" surface. Returns everything (no top-N slicing, §11) so the agent
   *  judges identity/dupes/extras from real files, not a summary. */
  async inspectStaging(): Promise<SimTreeFile[]> {
    if (!this.storage || !this.stagingDirectoryId) {
      throw new Error("SANDBOX: no storage/staging handle configured");
    }
    return this.storage.listTree({ directoryId: this.stagingDirectoryId });
  }

  /** Read-only list of the wrapper subdirectories currently in staging.
   *  Not on the agent toolset (the agent works from inspectStaging's flat tree
   *  and wipes leftovers with discardStaging); kept for tests / hands-on debug. */
  async inspectStagingDirs(): Promise<Array<{ id: string; path: string }>> {
    if (!this.storage || !this.stagingDirectoryId) {
      throw new Error("SANDBOX: no storage/staging handle configured");
    }
    return this.storage.listSubdirectories({ directoryId: this.stagingDirectoryId });
  }

  /** Read-only full raw tree of a scoped target directory — ground truth for what
   *  has landed. With a season, that season's dir (so the agent sees what season N
   *  already holds before deciding what to move/dedup); without one, the union of
   *  all target dirs (every season + movie) for the whole picture. */
  async inspectTargetDir(input: { season?: number } = {}): Promise<SimTreeFile[]> {
    if (!this.storage) {
      throw new Error("SANDBOX: no storage configured");
    }
    if (input.season !== undefined) {
      const dir = this.resolveTargetDir(input.season);
      if (!dir) {
        throw new Error(`SANDBOX: no target directory for season ${input.season}`);
      }
      return this.storage.listTree({ directoryId: dir });
    }
    const trees = await Promise.all(
      this.allTargetDirIds().map((directoryId) => this.storage!.listTree({ directoryId })),
    );
    return trees.flat();
  }

  /** Transfer ONE candidate into the task's staging handle, then force-reread
   *  staging and return the TRUE contents. The candidate must come from a
   *  snapshot observed in THIS task (no stale/raw ids) — the agent can never
   *  transfer-and-run; the real landing is handed back for it to judge. */
  async transferCandidate(input: { snapshotId: string; candidateId: string }): Promise<TransferToolResult> {
    if (!this.storage || !this.stagingDirectoryId) {
      throw new Error("SANDBOX: no storage/staging handle configured for transfers");
    }
    if (this.isCoverageMet()) {
      throw new Error(
        `SANDBOX_COVERAGE_ALREADY_MET: every needed item (${this.need.join(",")}) is obtained; no further transfers`,
      );
    }
    const snapshot = this.observedSnapshots.get(input.snapshotId);
    if (!snapshot) {
      throw new Error(`SANDBOX_SNAPSHOT_NOT_OBSERVED: ${input.snapshotId} was not seen in this task`);
    }
    if (!snapshot.candidates.some((candidate) => candidate.id === input.candidateId)) {
      throw new Error(`SANDBOX_CANDIDATE_NOT_IN_SNAPSHOT: ${input.candidateId} is not in ${input.snapshotId}`);
    }
    const attempt = await this.storage.transferCandidate({
      candidateId: input.candidateId,
      intoDirectoryId: this.stagingDirectoryId,
    });
    const staging = await this.storage.listTree({ directoryId: this.stagingDirectoryId });
    // A systemic block ONLY when nothing actually landed — a provider can mark an
    // attempt failed yet materialize files (e.g. quark); the truth is the landing
    // point (staging / materializedFileIds), not the status flag.
    const nothingLanded = staging.length === 0 && attempt.materializedFileIds.length === 0;
    const systemicBlock =
      attempt.status === "failed" && nothingLanded && isSystemicTransferBlockMessage(attempt.providerMessage)
        ? { reason: attempt.providerMessage!.trim() }
        : undefined;
    return { attempt, staging, ...(systemicBlock ? { systemicBlock } : {}) };
  }

  /** MOVIE-ONLY: transfer an AGENT-ORDERED list of candidates the agent judged to
   *  be the SAME target film (best → next-best by resource name), stopping at the
   *  FIRST that 秒传-lands; the rest are abandoned. The candidate SET is the agent's
   *  semantic choice (a wildcard search returns same-named DIFFERENT works — never
   *  iterate the raw result set); the system only burns through the dead links in
   *  that vetted, ordered set. FAIL-LOUD SHARE LINKS ONLY (115/夸克/天翼/123
   *  转存分享): every share-transfer brand fails loud on a dead link (链接已过期/
   *  分享已取消/分享不存在 come back at once), so iterate-on-failure is sound; a
   *  magnet's success is only knowable via the landing point, so magnets (and
   *  unknown links) are rejected — use transferCandidate + inspectStaging for
   *  those. TV/anime never gets this tool (it must not be confused with
   *  multi-resource season coverage). Refused once coverage is met.
   *  Force-rereads staging. */
  async transferUntilLanded(input: { candidateIds: string[] }): Promise<{
    landed: SimTreeFile[];
    transferredCandidateId: string | null;
    attempts: Array<{ candidateId: string; status: "succeeded" | "failed"; providerMessage?: string }>;
    systemicBlock?: { reason: string };
  }> {
    if (!this.storage || !this.stagingDirectoryId) {
      throw new Error("SANDBOX: no storage/staging handle configured for transfers");
    }
    if (this.movieDir === undefined || this.seasonDirs.size > 0) {
      throw new Error(
        "SANDBOX_TRANSFER_UNTIL_LANDED_MOVIE_ONLY: only a movie task may iterate alternative links for one film",
      );
    }
    if (this.isCoverageMet()) {
      throw new Error(
        `SANDBOX_COVERAGE_ALREADY_MET: every needed item (${this.need.join(",")}) is obtained; no further transfers`,
      );
    }
    if (input.candidateIds.length === 0) {
      throw new Error("SANDBOX_NO_CANDIDATES: transferUntilLanded needs at least one candidate");
    }
    for (const candidateId of input.candidateIds) {
      const observed = [...this.observedSnapshots.values()].some((snapshot) =>
        snapshot.candidates.some((candidate) => candidate.id === candidateId),
      );
      if (!observed) {
        throw new Error(`SANDBOX_CANDIDATE_NOT_OBSERVED: ${candidateId} was not seen in a search this task`);
      }
    }
    for (const candidateId of input.candidateIds) {
      if (this.storage.candidateLinkKind(candidateId) !== "share") {
        throw new Error(
          `SANDBOX_TRANSFER_UNTIL_LANDED_REQUIRES_SHARE_LINK: ${candidateId} is not a fail-loud share link ` +
            "(115/夸克/天翼/123 转存分享) — use transferCandidate for magnets and verify via the landing point",
        );
      }
    }
    const attempts: Array<{ candidateId: string; status: "succeeded" | "failed"; providerMessage?: string }> = [];
    let transferredCandidateId: string | null = null;
    let systemicBlock: { reason: string } | undefined;
    for (const candidateId of input.candidateIds) {
      const attempt = await this.storage.transferCandidate({
        candidateId,
        intoDirectoryId: this.stagingDirectoryId,
      });
      attempts.push({
        candidateId,
        status: attempt.status,
        ...(attempt.providerMessage ? { providerMessage: attempt.providerMessage } : {}),
      });
      if (attempt.status === "succeeded") {
        transferredCandidateId = candidateId;
        break;
      }
      // Layer-1: stop on the first failure that is a SYSTEMIC block (quota / auth /
      // VIP) — it may come after one or more dead-link failures, but once we see a
      // systemic one every remaining candidate will fail the same way, so don't
      // grind the rest of the list (the 心灵奇旅 13-transfer waste). Ordinary
      // dead-link failures (过期/取消/错链) keep iterating to the next candidate.
      // Only a block if THIS attempt landed nothing — a provider can materialize
      // files yet mark the attempt failed (e.g. quark); trust the landing point.
      if (attempt.materializedFileIds.length === 0 && isSystemicTransferBlockMessage(attempt.providerMessage)) {
        systemicBlock = { reason: attempt.providerMessage!.trim() };
        break;
      }
      // no_target_change with nothing landed: on an async-copy brand (123's
      // fire-copy + settle window) this can be a FALSE miss — the server-side copy
      // may land AFTER the window. Burning the next candidate now could double-land
      // the film once the slow copy arrives, so STOP and hand judgment back to the
      // agent (its runbook: re-read via inspectStaging BEFORE re-transferring or
      // writing the candidate off). Loud dead links (non-ntc) keep iterating —
      // their death is proven, not pending.
      if (attempt.noTargetChange === true && attempt.materializedFileIds.length === 0) {
        break;
      }
    }
    const landed = await this.storage.listTree({ directoryId: this.stagingDirectoryId });
    return { landed, transferredCandidateId, attempts, ...(systemicBlock ? { systemicBlock } : {}) };
  }

  /** Batch distribution plan (挖取/extract): the agent submits the WHOLE
   *  "files → season" mapping at once — each video's SUBTITLES ride in the same
   *  season's fileIds (§1.14). The system runs every move and force-rereads,
   *  returning EVERY touched season dir + the remaining staging so the agent
   *  verifies the whole distribution in one shot and fixes any misplacement. Only
   *  still-missing episodes are moved (already-present seasons are NOT recopied —
   *  the agent judges this). A movie move OMITS `season` (its target is the movie
   *  dir, which equals staging). Distributing in one call is more ergonomic than
   *  per-season calls, and moves are NOT 逆鳞-budget-sensitive like transfers
   *  (§2/§5). Scope guard: every fileId must currently be in THIS task's staging. */
  async moveToSeason(input: {
    moves: Array<{ season?: number; fileIds: string[] }>;
  }): Promise<{ seasons: Record<number, SimTreeFile[]>; staging: SimTreeFile[] }> {
    if (!this.storage || !this.stagingDirectoryId) {
      throw new Error("SANDBOX: no storage/staging handle configured");
    }
    // Resolve every target up front; reject an unknown/unscoped season before any move.
    const resolved = input.moves.map((move) => {
      const targetDir = this.resolveTargetDir(move.season);
      if (!targetDir) {
        throw new Error(
          move.season === undefined
            ? "SANDBOX_SEASON_REQUIRED: every TV move must name its season (single-season included — the season number must stay known)"
            : `SANDBOX_NO_SEASON_DIR: no scoped directory for season ${move.season} (out of this task's season scope)`,
        );
      }
      return { season: move.season, targetDir, fileIds: move.fileIds };
    });
    // Validate ALL fileIds against the current staging snapshot before any move.
    const stagingIds = new Set(
      (await this.storage.listTree({ directoryId: this.stagingDirectoryId })).map((file) => file.id),
    );
    const outOfScope = resolved.flatMap((move) => move.fileIds).filter((fileId) => !stagingIds.has(fileId));
    if (outOfScope.length > 0) {
      throw new Error(`SANDBOX_FILES_NOT_IN_STAGING: ${outOfScope.join(",")}`);
    }
    // Execute each move (the system does the per-file moves under the hood).
    for (const move of resolved) {
      await this.storage.moveFiles({ fileIds: move.fileIds, targetDirectoryId: move.targetDir });
    }
    // Force-reread every touched target season + staging for one-shot verification.
    const seasons: Record<number, SimTreeFile[]> = {};
    for (const move of resolved) {
      if (move.season !== undefined) {
        seasons[move.season] = await this.storage.listTree({ directoryId: move.targetDir });
      }
    }
    return { seasons, staging: await this.storage.listTree({ directoryId: this.stagingDirectoryId }) };
  }

  /** Delete agent-chosen files from a named scoped directory (the dedup
   *  keep-larger execution, or residue cleanup). Scope guard: every id must
   *  currently be in that directory — no deleting arbitrary/raw ids. Rereads. */
  async deleteFiles(input: {
    directory: "staging" | "season";
    season?: number;
    fileIds: string[];
  }): Promise<{ deleted: string[]; directory: SimTreeFile[] }> {
    if (!this.storage) {
      throw new Error("SANDBOX: no storage configured");
    }
    const directoryId =
      input.directory === "season" ? this.resolveTargetDir(input.season) : this.stagingDirectoryId;
    if (!directoryId) {
      throw new Error(`SANDBOX: no ${input.directory} handle configured`);
    }
    const present = new Set(
      (await this.storage.listTree({ directoryId })).map((file) => file.id),
    );
    const outOfScope = input.fileIds.filter((fileId) => !present.has(fileId));
    if (outOfScope.length > 0) {
      throw new Error(`SANDBOX_FILES_NOT_IN_${input.directory.toUpperCase()}: ${outOfScope.join(",")}`);
    }
    const { deleted } = await this.storage.deleteFiles({ directoryId, fileIds: input.fileIds });
    return { deleted, directory: await this.storage.listTree({ directoryId }) };
  }

  /** Record the episodes the agent declares obtained — the agent's FINAL action,
   *  pure agent judgment. The system does NOT mechanically re-read 115 to verify
   *  a backing file exists (§12, 2026-06-15): move/flatten already force-reread
   *  and handed the truth back; the mark is reversible; and §1.13 has the agent
   *  re-judge from the real files every patrol, so a stale mark self-heals next
   *  round. Correctness is the prompt ordering (clean/flatten, THEN mark last),
   *  not a system gate that costs extra 115 reads. No fileId↔episode map (§1.13):
   *  the code IS the unit; the agent names what it judged present. */
  async markObtained(input: { codes: string[]; subtitleFallback?: boolean }): Promise<{ confirmed: string[] }> {
    for (const code of input.codes) {
      this.obtainedCodes.add(code);
    }
    // Movie 中文字幕软兜底: the agent landed a raw-name match without a confirmed
    // 中文 sub track (budget exhausted). Sticky so finish() can flag 可能无中字.
    if (input.subtitleFallback) {
      this.subtitleFallbackUsed = true;
    }
    return { confirmed: input.codes };
  }

  /** TV/anime clean-up: wipe THIS task's staging dir wholesale after the agent has
   *  distributed the episodes it needs (mark already done). Leftovers (unwanted
   *  episodes / dup packs) are discarded — no classification, no foreign-work
   *  isolation (§1.6). Harnessed: the agent can ONLY delete its own staging, and
   *  NEVER when staging is also a target dir (the movie flatten-in-place case,
   *  where staging === the movie dir — refused so the film is never nuked). */
  async discardStaging(): Promise<{ removed: string[] }> {
    if (!this.storage || !this.stagingDirectoryId) {
      throw new Error("SANDBOX: no storage/staging handle configured");
    }
    if (this.allTargetDirIds().includes(this.stagingDirectoryId)) {
      throw new Error(
        "SANDBOX_STAGING_IS_TARGET: this task has no separate staging to discard (a movie flattens in place)",
      );
    }
    return this.storage.removeDirectory({ directoryId: this.stagingDirectoryId });
  }

  /** Movie-only automatic flatten: the film landed nested inside its resource
   *  wrapper under the movie dir (staging === movie dir). Move EVERY video AND
   *  subtitle file up to the movie dir root (§1.14 — subtitles ride along), then
   *  remove the now-residual wrapper subdirs (non-media like covers/nfo go with
   *  them). Fully automatic — no per-file selection (a movie is one film, take it
   *  all); the agent removes any extras (花絮) afterward with deleteFiles. */
  async flattenMovie(): Promise<{ movie: SimTreeFile[] }> {
    if (!this.storage || this.movieDir === undefined) {
      throw new Error("SANDBOX_NOT_A_MOVIE: flattenMovie is movie-only");
    }
    const root = this.movieDir;
    const nested = (await this.storage.listTree({ directoryId: root })).filter(
      (file) => (file.isVideo || file.isSubtitle) && file.path.includes("/"),
    );
    if (nested.length > 0) {
      await this.storage.moveFiles({ fileIds: nested.map((file) => file.id), targetDirectoryId: root });
    }
    for (const wrapper of await this.storage.listSubdirectories({ directoryId: root })) {
      await this.storage.removeDirectory({ directoryId: wrapper.id });
    }
    return { movie: await this.storage.listTree({ directoryId: root }) };
  }

  /** The agent declares it is done. Returns the honest coverage picture from the
   *  obtained marks — the workflow decides what to persist. */
  async finish(): Promise<{ coverageMet: boolean; obtained: string[]; missing: string[]; subtitleFallback: boolean }> {
    // Report the agent's marks beyond just need∩marked — a coherent full pack
    // often delivers episodes BEYOND the aired cursor (the need), and those
    // provider-ahead marks must survive finish() so syncSeasonNeed records them as
    // provider-ahead (frontend 超前). Filtering to `need` silently dropped them —
    // the live #4 bug (quark 超市: agent marked 12, only E01 persisted).
    // Guard: keep only an in-need token (e.g. the movie "MOVIE" sentinel) or a
    // syntactically valid episode code — a malformed agent mark must NOT flow into
    // syncSeasonNeed's episodePartsFromCode (which throws), crashing the run.
    const needSet = new Set(this.need);
    const parse = (code: string): [number, number] | null => {
      const m = /^S(\d{2,})E(\d{2,})$/.exec(code);
      return m ? [Number(m[1]), Number(m[2])] : null;
    };
    const obtained = [...this.obtainedCodes]
      .filter((code) => needSet.has(code) || parse(code) !== null)
      // Order by (season, episode) NUMERICALLY — a lexical sort misorders ≥100
      // (S01E100 < S01E99). Non-episode tokens (e.g. the movie "MOVIE") sort last.
      .sort((a, b) => {
        const pa = parse(a);
        const pb = parse(b);
        if (pa && pb) return pa[0] - pb[0] || pa[1] - pb[1];
        if (pa) return -1;
        if (pb) return 1;
        return a < b ? -1 : a > b ? 1 : 0;
      });
    return {
      coverageMet: this.isCoverageMet(),
      obtained,
      missing: this.missingNeed(),
      subtitleFallback: this.subtitleFallbackUsed,
    };
  }

  /** The agent honestly reports it cannot cover the target. This is only valid
   *  when a real provider search actually ran (§9): reporting no-coverage without
   *  ever searching is an infrastructure failure, not an honest result.
   *
   *  Evidence base = the agent's own fresh searches ∪ every keyword a snapshot
   *  was observed for — which includes the system's raw pre-warm. The prompt
   *  tells the agent NOT to re-search the raw keyword (viewResourceSnapshot is
   *  free), and even a re-search hits dedup without touching seenKeywords — so
   *  counting only seenKeywords refused a well-behaved agent's honest report on
   *  a truly-uncovered title and forced wasted turns (the 病1-style dead tail). */
  async reportNoCoverage(reason: string): Promise<{ reason: string; searchesPerformed: number }> {
    const evidenceKeywords = new Set([...this.seenKeywords, ...this.snapshotByKeyword.keys()]);
    if (evidenceKeywords.size === 0) {
      throw new Error(
        "SANDBOX_NO_PROVIDER_EVIDENCE: cannot report no-coverage before any real search ran (§9 infrastructure failure)",
      );
    }
    this.auditEvents.push({
      type: "no_coverage_reported",
      message: `agent 上报无覆盖：${reason}（已搜索 ${evidenceKeywords.size} 个词，含系统预搜）`,
      data: { reason, searchesPerformed: evidenceKeywords.size },
    });
    return { reason, searchesPerformed: evidenceKeywords.size };
  }

  auditTrail(): AuditEvent[] {
    return [...this.auditEvents];
  }

  /** Pre-warm a raw search (system-initiated, does NOT consume agent's distinct
   *  search budget). The snapshot is recorded in dedup/registry/observedSnapshots
   *  just like an agent search, so agent can later transferCandidate by id. Calling
   *  this multiple times replaces the prior raw snapshot. */
  async primeRawSnapshot(keyword: string): Promise<void> {
    const normalized = normalizeSearchKeyword(keyword);
    // Perform the search WITHOUT marking it as seen by the agent (don't add to
    // seenKeywords) — so it doesn't consume the distinct search budget.
    const snapshot = await this.provider.search(keyword);

    // Record in dedup map so agent re-searching this keyword hits dedup
    this.snapshotByKeyword.set(normalized, snapshot);
    this.searchCountByKeyword.set(normalized, 1);

    // Record in observed snapshots so transferCandidate can resolve candidate ids
    this.observedSnapshots.set(snapshot.id, snapshot);

    // Store for viewResourceSnapshot
    this.rawSnapshot = snapshot;
  }

  /** Read-only tool: view the pre-warmed raw snapshot as a structured document.
   *  Free, repeatable, does NOT consume search budget. Returns id + title for each
   *  candidate (truncated at 120 if excessive). */
  viewResourceSnapshot(): { document: string; candidateCount: number } {
    if (!this.rawSnapshot) {
      return {
        document: "No raw snapshot available. Call primeRawSnapshot first.",
        candidateCount: 0,
      };
    }

    const candidates = this.rawSnapshot.candidates;
    const total = candidates.length;
    const truncated = candidates.slice(0, 120);
    const remaining = total - truncated.length;

    let document = `📋 Raw snapshot (${total} candidates):\n\n`;

    for (const candidate of truncated) {
      document += `[${candidate.id}] ${candidate.title}\n`;
    }

    if (remaining > 0) {
      document += `\n... 还有 ${remaining} 条。如需更多,可用 searchResources 搜繁体/英文关键词。\n`;
    }

    return { document, candidateCount: total };
  }

  /** Pre-warm the assrt subtitle snapshot (system-initiated, like primeRawSnapshot).
   *  Stores candidates so viewSubtitleSnapshot can render them repeatedly for free.
   *  Soft-fails (empty snapshot) on any provider miss — never throws, so a flaky
   *  assrt / a no-result search never blocks the video task. */
  async primeSubtitleSnapshot(
    keyword: string,
    provider: AssrtProviderPort,
  ): Promise<void> {
    this.subtitleProvider = provider;
    try {
      this.subtitleSnapshot = await provider.search(keyword);
    } catch {
      this.subtitleSnapshot = [];
    }
  }

  /** Read-only view of the pre-warmed subtitle candidates as a structured doc.
   *  Free, repeatable. The agent reads this to pick which subtitle package to land. */
  viewSubtitleSnapshot(): { document: string; candidateCount: number } {
    if (!this.subtitleSnapshot || this.subtitleSnapshot.length === 0) {
      return {
        document: "No subtitle candidates were found for this title on assrt.net. Subtitles are optional — proceed with the video alone; do not block or retry on this.",
        candidateCount: 0,
      };
    }
    const candidates = this.subtitleSnapshot;
    let document = `📋 Subtitle snapshot (${candidates.length} candidates from assrt.net; ★=社区评分,组=字幕组 — 大家验证过的证据,语义权衡用):\n\n`;
    for (const candidate of candidates) {
      const lang = candidate.lang ? ` [${candidate.lang}]` : "";
      const evidence = [
        candidate.voteScore === undefined ? "" : `★${candidate.voteScore}`,
        candidate.releaseSite ? `组:${candidate.releaseSite}` : "",
        candidate.uploadTime ?? "",
      ]
        .filter(Boolean)
        .join(" · ");
      document += `[${candidate.id}] ${candidate.title}${lang}${evidence ? ` (${evidence})` : ""}\n`;
    }
    return { document, candidateCount: candidates.length };
  }

  /** Land a chosen subtitle package's files into staging via the 115 offline-task
   *  path (transferSubtitleUrl). Resolves the package's filelist via detail(),
   *  submits each file's url, returns the filenames that actually landed. The
   *  agent then renames them (moveToSeason/flattenMovie) to ride beside the video.
   *  Soft-fails: empty filelist → {status:"failed", landedFilenames:[]}. */
  async transferSubtitle(input: {
    candidateId: number;
  }): Promise<{ status: "succeeded" | "failed"; landedFilenames: string[]; error?: string }> {
    if (!this.storage || !this.stagingDirectoryId) {
      throw new Error("SANDBOX: no storage/staging handle configured for subtitle transfer");
    }
    if (!this.subtitleProvider) {
      throw new Error("SANDBOX_NO_SUBTITLE_PROVIDER: subtitle flow was not primed");
    }
    if (!this.subtitleSnapshot || !this.subtitleSnapshot.some((c) => c.id === input.candidateId)) {
      throw new Error(
        `SANDBOX_SUBTITLE_NOT_IN_SNAPSHOT: candidate ${input.candidateId} was not in the pre-warmed subtitle snapshot`,
      );
    }
    let files: AssrtSubtitleFile[];
    try {
      files = await this.subtitleProvider.detail(input.candidateId);
    } catch {
      return { status: "failed", landedFilenames: [] };
    }
    if (files.length === 0) {
      return { status: "failed", landedFilenames: [] };
    }
    // Boundary guard (same class as the rename guard): only subtitle-extension
    // files may ride the landing pipeline. assrt's detail() can return a
    // whole-package .zip fallback or stray readme/fonts entries — those would
    // land as unusable junk in staging (renameSubtitle rejects them, cleanup has
    // to sweep them) while burning real 115 API budget, and a zip-only landing
    // would report a misleading "succeeded".
    const subtitleFiles = files.filter((file) => SUBTITLE_NAME_PATTERN.test(file.filename));
    if (subtitleFiles.length === 0) {
      return {
        status: "failed",
        landedFilenames: [],
        error:
          "该字幕包没有可直接落盘的字幕文件(整包压缩包 zip/rar 落盘也无法使用)——换一个候选,或放弃字幕(软目标,不阻塞视频)。",
      };
    }
    const landedFilenames: string[] = [];
    let lastError: string | undefined;
    // Budget guard: each failed landing costs real 115 API calls (offline task +
    // materialization polls + cleanup). A dead assrt package fails file after file
    // the same way — abort after 3 CONSECUTIVE failures instead of hammering the
    // whole filelist (a success resets the counter: mixed flakiness still lands).
    const MAX_CONSECUTIVE_FAILURES = 3;
    let consecutiveFailures = 0;
    for (let i = 0; i < subtitleFiles.length; i += 1) {
      const file = subtitleFiles[i]!;
      try {
        const result = await this.storage.transferSubtitleUrl({
          url: file.url,
          filename: file.filename,
          intoDirectoryId: this.stagingDirectoryId,
        });
        if (result.status === "succeeded") {
          landedFilenames.push(file.filename);
          consecutiveFailures = 0;
        } else {
          consecutiveFailures += 1;
          if (result.providerMessage) {
            lastError = result.providerMessage;
          }
        }
      } catch (error) {
        consecutiveFailures += 1;
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        lastError = `已连续 ${MAX_CONSECUTIVE_FAILURES} 个字幕文件落盘失败,提前中止(剩余 ${subtitleFiles.length - i - 1} 个未尝试)。字幕是软目标——不要重试,带着已落的继续,或直接只交付视频。${lastError ? ` 最后错误: ${lastError}` : ""}`;
        break;
      }
    }
    if (landedFilenames.length === 0 && lastError === undefined) {
      lastError = "subtitle transfer failed (no files landed, no provider message)";
    }
    return {
      status: landedFilenames.length > 0 ? "succeeded" : "failed",
      landedFilenames,
      ...(lastError ? { error: lastError } : {}),
    };
  }

  /** Rename landed subtitle files in staging (the ONE rename exception — subtitles
   *  are renamed to match their videos so scrapers auto-load them). BATCH shape:
   *  the agent decides EVERY subtitle↔episode pairing, then submits them in ONE
   *  call — live stress-testing (Re:Zero, 77 episodes, 2026-07-02) showed that a
   *  one-file-per-call tool collapses at scale (the agent renamed 1 of 77 pairs
   *  and gave up). One staging listing serves the whole batch; guards stay
   *  per-item (source must be a subtitle in THIS staging; the new name must keep
   *  a subtitle extension and contain no path separators) and violations are
   *  collected per item instead of aborting the batch. */
  async renameSubtitle(input: {
    renames: Array<{ fileId: string; newName: string }>;
  }): Promise<{ renamed: string[]; errors?: Array<{ fileId: string; error: string }> }> {
    if (!this.storage || !this.stagingDirectoryId) {
      throw new Error("SANDBOX: no storage/staging handle configured for subtitle rename");
    }
    if (input.renames.length === 0) {
      throw new Error(
        "SANDBOX_EMPTY_RENAMES: renames must not be empty — decide every subtitle↔episode pairing first (至少一项)",
      );
    }
    const staging = await this.storage.listTree({ directoryId: this.stagingDirectoryId });
    const renamed: string[] = [];
    const errors: Array<{ fileId: string; error: string }> = [];
    for (const { fileId, newName } of input.renames) {
      try {
        const target = staging.find((file) => file.id === fileId);
        if (!target) {
          throw new Error(`SANDBOX_FILE_NOT_IN_STAGING: ${fileId} is not in this task's staging`);
        }
        if (!target.isSubtitle) {
          throw new Error(
            `SANDBOX_NOT_A_SUBTITLE: ${fileId} is not a subtitle file; only subtitles may be renamed`,
          );
        }
        if (/[\\/]/.test(newName)) {
          throw new Error(
            `SANDBOX_INVALID_SUBTITLE_NAME: newName must be a bare filename without path separators`,
          );
        }
        if (!SUBTITLE_NAME_PATTERN.test(newName)) {
          throw new Error(
            `SANDBOX_INVALID_SUBTITLE_NAME: newName must keep a subtitle extension (.srt/.ass/.ssa/.sub/.idx/.vtt/.sup/.smi)`,
          );
        }
        await this.storage.renameFile({
          directoryId: this.stagingDirectoryId,
          fileId,
          newName,
        });
        renamed.push(newName);
      } catch (error) {
        errors.push({ fileId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { renamed, ...(errors.length > 0 ? { errors } : {}) };
  }
}
