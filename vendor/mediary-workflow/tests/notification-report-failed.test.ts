import { describe, expect, it } from "vitest";
import { formatReportPushText } from "../src/notification-report.js";
import type { NotificationReport } from "../src/domain.js";

const base: NotificationReport = {
  titleName: "新蝙蝠侠",
  seasonLabel: null,
  status: "failed",
  lines: ["网络中断,已重试 3 次"],
  newlyObtained: [],
  realMissing: [],
  posterPath: null,
  tmdbId: 414906,
  mediaType: "movie",
  year: 2022,
};

describe("notification render: failed / retrying", () => {
  it("renders a failed report with the ❌ marker and reason", () => {
    const text = formatReportPushText(base);
    expect(text).toContain("新蝙蝠侠");
    expect(text).toContain("❌");
    expect(text).toContain("网络中断");
  });

  it("renders a retrying report with the ⚠️ marker", () => {
    const text = formatReportPushText({
      ...base,
      status: "retrying",
      lines: ["第 1 次自动重试 · 约 1 分钟后"],
    });
    expect(text).toContain("⚠️");
    expect(text).toContain("自动重试");
  });
});
