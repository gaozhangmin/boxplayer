import { describe, expect, it } from "vitest";
import { TaskSandbox } from "../src/acquisition-v2/sandbox.js";
import { FakeResourceProviderV2 } from "../src/acquisition-v2/fake-provider.js";
import { Storage115Simulator } from "../src/acquisition-v2/storage-115-simulator.js";
import { buildTvAnimeSystemPrompt, buildMovieSystemPrompt } from "../src/acquisition-v2/task-agents.js";

async function createTestSandbox(candidateTitles: string[], keyword = "铁拳教育") {
  const provider = new FakeResourceProviderV2({
    results: {
      [keyword]: candidateTitles.map((title, idx) => ({
        id: `c${idx}`,
        title,
      })),
    },
  });
  const storage = new Storage115Simulator({ packs: {} });
  const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
  const targetSeasonDirectoryId = await storage.createDirectory({ name: "Season 1", parentId: "root" });
  return new TaskSandbox({
    provider,
    storage,
    stagingDirectoryId,
    targetSeasonDirectoryIds: { 1: targetSeasonDirectoryId },
    need: ["S01E01"],
  });
}

describe("raw snapshot pre-warming", () => {
  it("primeRawSnapshot pre-warms a raw search and makes it available via viewResourceSnapshot", async () => {
    const sandbox = await createTestSandbox(["铁拳教育 S01", "铁拳教育 全集", "铁拳教育 1080p"]);

    // 预热:系统发起的 raw 搜索
    await sandbox.primeRawSnapshot("铁拳教育");

    // viewResourceSnapshot 返回预搜候选的结构化文档
    const snapshot = sandbox.viewResourceSnapshot();

    expect(snapshot.document).toBeTruthy();
    expect(snapshot.document).toContain("c0"); // 含 id
    expect(snapshot.document).toContain("铁拳教育 S01"); // 含 title
    expect(snapshot.candidateCount).toBe(3);
  });

  it("pre-warmed search does NOT consume the agent's distinct search budget", async () => {
    const sandbox = await createTestSandbox(["Resource A", "Resource B"]);

    await sandbox.primeRawSnapshot("test-title");

    // The agent still has the FULL budget of 8 distinct searches: 8 fresh keywords
    // all run (none refused), and only the 9th distinct agent search is refused —
    // proving the system pre-warm took none of the agent's slots.
    for (let i = 0; i < 8; i++) {
      const r = await sandbox.searchResources(`agent-kw-${i}`);
      expect(r.refused, `agent search #${i + 1} should run`).toBeUndefined();
    }
    const ninth = await sandbox.searchResources("agent-kw-8");
    expect(ninth.refused).toBeTruthy();
    expect(ninth.snapshot).toBeUndefined();
  });

  it("agent re-searching the same raw keyword hits dedup and does NOT re-hit the provider", async () => {
    let searchCount = 0;
    const provider = new FakeResourceProviderV2({
      results: { raw: [{ id: "c1", title: "Title" }] },
      onSearch: () => { searchCount++; },
    });
    const storage = new Storage115Simulator({ packs: {} });
    const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
    const sandbox = new TaskSandbox({
      provider,
      storage,
      stagingDirectoryId,
      targetSeasonDirectoryIds: { 1: await storage.createDirectory({ name: "Season 1", parentId: "root" }) },
      need: ["S01E01"],
    });

    // 预热搜索 raw
    await sandbox.primeRawSnapshot("raw");
    expect(searchCount).toBe(1);

    // agent 再搜同一 raw 词 → 命中 dedup,不重打 provider
    const result = await sandbox.searchResources("raw");
    expect(result.deduped).toBe(true);
    expect(searchCount).toBe(1); // 仍然是 1,未增加
  });

  it("viewResourceSnapshot can be called multiple times without consuming budget", async () => {
    const sandbox = await createTestSandbox(["A", "B", "C"], "title");
    await sandbox.primeRawSnapshot("title");

    const snap1 = sandbox.viewResourceSnapshot();
    const snap2 = sandbox.viewResourceSnapshot();

    expect(snap1.candidateCount).toBe(3);
    expect(snap2.candidateCount).toBe(3);
    // 不抛错,不耗预算
  });

  it("viewResourceSnapshot truncates at 120 candidates and notes remaining count", async () => {
    const manyCandidates = Array.from({ length: 150 }, (_, i) => `Candidate ${i + 1}`);
    const sandbox = await createTestSandbox(manyCandidates, "title");
    await sandbox.primeRawSnapshot("title");

    const snap = sandbox.viewResourceSnapshot();

    expect(snap.candidateCount).toBe(150);
    // 文档应截断并提示
    expect(snap.document).toMatch(/还有.*条|还有 30 条|截断|更多/);
    // 实际文档中的候选数应 <= 120
    const lines = snap.document.split("\n").filter(line => line.match(/\[c\d+\]/));
    expect(lines.length).toBeLessThanOrEqual(120);
  });
});

