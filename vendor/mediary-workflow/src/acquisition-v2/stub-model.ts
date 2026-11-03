import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";

const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
} as const;

/**
 * A no-op acquisition model for the fake/dev adapter. It searches once then
 * honestly reports no coverage, so a dev/demo worker run completes cleanly
 * without a real agent. Real acquisition requires AGENT_MODEL configuration
 * (MEDIA_TRACK_AGENT_ADAPTER=vercel-ai); the adapter policy enforces that
 * whenever the live PanSou provider or 115 storage is in use.
 */
export function createStubAcquisitionModel(): LanguageModel {
  let step = 0;
  return new MockLanguageModelV3({
    doGenerate: async (): Promise<LanguageModelV3GenerateResult> => {
      step += 1;
      if (step === 1) {
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: "stub_no_coverage",
              toolName: "reportNoCoverage",
              input: JSON.stringify({ reason: "fake adapter — configure AGENT_MODEL for real acquisition" }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool-calls" },
          usage: USAGE,
          warnings: [],
        };
      }
      return {
        content: [{ type: "text", text: "stub: no coverage (fake adapter)" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: USAGE,
        warnings: [],
      };
    },
  });
}
