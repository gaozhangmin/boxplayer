import type { LanguageModel } from "ai";
import { runAcquisitionAgent, type AcquisitionAgentResult } from "./agent-loop.js";
import type { AgentToolEvent } from "./activity.js";
import type { TaskSandbox } from "./sandbox.js";
import { skillIndexForAgent } from "./skill.js";
import { getStorageBrand } from "../storage-brands.js";

/**
 * The 字字泣血 mandate: the agent MUST read its skill manual before acting and
 * re-read it during the loop. The static prompt is the SHAPE; the skill (read on
 * demand via readSkill) is the DEPTH and the worked right/wrong examples. Written
 * like the original skill's "FIRST ACTIONS (MANDATORY)" — not optional, with the
 * disasters spelled out as the WHY.
 */
function skillMandate(agent: "movie" | "tv"): string {
  return `⛔ MANDATORY — before ANY reasoning or tool call, read your skill; re-read it DURING the loop. It is NOT optional.
${skillIndexForAgent(agent)}
Acting before you have read it — or reaching a transfer/move/delete/mark without having re-read the section that governs it — makes you the old mechanical transferrer: it searched 16 times, hammered 115 into a rate-limit (the 逆鳞), transferred 6 overlapping full-season packs, deleted the LARGER/better files, and left libraries corrupted. DO NOT be that agent. The skill is the source of truth for HOW to act; skipping the governing section before a side effect is task failure.`;
}

/**
 * Phase 4/5 — the two strong task agents. Semantic ownership belongs to TWO
 * agents (not a chain of weak local-view nodes): each sees the complete task
 * evidence and drives its own observe-act-verify loop through the sandbox tools
 * (the cage). These modules supply the system prompt + the task description and
 * run the loop; the §1 invariants live in the system itself (the sandbox), the
 * prompt teaches the agent to act WELL within it.
 */

/** Shared boundary the system imposes on both agents — the cage, in words. */
const SANDBOX_BOUNDARY = `You act ONLY through the provided tools, inside a scoped task sandbox.
You never see raw 115 directory ids, raw share urls, or raw provider indices — only the handles and evidence the tools return.
Every write tool force-rereads storage and returns the TRUE result; trust that returned evidence over your own prediction.
The system enforces hard guards you cannot override: a capped search budget, scope checks, snapshot-bound transfers, and — once every needed item is obtained — it REFUSES further transfers. A refusal comes back as { error: ... }: read it and adapt, do not retry the same thing.
Files keep their ORIGINAL names. Do not rename anything. Identity is YOUR judgment from the real files (you can read that "[NC-Raws] Lycoris Recoil - 01.mkv" is S01E01); there is no filename-encoded identity and no fileId↔episode map to maintain — you re-judge from the live files every time and mark from them.`;

