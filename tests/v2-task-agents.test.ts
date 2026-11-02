import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import {
  buildMovieSystemPrompt,
  buildTvAnimeSystemPrompt,
  needForMovie,
  needForTvTarget,
  runMovieTaskAgent,
  runTvAnimeTaskAgent,
  transferModelLine,
} from "../src/acquisition-v2/task-agents.js";
import { TaskSandbox } from "../src/acquisition-v2/sandbox.js";
import { FakeResourceProviderV2 } from "../src/acquisition-v2/fake-provider.js";
import { Storage115Simulator } from "../src/acquisition-v2/storage-115-simulator.js";

const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
} as const;

function finishImmediatelyModel() {
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      if (i++ === 0) {
        return {
          content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "reportNoCoverage", input: JSON.stringify({ reason: "test stub: nothing covers it" }) }],
          finishReason: { unified: "tool-calls" as const, raw: "tool-calls" as const },
          usage: USAGE,
          warnings: [],
        };
      }
      return { content: [{ type: "text" as const, text: "done" }], finishReason: { unified: "stop" as const, raw: "stop" as const }, usage: USAGE, warnings: [] };
    },
  });
}

async function sandboxFor(need: string[]) {
  const provider = new FakeResourceProviderV2({ results: { x: [] } });
  const storage = new Storage115Simulator({ packs: {} });
  const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
  const targetSeasonDirectoryId = await storage.createDirectory({ name: "Season 1", parentId: "root" });
  return new TaskSandbox({ provider, storage, stagingDirectoryId, targetSeasonDirectoryIds: { 1: targetSeasonDirectoryId }, need });
}

describe("need derivation", () => {
  it("movie coverage is the single MOVIE token", () => {
    expect(needForMovie()).toEqual(["MOVIE"]);
  });

  it("TV coverage is exactly the missing episode codes", () => {
    expect(needForTvTarget({ missingEpisodes: ["S01E11", "S01E12"] })).toEqual(["S01E11", "S01E12"]);
  });
});

