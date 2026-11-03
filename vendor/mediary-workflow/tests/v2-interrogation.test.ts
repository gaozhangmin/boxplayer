import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import {
  INTERROGATION_QUESTIONS,
  runInterrogation,
} from "../src/acquisition-v2/interrogation.js";
import { buildTvAnimeSystemPrompt } from "../src/acquisition-v2/task-agents.js";

const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
} as const;

describe("§6a interrogation harness (verify '聪明' before spending real money)", () => {
  it("covers the Lycoris-Recoil edge cases the plan enumerates", () => {
    const topics = INTERROGATION_QUESTIONS.map((q) => q.id);
    expect(topics).toEqual(
      expect.arrayContaining([
        "open_movie_walkthrough",
        "open_tv_walkthrough",
        "first_step",
        "full_season_pack",
        "verify_landed",
        "staging_classification",
        "mark_obtained",
        "overlapping_ranges",
        "dead_link",
        "daily_patrol_latest_only",
        "multi_season_pack",
        "partial_seasons_full_pack",
        "ongoing_plus_completed_gap",
        "unobtainable_completed_gap",
        "only_some_remaining_seasons",
        // 2026-07-06 获取循环四病（攻壳事故）新语义:
        "terminal_no_coverage",
        "repeat_search_notice",
        "taboo_warning_reaction",
        "digest_hint_reaction",
      ]),
    );
  });

  it("asks every question and captures the agent's reasoning (no side effects)", async () => {
    let n = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        n += 1;
        return { content: [{ type: "text" as const, text: `answer ${n}` }], finishReason: { unified: "stop" as const, raw: "stop" as const }, usage: USAGE, warnings: [] };
      },
    });

    const transcript = await runInterrogation({
      model,
      systemPrompt: buildTvAnimeSystemPrompt({}),
      scenario: "Target: Lycoris Recoil season 1, missing S01E01-S01E13.",
    });

    expect(transcript).toHaveLength(INTERROGATION_QUESTIONS.length);
    expect(transcript.every((entry) => entry.answer.startsWith("answer "))).toBe(true);
    expect(transcript[0]!.id).toBe("open_movie_walkthrough"); // open walkthroughs run first (empty context)
  });
});