describe("system prompt carries raw snapshot pointer", () => {
  it("TV prompt includes prefetched candidate count and pointer when provided", () => {
    const prompt = buildTvAnimeSystemPrompt({ prefetchedCandidateCount: 84 });

    expect(prompt).toContain("84");
    expect(prompt).toMatch(/预搜|pre.*search|already.*search/i);
    expect(prompt).toContain("viewResourceSnapshot");
  });

  it("movie prompt includes prefetched candidate count and pointer when provided", () => {
    const prompt = buildMovieSystemPrompt({ prefetchedCandidateCount: 185 });

    expect(prompt).toContain("185");
    expect(prompt).toMatch(/预搜|pre.*search|already.*search/i);
    expect(prompt).toContain("viewResourceSnapshot");
  });

  it("prompt does NOT embed the full candidate list (only a pointer + count)", () => {
    // 即使有 150 个候选,prompt 里不应该有全量标题列表
    const prompt = buildTvAnimeSystemPrompt({ prefetchedCandidateCount: 150 });

    // 应该只有计数,不应该有类似 "[c0] Title A\n[c1] Title B..." 的大段列表
    // 用一个启发式检查:不应该有多个 [cN] 格式的 id
    const idMatches = prompt.match(/\[c\d+\]/g);
    expect(idMatches).toBeNull(); // 完全没有候选 id,或最多有示例性的 1-2 个
  });

  it("prompt without prefetchedCandidateCount does NOT mention raw snapshot", () => {
    const tvPrompt = buildTvAnimeSystemPrompt({});
    const moviePrompt = buildMovieSystemPrompt({});

    expect(tvPrompt).not.toContain("viewResourceSnapshot");
    expect(moviePrompt).not.toContain("viewResourceSnapshot");
  });
});

describe("system prompt carries subtitle snapshot pointer (symmetric with raw pointer)", () => {
  it("TV/movie prompts include the subtitle pointer when the run is subtitle-active with candidates", () => {
    for (const build of [buildTvAnimeSystemPrompt, buildMovieSystemPrompt]) {
      const prompt = build({ subtitle: true, subtitleCandidateCount: 12 });
      expect(prompt).toContain("12");
      expect(prompt).toContain("viewSubtitleSnapshot");
      expect(prompt).toMatch(/字幕|subtitle/i);
    }
  });

  it("no subtitle pointer when the flow is inactive or the snapshot is empty", () => {
    // The skill INDEX may mention viewSubtitleSnapshot (it tells the agent when to
    // read the subtitle section) — what must NOT render is the POINTER header.
    expect(buildTvAnimeSystemPrompt({})).not.toContain("SUBTITLE SNAPSHOT");
    expect(buildTvAnimeSystemPrompt({ subtitle: true, subtitleCandidateCount: 0 })).not.toContain(
      "SUBTITLE SNAPSHOT",
    );
  });
});