describe("TV/anime system prompt carries the 字字泣血 invariants", () => {
  const prompt = buildTvAnimeSystemPrompt({});
  it.each([
    [/one (full-season|complete)[^.]*pack|transfer (just )?(it|one)/i, "full-season pack → one transfer"],
    [/re-?read|read back|forced reread|after (each|every) (write|transfer)/i, "force reread after writes"],
    [/keep the larger|larger file|保大|keep-larger/i, "dedup keep-larger"],
    [/flatten|wrapper (directory|dir)|peel/i, "flatten wrapper dir"],
    [/(foreign|different work)[^.]*(never|discard|wipe)|discardStaging wipes/i, "foreign work → discarded with staging, never mapped (NOT isolated for review)"],
    [/LAST (action|step)|never mark before|in place|only after/i, "mark is the LAST step, only after files are placed"],
    [/stop|no (more|further).*(transfer|side effect)|once cover/i, "stop once coverage met"],
    [/do not rename|never rename|keep.*original name/i, "no renaming"],
    [/multi-season|complete-series|distribute.*season|moveToSeason\(\{moves:/i, "multi-season pack distribution"],
    [/plan the (whole|full) distribution|lay out.*distribution plan|before.*moveToSeason.*plan/i, "plan the full distribution before the batch move"],
    [/not recopied|already has|never recopy|leave the rest/i, "already-covered seasons not recopied"],
    [/unaired.*not missing|daily patrol|leave that gap|never fabricate/i, "ongoing/unobtainable honesty"],
    [/silently fail|magnet can|trust the staging reread|秒传/i, "magnet silent-fail / trust the reread"],
    [/never transfer a random|non-covering|clean the staging mess|never be left polluted/i, "no lucky-dip transfer; clean staging"],
    [/black-box|opaque|publish time|last resort/i, "black-box last resort + publish time"],
    [/lag the disk|inspect[^.]*(first|before)[^.]*search|already in its season director[^.]*mark/i, "patrol: inspect landing point FIRST, mark what 115 already has, don't re-acquire (§6b#8)"],
  ])("mentions %s (%s)", (re) => {
    expect(prompt).toMatch(re);
  });
});

describe("both prompts carry the systemic-block STOP rule (别甩锅: account block ≠ no resource)", () => {
  it.each([
    ["tv", buildTvAnimeSystemPrompt({})],
    ["movie", buildMovieSystemPrompt({})],
  ])("%s prompt tells the agent to stop on a systemic transfer block", (_name, prompt) => {
    // names the systemic signals
    expect(prompt).toMatch(/配额|额度|VIP|登录|鉴权/);
    // tells it to STOP rather than grind every candidate
    expect(prompt).toMatch(/系统性|账号|systemic/i);
    expect(prompt).toMatch(/立即停|不要(再|继续)|别(再|继续)|STOP/i);
    // surfaced field the agent reads
    expect(prompt).toContain("systemicBlock");
  });
});

describe("transferModelLine — brand transfer model in the prompt", () => {
  it("guangya: magnet/offline model, NOT the default 115 秒传/share model", () => {
    const line = transferModelLine({ storageProvider: "guangya" });
    expect(line).toBeTruthy();
    expect(line.length).toBeGreaterThan(0);
    expect(line).toMatch(/磁力|magnet/i);
    expect(line).toMatch(/光鸭/);
    expect(line).toContain("GUANGYA_ONLY_MAGNET");
    // it is a magnet-only drive: must NOT inherit 115's 秒传 / 115/share wording
    expect(line).not.toMatch(/秒传/);
    // distinct from the quark line and from the default (115) empty line
    expect(line).not.toBe(transferModelLine({ storageProvider: "quark" }));
    expect(line).not.toBe(transferModelLine({}));
  });

  it("quark stays the 转存分享链 / 无磁力 model", () => {
    const line = transferModelLine({ storageProvider: "quark" });
    expect(line).toMatch(/夸克/);
    expect(line).toMatch(/QUARK_NO_MAGNET/);
  });

  it("tianyi: 转存分享链 / 无磁力 model (SHARE_SAVE, 秒传 equivalent), distinct from quark/guangya/default", () => {
    const line = transferModelLine({ storageProvider: "tianyi" });
    expect(line).toBeTruthy();
    expect(line.length).toBeGreaterThan(0);
    expect(line).toMatch(/天翼/);
    // a 转存分享链 drive (share-transfer, like 夸克 — NOT a magnet/offline drive)
    expect(line).toMatch(/分享链|转存分享/);
    expect(line).toContain("cloud.189.cn");
    // no magnet/offline API — a magnet fails loud with the tianyi sentinel
    expect(line).toContain("TIANYI_NO_MAGNET");
    expect(line).not.toMatch(/QUARK_NO_MAGNET|GUANGYA_ONLY_MAGNET/);
    // distinct from the quark line, the guangya line, and the default (115) empty line
    expect(line).not.toBe(transferModelLine({ storageProvider: "quark" }));
    expect(line).not.toBe(transferModelLine({ storageProvider: "guangya" }));
    expect(line).not.toBe(transferModelLine({}));
  });

  it("pan123: 转存分享链 / 无磁力 model (秒传复制, share-copy), distinct from quark/tianyi/guangya/default", () => {
    const line = transferModelLine({ storageProvider: "pan123" });
    expect(line).toBeTruthy();
    expect(line.length).toBeGreaterThan(0);
    expect(line).toMatch(/123网盘/);
    // a 转存分享链 drive (share-copy, like 夸克/天翼 — NOT a magnet/offline drive)
    expect(line).toMatch(/分享链|转存分享/);
    expect(line).toContain("123pan.com");
    expect(line).toMatch(/秒传/);
    // no magnet/offline API (v1) — a magnet fails loud with the pan123 sentinel
    expect(line).toContain("PAN123_NO_MAGNET");
    expect(line).not.toMatch(/QUARK_NO_MAGNET|GUANGYA_ONLY_MAGNET|TIANYI_NO_MAGNET/);
    // dead-share fail-loud signals the 123 executor actually surfaces
    expect(line).toMatch(/分享不存在|已取消|提取码错误|链接失效/);
    // distinct from the quark/tianyi/guangya lines and the default (115) empty line
    expect(line).not.toBe(transferModelLine({ storageProvider: "quark" }));
    expect(line).not.toBe(transferModelLine({ storageProvider: "tianyi" }));
    expect(line).not.toBe(transferModelLine({ storageProvider: "guangya" }));
    expect(line).not.toBe(transferModelLine({}));
  });

  it("115 (default) injects no extra transfer-model line", () => {
    expect(transferModelLine({})).toBe("");
    expect(transferModelLine({ storageProvider: "pan115" })).toBe("");
  });
});

describe("guangya system prompts carry the magnet transfer model", () => {
  it.each([
    ["tv", buildTvAnimeSystemPrompt({ storageProvider: "guangya" })],
    ["movie", buildMovieSystemPrompt({ storageProvider: "guangya" })],
  ])("%s prompt names the magnet/offline model and GUANGYA_ONLY_MAGNET", (_name, prompt) => {
    expect(prompt).toMatch(/磁力|magnet/i);
    expect(prompt).toContain("GUANGYA_ONLY_MAGNET");
  });
});

describe("quality guidance injection", () => {
  it("tv & movie system prompts include qualityGuidance when provided", () => {
    const g = "画质偏好:高(≈4K)。XYZ-MARKER";
    expect(buildTvAnimeSystemPrompt({ qualityGuidance: g })).toContain("XYZ-MARKER");
    expect(buildMovieSystemPrompt({ qualityGuidance: g })).toContain("XYZ-MARKER");
  });

  it("omits the quality block entirely when no qualityGuidance (不限)", () => {
    expect(buildTvAnimeSystemPrompt({})).not.toContain("画质偏好");
    expect(buildMovieSystemPrompt({})).not.toContain("画质偏好");
  });
});

describe("both prompts forcefully mandate reading the skill manual", () => {
  it.each([
    ["movie", buildMovieSystemPrompt({})],
    ["tv", buildTvAnimeSystemPrompt({})],
  ])("%s prompt: MANDATORY read of readSkill, its own section, re-read in loop, the disaster as the why", (agent, prompt) => {
    expect(prompt).toMatch(/readSkill/);
    expect(prompt).toMatch(/MANDATORY/);
    expect(prompt).toMatch(new RegExp(`"${agent}"`)); // pointed at its own playbook section, by quoted name
    expect(prompt).toMatch(/"protocol"/); // and the shared method section
    expect(prompt).toMatch(/re-?read|DURING the loop/i); // read again while working, not just at start
    expect(prompt).toMatch(/逆鳞|hammered 115|corrupted|DO NOT be that agent/); // 字字泣血 — the disaster as the why
  });

  it("the movie prompt does NOT hand the agent the tv playbook section, and vice versa", () => {
    expect(buildMovieSystemPrompt({})).not.toMatch(/"tv"/);
    expect(buildTvAnimeSystemPrompt({})).not.toMatch(/"movie"/);
  });
});

describe("Movie system prompt carries movie-specific invariants", () => {
  const prompt = buildMovieSystemPrompt({});
  it.each([
    [/remake|same work|identity|year/i, "identity / year / no remake"],
    [/single (video )?file|one file|not a pack|reject.*pack/i, "single video file"],
    [/\.iso|原盘|BDMV|disc image/i, "reject 原盘/ISO/BDMV disc images — need a playable video"],
    [/LAST (action|step)|never mark before|in place|only after/i, "mark is the LAST step, only after the film is in place"],
    [/flattenMovie/, "flattenMovie is the movie extraction"],
    [/transferUntilLanded/, "transferUntilLanded for ranked shares / dead links"],
  ])("mentions %s (%s)", (re) => {
    expect(prompt).toMatch(re);
  });

  it("does NOT hand the movie agent TV-only machinery (discardStaging / season distribution)", () => {
    // A movie has no separate staging to discard and no seasons; embedding the
    // TV loop made the agent plan discardStaging() for a film (interrogation caught it).
    expect(prompt).not.toMatch(/discardStaging/);
    expect(prompt).not.toMatch(/moveToSeason/);
  });
});

describe("中文字幕 floor: HARD for TV/anime, SOFT last-resort fallback for movie", () => {
  it("movie + 中文: soft fallback — authorizes landing a correct-film raw match when budget exhausted, flagged subtitleFallback", () => {
    const prompt = buildMovieSystemPrompt({ preferredLanguage: "中文" });
    expect(prompt).toMatch(/subtitleFallback/);
    expect(prompt).toMatch(/兜底|可能无中文字幕/);
    // still prefers 中字 first (not a lazy raw grab)
    expect(prompt).toMatch(/中文.*MUST win|search HARD|先|优先/);
  });

  it("TV/anime + 中文: floor stays HARD — no 生肉, reportNoCoverage, no fallback", () => {
    const prompt = buildTvAnimeSystemPrompt({ preferredLanguage: "中文" });
    expect(prompt).toMatch(/生肉/);
    expect(prompt).toMatch(/reportNoCoverage/);
    expect(prompt).not.toMatch(/subtitleFallback/);
  });

  it("no language preference → no language block in either prompt", () => {
    expect(buildMovieSystemPrompt({})).not.toMatch(/LANGUAGE PREFERENCE/);
    expect(buildTvAnimeSystemPrompt({})).not.toMatch(/LANGUAGE PREFERENCE/);
  });

  it("non-中文 preference (e.g. English) uses the generic line, no fallback machinery", () => {
    const prompt = buildMovieSystemPrompt({ preferredLanguage: "English" });
    expect(prompt).toMatch(/LANGUAGE PREFERENCE: the user reads English/);
    expect(prompt).not.toMatch(/subtitleFallback/);
  });
});

describe("run wiring", () => {
  it("runTvAnimeTaskAgent drives the loop with the TV need and reports honest coverage", async () => {
    const need = needForTvTarget({ missingEpisodes: ["S01E01"] });
    const sandbox = await sandboxFor(need);
    const result = await runTvAnimeTaskAgent({
      sandbox,
      model: finishImmediatelyModel(),
      target: { title: "Show", aliases: [], seasons: [1], missingEpisodes: ["S01E01"], qualityPreference: "1080p" },
    });
    expect(result.coverage.missing).toEqual(["S01E01"]);
  });

  it("runMovieTaskAgent drives the loop with the MOVIE need", async () => {
    const sandbox = await sandboxFor(needForMovie());
    const result = await runMovieTaskAgent({
      sandbox,
      model: finishImmediatelyModel(),
      target: { title: "Some Film", aliases: [], year: 2025, qualityPreference: "1080p" },
    });
    expect(result.coverage.missing).toEqual(["MOVIE"]);
  });
});