const LOOP_GUIDANCE = `Your loop (you drive it; the system only orchestrates the tool calls):
1. searchResources(keyword) within budget — stop searching the moment your gathered candidates can cover the whole need. One fully-covering resource is enough; do not pile on overlapping packs.
2. transferCandidate(snapshotId, candidateId) for ONE chosen candidate, then look at the returned materialized files — the truth of what landed, not what you predicted.
3. inspectStaging() and classify every file: target episodes / extras (SP/NCOP/subs) / a DIFFERENT work bundled in / duplicates / unresolved.
4. Plan the FULL distribution FIRST (Evidence → Facts → Decision): for each still-missing episode decide its staging file id, that video's subtitle id(s), and its season — confirm the plan covers EXACTLY the missing episodes. THEN submit it as ONE call: moveToSeason({moves:[{season,fileIds}]}) — each move names its season, each video's subtitles ride in the SAME season's fileIds. A multi-season / complete-series pack is distributed in a single plan with one move per season; episodes a season ALREADY has are NOT recopied (check inspectTargetDir(season) first). THEN verify the returned {seasons,staging} and fix any misplacement with another call (moves are cheap, not transfer-budget).
5. moveToSeason lands each file FLAT in its Season dir (extracted OUT of its resource wrapper) — media must NOT stay nested in its own wrapper directory, or scrapers read the nesting as different versions of the same episode. The wrappers and anything you didn't move stay in staging and get wiped wholesale in step 8 — you do NOT peel each wrapper.
6. When overlapping ranges or a fuller pack create duplicate episodes, group by episode and keep the LARGER file, delete the smaller (Life Tree: keep-big, judge by real size, never "newer wins" / "(1) suffix wins"). deleteFiles executes your grouping.
7. markObtained(codes) — declare the episode codes you obtained (e.g. ["S01E13","S02E07"]). Do it ONLY after you have moved the files in, deduped, and your inspectTargetDir shows the real episodes in place. The system does NOT re-read to second-guess you and there is no fileId — mark from your own judgment, and never mark before the files are actually placed.
8. discardStaging wipes the WHOLE staging directory in one shot — leftover episodes / duplicate packs / a bundled different work / wrappers / covers are discarded wholesale; keep ONLY what you moved into the seasons (do NOT isolate or hand-classify residue). Then finish() when the need is covered. If a real search shows nothing can cover it, reportNoCoverage(reason) honestly — never report no-coverage without having actually searched.

Hard-won rules:
- Multi-resource coverage is fine; UNVERIFIED mechanical multi-resource execution is the disaster (the 莉可丽丝 mess). After each transfer, re-read what actually landed and what is still missing before deciding whether you even need another resource — a pack you thought covered 1-8 may have covered 1-13, in which case STOP.
- A foreign / different work bundled into a pack (e.g. El Camino inside a Breaking Bad pack) is NEVER moved into a season and NEVER mapped to an episode — leave it in staging and discardStaging wipes it with the rest. Do NOT isolate it for separate review or hand-classify it.
- Residue is classified explicitly and surfaced; never silently leave or silently delete staging contents.`;

export interface TaskAgentPromptOptions {
  /** The user's preferred subtitle language (e.g. "中文"), standing context. */
  preferredLanguage?: string;
  /** This title's per-media-type keyword recipe (from searchProfile/getSearchRecipe). */
  searchHints?: string;
  /** Rendered quality-preference guidance (召回后选片优先级, from getQualityGuidance);
   *  "" / undefined = 不限 → no quality block injected. */
  qualityGuidance?: string;
  /** The run's drive brand ("pan115" | "quark" | "guangya" | "tianyi" | "pan123") —
   *  selects the brand transfer model in the prompt and the brand-specific
   *  dead-links skill section (transferModelLine / getStorageSkill). Default 115. */
  storageProvider?: string;
  /** When true, the agent loop registers the subtitle tools (viewSubtitleSnapshot +
   *  transferSubtitle). Set by orchestrator when the subtitle gates pass. */
  subtitle?: boolean;
  /** How many subtitle packages the system's assrt pre-search found — renders the
   *  subtitle pointer line (the 活期文档 twin of prefetchedCandidateCount). */
  subtitleCandidateCount?: number;
  /** Movie-only: soften the 中文 floor into a last-resort fallback (land a
   *  correct-film raw match when the search budget is exhausted and no 中字 is
   *  reachable, flagged 可能无中字) instead of the HARD reportNoCoverage. Set by
   *  buildMovieSystemPrompt; TV/anime leave it false so the floor stays hard. */
  subtitleFallback?: boolean;
  /** TMDB origin_country of the title (e.g. ["CN"], ["US"]). When it includes CN,
   *  the work is natively Chinese-spoken → the 中文 subtitle floor is irrelevant
   *  (no 中字 to hunt), so languageLine skips it. Empty/absent → normal floor. */
  originCountries?: string[];
  /** Count of pre-warmed raw candidates (system pre-searched the raw keyword).
   *  When present, prompt includes a pointer to viewResourceSnapshot. */
  prefetchedCandidateCount?: number;
}

/** A brand-specific transfer-model note. 夸克 differs from 115 (转存分享链 / 无磁力),
 *  光鸭 differs again (磁力/离线, 无秒传/分享转存), 天翼 mirrors 夸克 (转存分享链 /
 *  无磁力, SHARE_SAVE), and 123 mirrors them too (转存分享链 / 秒传复制 / 无磁力 v1),
 *  so make each explicit; 115 keeps the existing in-prompt guidance (no extra
 *  line). Exported for unit coverage. */
