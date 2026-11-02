import { describe, expect, it } from "vitest";
import {
  dispatchNotifications,
  resolveDriveSourceLabels,
  type NotificationReport,
  type NotifyChannel,
  type NotifyMessage,
} from "../src/index.js";
import { formatDailyDigestPushText } from "../src/notification-report.js";

// End-to-end through the REAL render + dispatch path: a fake channel captures the
// actual NotifyMessage delivered. Proves "gate → resolve → render → deliver" composes
// (unit-green ≠ the push actually carried the source). The gate (≥2 drives) lives in
// resolveDriveSourceLabels; here we feed its output through dispatch and read the wire.

function capturer(): { channel: NotifyChannel; sent: NotifyMessage[] } {
  const sent: NotifyMessage[] = [];
  return { channel: { id: "fake", async send(message) { sent.push(message); } }, sent };
}

const report: NotificationReport = {
  titleName: "阿甘正传",
  seasonLabel: null,
  status: "acquired",
  lines: ["已获取"],
  newlyObtained: [],
  realMissing: [],
  year: 1994,
};
const drivesTwo = [
  { id: "cs_a", provider: "pan115", label: null },
  { id: "cs_quark_x", provider: "quark", label: null },
];

function notification(id: string, report?: NotificationReport) {
  return {
    id,
    workflowRunId: `run_${id}`,
    kind: "acquire",
    title: "t",
    body: "b",
    createdAt: "2026-06-20T00:00:00Z",
    ...(report ? { report } : {}),
  };
}

describe("notification drive-source: end-to-end through a fake channel", () => {
  it("≥2 drives → the delivered message carries the correct source drive", async () => {
    const n = notification("n1", report);
    const labels = resolveDriveSourceLabels([{ connectedStorageId: "cs_quark_x", notification: n }], drivesTwo);
    const { channel, sent } = capturer();
    await dispatchNotifications({
      channels: [channel],
      notifications: [n as never],
      opts: { sourceLabel: labels.get("n1")! },
    });
    expect(sent[0]!.markdown).toContain("来源网盘：夸克网盘");
    expect(sent[0]!.text).toContain("来源网盘：夸克网盘");
  });

  it("1 drive → the delivered message has NO source tag (gate)", async () => {
    const n = notification("n1", report);
    const labels = resolveDriveSourceLabels([{ connectedStorageId: "cs_a", notification: n }], [drivesTwo[0]!]);
    const sourceLabel = labels.get("n1");
    const { channel, sent } = capturer();
    await dispatchNotifications({
      channels: [channel],
      notifications: [n as never],
      ...(sourceLabel ? { opts: { sourceLabel } } : {}),
    });
    expect(sent[0]!.markdown).not.toContain("来源网盘");
    expect(sent[0]!.text).not.toContain("来源网盘");
  });

  it("digest: each show line carries its source drive when ≥2 drives", async () => {
    const sched = {
      ...notification("d1"),
      kind: "episodes_restored",
      trigger: "scheduled" as const,
      report: {
        ...report,
        titleName: "斗破苍穹",
        seasonLabel: "第 5 季",
        status: "airing" as const,
        lines: ["已获取至最新第 6 集"],
        newlyObtained: ["S05E06"],
        realMissing: [],
      },
    };
    const labels = resolveDriveSourceLabels([{ connectedStorageId: "cs_a", notification: sched }], drivesTwo);
    const digest = {
      id: "dg",
      workflowRunId: "run_dg",
      kind: "daily_digest",
      title: "每日巡检",
      body: formatDailyDigestPushText([sched as never], { sourceLabelById: labels }),
      createdAt: "2026-06-20T00:00:00Z",
    };
    const { channel, sent } = capturer();
    await dispatchNotifications({ channels: [channel], notifications: [digest as never] });
    expect(sent[0]!.text).toContain("来自115 网盘");
  });
});
