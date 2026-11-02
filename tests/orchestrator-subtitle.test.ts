import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { runAcquisitionV2 } from "../src/acquisition-v2/orchestrator.js";
import type { ResourceProvider } from "../src/ports.js";
import type { ResourceSnapshot } from "../src/domain.js";
import type { AssrtCandidate, AssrtSubtitleFile } from "../src/subtitle-provider.js";
import { FakeStorageExecutor } from "../src/fakes.js";

const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
} as const;

/** A model that stops immediately — the subtitle PRE-WARM side effect we assert
 *  happens BEFORE the loop runs, so the agent behavior itself doesn't matter. */
function stopModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: "done" }],
      finishReason: { unified: "stop" as const, raw: "stop" as const },
      usage: USAGE,
      warnings: [],
    }),
  });
}

function emptyProvider(): ResourceProvider {
  return {
    search: async ({ keyword }): Promise<ResourceSnapshot> => ({
      id: "snap_empty",
      provider: "pansou",
      keyword,
      candidates: [],
      createdAt: "2026-07-01T00:00:00.000Z",
    }),
  };
}

/** An assrt provider that records how many times search() was called, so we can
 *  assert the pre-warm gate: 1 call when all gates pass, 0 when any gate fails. */
function spyingAssrtProvider(): {
  provider: { search(k: string): Promise<AssrtCandidate[]>; detail(id: number): Promise<AssrtSubtitleFile[]> };
  state: { searchCalls: number };
} {
  const state = { searchCalls: 0 };
  const provider = {
    search: async (_k: string): Promise<AssrtCandidate[]> => {
      state.searchCalls += 1;
      return [];
    },
    detail: async (_id: number): Promise<AssrtSubtitleFile[]> => [],
  };
  return { provider, state };
}

/** Run a movie acquisition with the given gate inputs; return how many times
 *  assrt.search was called (the pre-warm indicator). */
/** A FakeStorageExecutor that CAN land subtitle urls — the capability the
 *  orchestrator gate probes for. Brand string is irrelevant; the optional
 *  method's presence is the single source of truth. */
class SubtitleCapableExecutor extends FakeStorageExecutor {
  async transferSubtitleUrl(input: {
    url: string;
    filename: string;
    directoryId: string;
    workflowRunId: string;
  }) {
    return {
      id: `${input.workflowRunId}_subtitle_1`,
      workflowRunId: input.workflowRunId,
      candidateId: `subtitle:${input.filename}`,
      status: "succeeded" as const,
      providerMessage: "",
      materializedFileIds: [],
    };
  }
}

async function runWithGates(gates: {
  originCountries: string[];
  storageProvider: string;
  assrtToken?: string;
  /** true → executor implements transferSubtitleUrl (e.g. 115); false → it
   *  doesn't (e.g. quark today). */
  subtitleCapable: boolean;
}): Promise<number> {
  const { provider: assrtProvider, state } = spyingAssrtProvider();
  const executorOptions = { directories: { staging: [], movie: [] } };
  await runAcquisitionV2({
    provider: emptyProvider(),
    executor: gates.subtitleCapable
      ? new SubtitleCapableExecutor(executorOptions)
      : new FakeStorageExecutor(executorOptions),
    model: stopModel(),
    workflowRunId: "run-test",
    target: { kind: "movie", title: "Inception", aliases: [], year: 2010, qualityPreference: "4K" },
    stagingDirectoryId: "staging",
    targetMovieDirectoryId: "movie",
    originCountries: gates.originCountries,
    storageProvider: gates.storageProvider,
    ...(gates.assrtToken === undefined ? {} : { assrtToken: gates.assrtToken }),
    assrtProvider,
  });
  return state.searchCalls;
}

describe("runAcquisitionV2 subtitle pre-warming gates (capability-based, no brand hardcode)", () => {
  it("pre-warms when assrtToken set + origin non-CN + executor can land subtitle urls", async () => {
    expect(
      await runWithGates({ originCountries: ["US"], storageProvider: "pan115", assrtToken: "fake-token", subtitleCapable: true }),
    ).toBe(1);
  });

  it("does NOT pre-warm when origin includes CN", async () => {
    expect(
      await runWithGates({ originCountries: ["CN"], storageProvider: "pan115", assrtToken: "fake-token", subtitleCapable: true }),
    ).toBe(0);
  });

  it("does NOT pre-warm when assrtToken is undefined", async () => {
    expect(await runWithGates({ originCountries: ["US"], storageProvider: "pan115", subtitleCapable: true })).toBe(0);
  });

  it("does NOT pre-warm when the executor lacks transferSubtitleUrl (quark today) — the gate can never disagree with the executor", async () => {
    expect(
      await runWithGates({ originCountries: ["US"], storageProvider: "quark", assrtToken: "fake-token", subtitleCapable: false }),
    ).toBe(0);
  });

  it("brand string is IRRELEVANT: a capable executor pre-warms even under another provider name (光鸭 lights up the day its executor implements the method)", async () => {
    expect(
      await runWithGates({ originCountries: ["US"], storageProvider: "guangya", assrtToken: "fake-token", subtitleCapable: true }),
    ).toBe(1);
  });

  it("does NOT pre-warm when origins include CN alongside others (multi-origin)", async () => {
    expect(
      await runWithGates({ originCountries: ["CN", "US"], storageProvider: "pan115", assrtToken: "fake-token", subtitleCapable: true }),
    ).toBe(0);
  });
});

describe("unknown-origin gate (known non-CN required)", () => {
  it("does NOT pre-warm when origin metadata is missing/empty — niche CN titles lacking TMDB metadata must not burn assrt quota on every patrol", async () => {
    expect(
      await runWithGates({ originCountries: [], storageProvider: "pan115", assrtToken: "fake-token", subtitleCapable: true }),
    ).toBe(0);
  });
});