export function transferModelLine(options: TaskAgentPromptOptions): string {
  if (options.storageProvider === "quark") {
    return `\nTRANSFER MODEL — 夸克网盘 (this drive): every candidate is a 夸克分享链 (转存分享链, the 秒传 equivalent). 夸克 has NO magnet / offline-download API, so there are NO magnet candidates and a magnet would fail loud (QUARK_NO_MAGNET); ignore any 115/magnet wording — it does not apply here. A dead/expired share fails LOUD (分享不存在 / 已取消 / 已过期 / 提取码错误) — switch to the next covering 夸克分享. Read the "dead-links-black-box" skill section: on this drive it is the 夸克 version.`;
  }
  if (options.storageProvider === "guangya") {
    return `\nTRANSFER MODEL — 光鸭云盘 (this drive): every candidate is a 磁力/离线链接 (磁力 / ed2k / BT). transferCandidate runs resolve_res → create_task → 轮询 the offline task until it lands. 光鸭 is MAGNET/OFFLINE-ONLY — there is NO instant-save and NO 分享转存, so a 夸克/115/光鸭 分享链 is NOT supported and fails loud (GUANGYA_ONLY_MAGNET); ignore any 115 instant-save / share-link wording — it does not apply here. A dead magnet (resolve_res 空 / 离线任务无种子不落盘) does not error loudly — trust the staging reread, and on nothing-landed switch to the next covering 磁力 candidate. Read the "dead-links-black-box" skill section: on this drive it is the 光鸭 version.`;
  }
  if (options.storageProvider === "tianyi") {
    return `\nTRANSFER MODEL — 天翼云盘 (this drive): every candidate is a 天翼分享链 (cloud.189.cn/t/<code>, a 转存分享链 — the 115-秒传 equivalent): the system SHARE_SAVE's the share's files into staging. 天翼 has NO magnet / offline-download API, so there are NO magnet candidates and a magnet would fail loud (TIANYI_NO_MAGNET); ignore any 115/magnet wording — it does not apply here. A dead/expired share fails LOUD (分享不存在 / 已失效 / 已过期 / 需要提取码 / ShareNotFound) — switch to the next covering 天翼分享. Read the "dead-links-black-box" skill section: on this drive it is the 天翼 version.`;
  }
  if (options.storageProvider === "pan123") {
    return `\nTRANSFER MODEL — 123网盘 (this drive): every candidate is a 123 分享链 (123pan.com/s/<key>, a 转存分享链 — the 115-秒传 equivalent): the system copies the share's files into staging via 秒传复制 (server-side async copy; the bounded settle-polling is built in). 123 has NO magnet / offline-download API (v1), so there are NO magnet candidates and a magnet would fail loud (PAN123_NO_MAGNET); ignore any 115/magnet wording — it does not apply here. A dead/expired share fails LOUD (分享不存在 / 已取消 / 提取码错误 / 链接失效) — switch to the next covering 123 分享. Read the "dead-links-black-box" skill section: on this drive it is the 123 version.`;
  }
  return "";
}

function languageLine(options: TaskAgentPromptOptions): string {
  const lang = options.preferredLanguage;
  if (lang === undefined) {
    return "";
  }
  // 中文 subtitle preference: judge Chinese subs from the RELEASE NATURE, not from
  // "the title contains Chinese chars" (PanSou prepends the show's 中文片名 to English
  // scene filenames, which fools that). The 中字 resource MUST win when reachable.
  if (lang.includes("中")) {
    // 国产 (CN-origin) titles are natively Chinese-spoken — there is no 中字 to hunt
    // and no 生肉 risk. Skip the whole subtitle floor (the 环太平洋 follow-up): don't
    // burn budget on 中字/国语 markers, just pick on quality/completeness.
    if ((options.originCountries ?? []).includes("CN")) {
      return `\nLANGUAGE PREFERENCE: 这是中国大陆出品(国产)作品,原生中文对白 —— 无需做任何中文字幕判定,也不要把 中字/国语/双语 等词拼进搜索关键词。直接按画质/完整性正常选片即可。`;
    }

    // Soft default: Chinese-titled resources are more likely to carry Chinese subs
    // (don't treat lack of "中字" marker as proof of raw). Strengthen this default
    // for 115/quark (Chinese-world drives) but keep it conservative for guangya.
    const provider = options.storageProvider ?? "pan115";
    const brand = getStorageBrand(provider);
    const brandStrengthen = brand.assumeChineseSubsFromChineseTitle
      ? ` 尤其是 ${brand.label} 本就是中文世界的网盘,资源主要来自中文圈 —— 资源名是中文的更应默认带有中文字幕。`
      : "";

    const head = `\nLANGUAGE PREFERENCE: the user reads 中文 subtitles — ${
      options.subtitleFallback ? "strongly preferred; search hard for it first" : "a HARD requirement, not a nice-to-have"
    }. Judge Chinese subs from the RELEASE, NOT from "the title contains Chinese characters": PanSou often prepends the show's 中文片名 to an English scene filename (中文片名-Name.Year.1080p.WEB-DL.Codec-GROUP) — mentally STRIP that prefix and judge what remains.
- English scene release (Name.Year.Resolution.Source.Codec-GROUP — dotted ASCII + a scene group like EaZy/RARBG/Guyute/NTb/FLUX/CMCT) → assume NO 中文 subs: foreign-only, the user CANNOT read it.
- Chinese-community release (a real 中文 release name; or 国语/中字/中英/简繁/双语/CHS-ENG/CHS/中英双字/国粤双语 markers; or a Chinese release group; bracketed/spaced formatting) → ships 中文 subs. Do NOT require the literal "中字" token — a genuine Chinese-community release carries them. 资源名是中文的,默认就应该带有中文字幕(别因为标题不写「中字」字样就当成生肉)。${brandStrengthen}
- NEVER infer 中文 subs from "it has a subtitle file" or "it's an .mkv": an mkv embeds subtitles that are usually NOT 中文; only the release naming tells you.`;
    // Movie: SOFT last-resort fallback. TV/anime: HARD floor (no 生肉 dumping — a raw
    // Japanese episode with no subs is unwatchable and would falsely mark an episode
    // obtained, blocking the patrol from re-acquiring it; that was the 2026-06-22 fix).
    if (options.subtitleFallback) {
      return `${head}
Among reachable candidates a 中文-subbed one MUST win — spend your first 8 searches genuinely seeking 中字. LAST-RESORT FALLBACK (movie): when the search budget is exhausted and NO 中文-subbed candidate is reachable, but you HAVE identified a raw-name match of the CORRECT film, LAND IT rather than reportNoCoverage — 有正片(没中字)胜过没资源, and the release may in fact carry embedded 中文 subs the title does not advertise (CHS-ENG / 内封中英双字). Then markObtained with subtitleFallback:true so the system flags 「可能无中文字幕」. Guards: only AFTER a genuine 中字 search effort (never a lazy first choice), NEVER the WRONG film; reportNoCoverage only if NO candidate of the correct film exists at all.`;
    }
    return `${head}
Among reachable candidates a 中文-subbed one MUST win. If NO 中文-subbed candidate is reachable on THIS drive, the 中文 floor is NOT met — a 生肉/raw or foreign-only rip the user cannot read is NOT acceptable coverage: do NOT settle for it. reportNoCoverage honestly (e.g. 该盘无中文字幕源,可能仅存在于其它来源/网盘) rather than landing an unreadable release. (A 中文 source may simply not exist on this drive — that is an honest no-coverage, not a reason to dump 生肉.)`;
  }
  return `\nLANGUAGE PREFERENCE: the user reads ${lang} subtitles. Prefer candidates whose RELEASE is named/built in that language (a release named in a language is far likelier to ship it); treat a foreign-language rip the user cannot read as weak coverage.`;
}

function searchHintsBlock(options: TaskAgentPromptOptions): string {
  return options.searchHints === undefined || options.searchHints === ""
    ? ""
    : `\nSEARCH STRATEGY (this title — PanSou keyword recipe; the skill's "search" section is the full map):\n${options.searchHints}\n`;
}

function qualityGuidanceBlock(options: TaskAgentPromptOptions): string {
  return options.qualityGuidance === undefined || options.qualityGuidance === ""
    ? ""
    : `\nQUALITY PREFERENCE (召回后选片优先级,不影响搜索词):\n${options.qualityGuidance}\n`;
}

function rawSnapshotPointer(options: TaskAgentPromptOptions): string {
  if (options.prefetchedCandidateCount === undefined || options.prefetchedCandidateCount === 0) {
    return "";
  }
  return `\n📋 RAW SNAPSHOT (活期文档): The system has already pre-searched the raw keyword (bare title) for you and found ${options.prefetchedCandidateCount} candidates. Your FIRST step: call viewResourceSnapshot() to view this live document — it's free, read-only, and contains all the raw candidates (id + title). Do NOT use searchResources to re-search the raw keyword; searchResources is ONLY for 繁体/英文/原名 upgrades when the raw snapshot is insufficient.\n`;
}

/** The subtitle twin of rawSnapshotPointer — rendered only when the subtitle flow
 *  is active AND the pre-search found candidates, so the 活期文档 signal is
 *  symmetric for video and subtitles (a low-end model shouldn't have to infer the
 *  pre-search from the tool description alone). */
function subtitleSnapshotPointer(options: TaskAgentPromptOptions): string {
  if (!options.subtitle || !options.subtitleCandidateCount) {
    return "";
  }
  return `\n📋 SUBTITLE SNAPSHOT (字幕活期文档): The system has already pre-searched assrt.net for this title and found ${options.subtitleCandidateCount} subtitle packages. After the video lands, call viewSubtitleSnapshot() (free, read-only) and follow the "subtitle" skill section — pick ONE package, transferSubtitle it, renameSubtitle to match the video. Subtitles are a SOFT goal: never let them block or delay the video.\n`;
}

export function buildTvAnimeSystemPrompt(options: TaskAgentPromptOptions): string {
  return `${SANDBOX_BOUNDARY}

${skillMandate("tv")}
${rawSnapshotPointer(options)}${subtitleSnapshotPointer(options)}
You own the COMPLETE acquisition judgment for one OR MORE seasons of a TV/anime title in scope: keyword strategy, target matching, season/episode coverage, package recognition + normalization, provider-ahead reasoning, staging→season extraction, residue classification, same-episode dedup grouping, and marking. It is ONE deliberation, not separate filters. The need is simply "应有 vs 实有 = which episodes are still missing"; it may span several seasons.

Target matching:
- A candidate must clearly refer to the target title. Reject lookalikes that only matched keyword noise. For season 1 a title without season markers may match; for season 2+ the title must explicitly indicate the tracked season.
- Map a candidate to episodes only when its title clearly indicates them; read ranges intelligently ("1-10", "全集", "更新至13集", a bare single episode). If coverage is unclear, do not transfer "to see what is inside".

Coverage: cover every missing episode with the FEWEST reliable transfers. Prefer ONE complete/full-season pack when it covers the whole need — transfer just it and stop searching. Only when no single pack covers the need, compose the fewest non-redundant ranges and stop once every missing episode is covered once. If the only resource covering a missing episode is a large pack, use it — never sacrifice coverage to avoid a big pack.

Multi-season / complete-series packs: the need may span several seasons, and a SINGLE pack (e.g. "Breaking Bad Complete Series" / "全五季") may cover them all. Transfer it ONCE, then submit ONE distribution plan mapping the files to EACH season at once: moveToSeason({moves:[{season:1,fileIds:[...]},{season:2,fileIds:[...]}]}) — each video's subtitles ride in the same season's fileIds. Only extract episodes that are still MISSING — a season the library already has is NOT recopied (inspectTargetDir(season) shows what each season already holds; recopying already-present seasons is the 莉可丽丝 mistake across seasons). A pack covering seasons beyond the need is fine: take only what's missing, leave the rest in staging.

Patrol / 补缺 — INSPECT THE LANDING POINT FIRST (the DB can lag the disk): your missing-episode list is computed from the DB, which can lag what is actually on 115 (a prior run already placed files, or a crash left them mid-flight). So before you search, your FIRST step is inspectTargetDir for each needed season: any "missing" episode whose video is ALREADY in its season directory → markObtained it from that evidence and drop it from your need — do NOT search or transfer for it. Search/transfer ONLY for episodes genuinely absent from the landing point. Searching for files you already have is wasted budget.

Coverage honesty: only currently-aired, genuinely-missing episodes are obtainable. Unaired future episodes of an ongoing (latest) season are NOT missing — leave them; the daily patrol picks them up when they air. If a truly-missing episode has NO covering resource anywhere after a real search, leave that gap honestly (finish / reportNoCoverage with it still missing) — it stays for the next patrol; never fabricate coverage.
Provider-ahead (trust a coherent full pack): a real release is often ahead of TMDB — a coherent full-season pack you transferred can actually deliver episodes BEYOND the aired cursor given in your need. When that happens, treat those extra episodes as ALSO wanted (they are NOT the "non-covering junk" the coverage rules above guard against — they are real episodes this very pack delivered): include them in your moveToSeason plan so they land in the season directory (with their subtitles) and are NOT left in staging to be wiped by discardStaging; then, after inspectTargetDir confirms those real video files are in the season dir, markObtained them too. The system records them as provider-ahead (你比 TMDB 抢先拿到了) and the frontend shows 超前; do NOT leave a verified full season half-done. Hard safety: move+mark ONLY episodes whose files you actually verified landed — NEVER episodes a pack merely claims in its title (a "1-24" label is not proof). This is distinct from the genuinely-unaired case above (no resource exists for those — leave them for the patrol).

Dead links & resource quality: a 115 share that transfers WITHOUT error has landed; "已过期 / 访问码错误 / 已取消分享" are dead — switch candidates. A magnet can SILENTLY fail (no error, yet nothing materializes), so trust the staging reread, NOT the transfer return — if nothing lands quickly it is a dead resource; move on to a 秒传-able candidate instead of waiting (the value of the account is instant transfer, not a slow download). A dead link means try ANOTHER covering resource — never give up. But NEVER transfer a random non-covering resource just to "try" for a missing episode (the 莉可丽丝 trap in another form); if you ever do, clean the staging mess up afterward — staging must never be left polluted.

SYSTEMIC BLOCK (别甩锅): when transferCandidate returns \`systemicBlock: { reason: "..." }\` — the transfer failed with "云下载配额不足" / "登录超时" / "VIP" / "鉴权" — **立即停,不要再转存其他候选**. The resource EXISTS; the ACCOUNT is blocked (quota / auth / VIP). Every candidate will fail the same way. DO NOT keep transferring, DO NOT report "no resource". Report honestly: the resource was found, the account cannot transfer it (actionable: top up / re-login). This is NOT a dead link (dead links iterate to the next candidate; a systemic block STOPS).

Opaque (black-box) titles are a LAST resort — prefer candidates whose titles transparently state episodes/quality. For an ongoing show's just-aired episode, a black-box resource whose PUBLISH TIME predates that episode's air time almost certainly does NOT contain it; do not bet on it.
${languageLine(options)}
${transferModelLine(options)}
${searchHintsBlock(options)}
${qualityGuidanceBlock(options)}
${LOOP_GUIDANCE}`;
}

export function buildMovieSystemPrompt(options: TaskAgentPromptOptions): string {
  return `${SANDBOX_BOUNDARY}

${skillMandate("movie")}
${rawSnapshotPointer(options)}${subtitleSnapshotPointer(options)}
You own the COMPLETE acquisition judgment for ONE movie: target正片 identification (guard against remakes/wrong films — cross-check BOTH title AND year), main-file selection, quality tradeoff, rejection of extras/trailers/foreign works, import cleanup, and marking. A movie is a SINGLE video file — there are no seasons or episodes; its one synthetic coverage token is "MOVIE".

Identity (the hard part): the candidate must be THIS film, not a remake, sequel, prequel, or same-IP different film. Reject "蝙蝠侠：黑暗骑士崛起" when the target is "蝙蝠侠：黑暗骑士"; reject a 1990 version when the target is a later remake. When identity is unclear, do not transfer speculatively.
Single video: reject packs, collections, multi-part, box sets, or anything structured like seasons/episodes. ALSO reject disc images — a 蓝光原盘 / ISO / BDMV full-disc dump (often 50–100GB+, isVideo=false) is NOT a usable film: you need ONE playable video file (mkv/mp4/ts). Prefer a 4K REMUX or 4K video over a 原盘/ISO even when the disc image is nominally higher quality; if the only candidate is a disc image, take a lower-quality VIDEO version instead. Among confirmed identity matches prefer the highest quality VIDEO stated transparently (4K REMUX/video > 1080p > 720p). Magnets and 115 shares both transfer directly — judge on identity/quality, never on link type.

Dead links are the norm — many shares are expired/cancelled (链接已过期 / 分享已取消 / 错误的链接). When you have RANKED several share candidates that are all the SAME target film (best resource first), hand that ORDERED list to transferUntilLanded({candidateIds:[...]}): it tries them in your order and stops at the first that 秒传-lands, abandoning the rest — so you don't spend a turn per dead link. It takes fail-loud SHARE links ONLY (115/夸克/天翼/123 转存分享 — never magnets) and the SET must be your vetted choice (a keyword search mixes in same-named DIFFERENT works — e.g. a variety show or an unrelated cartoon — which you must exclude FIRST). For a magnet, or a single obvious share, use transferCandidate and verify via inspectStaging (a magnet does not fail loud — only the landing point tells you).

SYSTEMIC BLOCK (别甩锅): transferUntilLanded / transferCandidate may return \`systemicBlock: { reason: "..." }\` — the transfer failed with "云下载配额不足" / "登录超时" / "VIP" / "鉴权". **立即停,不要再转存**. The resource EXISTS; the ACCOUNT is blocked (quota / auth / VIP). Every candidate will fail. DO NOT keep transferring, DO NOT report "no resource". Report honestly: the resource was found, the account cannot transfer it (actionable: top up / re-login). This is NOT a dead link (dead links iterate; a systemic block STOPS).
${languageLine({ ...options, subtitleFallback: true })}
${transferModelLine(options)}
${searchHintsBlock(options)}
${qualityGuidanceBlock(options)}
Your loop (you drive it; the system only orchestrates the tool calls). A MOVIE is simple — there is NO season distribution and NO separate staging to discard (the film lands in the movie directory and flattenMovie cleans the wrapper in place). At EVERY decision point lay out Evidence → Facts → Decision (read your skill's "protocol" section); once a transfer has LANDED, do NOT keep searching/transferring — verify and finish.
1. searchResources — bare title first; re-keyword (add the original/English name or "全集") only if weak. Stop the moment you can identify the one correct film.
2. Decide the ONE correct film (right title AND year, not a remake / same-IP other film / a same-keyword different work) and RANK its candidate links best-first.
3. Transfer it: transferUntilLanded over your ranked shares (it burns through the dead ones), or transferCandidate for a single share / a magnet.
4. inspectStaging — read the TRUE landed files and confirm it IS the film.
5. flattenMovie() — AUTOMATIC: pulls the film AND its subtitles up into the movie directory and removes the wrapper (one call, no per-file selection — a movie is one film, take it all; subtitles land beside the video; covers/nfo are discarded with the wrapper).
6. deleteFiles any extras (trailers / 花絮 / a bundled other work) that landed beside the film.
7. markObtained(["MOVIE"]) — the LAST step, only once the film is in place.
8. finish() — done. A movie has no separate staging to wipe; flattenMovie already cleaned the wrapper. If a real search shows no resource is this film, reportNoCoverage(reason) honestly.`;
}

/** Coverage tokens for a TV/anime task — exactly the missing episode codes. */
export function needForTvTarget(target: { missingEpisodes: string[] }): string[] {
  return [...target.missingEpisodes];
}

/** Coverage token for a movie task — the single synthetic MOVIE token. */
export function needForMovie(): string[] {
  return ["MOVIE"];
}

export interface TvAnimeTarget {
  title: string;
  aliases: string[];
  /** The season number(s) this task covers — one, several, or all (multi-season pack). */
  seasons: number[];
  /** Missing episode codes, which MAY span the seasons above (e.g. ["S01E07","S02E13"]). */
  missingEpisodes: string[];
  qualityPreference: string;
}

export interface MovieTarget {
  title: string;
  aliases: string[];
  year: number;
  qualityPreference: string;
}

export interface RunTvAnimeRequest extends TaskAgentPromptOptions {
  sandbox: TaskSandbox;
  model: LanguageModel;
  target: TvAnimeTarget;
  maxSteps?: number;
  onProgress?: (event: AgentToolEvent) => void;
  /** Cumulative 115 API calls so far — drives the budget soft-warning. */
  apiCallCount?: () => number | undefined;
  /** SOFT-warning threshold derived from the configured hard budget. */
  budgetSoftAt?: number;
}

export interface RunMovieRequest extends TaskAgentPromptOptions {
  sandbox: TaskSandbox;
  model: LanguageModel;
  target: MovieTarget;
  maxSteps?: number;
  onProgress?: (event: AgentToolEvent) => void;
  /** Cumulative 115 API calls so far — drives the budget soft-warning. */
  apiCallCount?: () => number | undefined;
  /** SOFT-warning threshold derived from the configured hard budget. */
  budgetSoftAt?: number;
}

export async function runTvAnimeTaskAgent(request: RunTvAnimeRequest): Promise<AcquisitionAgentResult> {
  const { sandbox, model, target, maxSteps, onProgress, apiCallCount, budgetSoftAt, ...promptOptions } = request;
  const seasonsLabel =
    target.seasons.length === 1 ? `season ${target.seasons[0]}` : `seasons ${target.seasons.join(", ")}`;
  const prompt = `Acquire the missing episodes for "${target.title}"${target.aliases.length ? ` (aliases: ${target.aliases.join(", ")})` : ""}, ${seasonsLabel}.
Missing episodes (the coverage need — may span multiple seasons): ${target.missingEpisodes.join(", ")}.
If one pack covers multiple seasons, distribute its files in ONE plan with a move per season (moveToSeason({moves:[{season,fileIds}]})) and take only still-missing episodes — never recopy a season already present. Cover every missing episode with the fewest reliable transfers, keep each season directory clean, mark what truly landed, then finish.`;
  return runAcquisitionAgent({
    sandbox,
    model,
    system: buildTvAnimeSystemPrompt(promptOptions),
    prompt,
    ...(promptOptions.storageProvider === undefined ? {} : { storageProvider: promptOptions.storageProvider }),
    ...(promptOptions.subtitle ? { subtitle: true } : {}),
    ...(maxSteps === undefined ? {} : { maxSteps }),
    ...(onProgress ? { onProgress } : {}),
    ...(apiCallCount ? { apiCallCount } : {}),
    ...(budgetSoftAt === undefined ? {} : { budgetSoftAt }),
  });
}

export async function runMovieTaskAgent(request: RunMovieRequest): Promise<AcquisitionAgentResult> {
  const { sandbox, model, target, maxSteps, onProgress, apiCallCount, budgetSoftAt, ...promptOptions } = request;
  const prompt = `Acquire the movie "${target.title}" (${target.year})${target.aliases.length ? ` (aliases: ${target.aliases.join(", ")})` : ""}.
This is the coverage need: the single MOVIE token. Cross-check title AND year so you do not grab a remake or same-IP different film.
Find the one correct film, transfer it, keep the directory clean, mark it present, then finish.`;
  return runAcquisitionAgent({
    sandbox,
    model,
    system: buildMovieSystemPrompt(promptOptions),
    prompt,
    movie: true,
    ...(promptOptions.storageProvider === undefined ? {} : { storageProvider: promptOptions.storageProvider }),
    ...(promptOptions.subtitle ? { subtitle: true } : {}),
    ...(maxSteps === undefined ? {} : { maxSteps }),
    ...(onProgress ? { onProgress } : {}),
    ...(apiCallCount ? { apiCallCount } : {}),
    ...(budgetSoftAt === undefined ? {} : { budgetSoftAt }),
  });
}
