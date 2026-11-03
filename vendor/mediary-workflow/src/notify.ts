import type { NotificationEvent, NotificationReport } from "./domain.js";
import { formatReportPushText, landedSize } from "./notification-report.js";
import { getStorageBrand, isRegisteredStorageProvider } from "./storage-brands.js";

/** Human label for a drive in a push tag: the user-set nickname, else the brand
 *  name (115 网盘 / 夸克网盘). Mirrors the workspace switcher's fallback. Never
 *  throws — an unknown provider degrades to the raw provider string. */
export function driveDisplayName(drive: { provider: string; label: string | null }): string {
  const nickname = drive.label?.trim();
  if (nickname) return nickname;
  return isRegisteredStorageProvider(drive.provider) ? getStorageBrand(drive.provider).label : drive.provider;
}

/** Gate + resolution for the "which drive" push tag. Returns an EMPTY map when the
 *  account has < 2 drives (single-drive → no source tag anywhere). Otherwise maps
 *  each notification id to its source drive's display name. Entries whose drive is
 *  null/unknown (legacy run, drive unbound after the run, or the __unscoped__
 *  sentinel) are omitted, not errored. */
export function resolveDriveSourceLabels(
  entries: Array<{ connectedStorageId: string | null; notification: { id: string } }>,
  drives: Array<{ id: string; provider: string; label: string | null }>,
): Map<string, string> {
  const labels = new Map<string, string>();
  if (drives.length < 2) {
    return labels;
  }
  const byId = new Map(drives.map((drive) => [drive.id, driveDisplayName(drive)]));
  for (const entry of entries) {
    const name = entry.connectedStorageId ? byId.get(entry.connectedStorageId) : undefined;
    if (name) {
      labels.set(entry.notification.id, name);
    }
  }
  return labels;
}

/**
 * Outbound push: the in-app feed is the source of truth; these channels are
 * delivery only. Every adapter is "HTTPS POST a token-bearing URL with
 * title + body" — the user picks whichever channels they configured, and a
 * delivery failure never affects workflow runs (collected, not thrown).
 */
export interface NotifyMessage {
  title: string;
  text: string;
  markdown?: string;
  url?: string;
  /** A poster/cover image — rendered inline (Server酱 markdown), as the icon
   *  (Bark), or the card thumbnail (企微 news). Absent → text-only. */
  imageUrl?: string;
}

/** TMDB's own CDN serves posters from the stored posterPath — no self-hosting. */
const TMDB_POSTER_BASE = "https://image.tmdb.org/t/p/w500";

/**
 * Render a notification report into one rich push message (L2): a poster image, a
 * structured Markdown body, and a tap-through link — each channel then uses what
 * it can (Server酱 markdown, Bark icon+url, 企微 news card, webhook full JSON),
 * degrading gracefully. The plain `text` stays the universal fallback. A poster
 * works without any domain (TMDB CDN); the link only appears when a public
 * `webBaseUrl` is configured (local dev has none → no link, poster stays).
 */
export function buildNotifyMessage(
  report: NotificationReport,
  opts?: { posterBaseUrl?: string; webBaseUrl?: string; sourceLabel?: string },
): NotifyMessage {
  const posterBase = (opts?.posterBaseUrl ?? TMDB_POSTER_BASE).replace(/\/$/, "");
  const head = report.seasonLabel
    ? `${report.titleName} ${report.seasonLabel}`
    : report.year
      ? `${report.titleName} (${report.year})`
      : report.titleName;
  const imageUrl = report.posterPath ? `${posterBase}${report.posterPath}` : undefined;
  const webBase = opts?.webBaseUrl?.replace(/\/$/, "");
  const url = webBase && report.tmdbId !== undefined ? `${webBase}/show/${report.tmdbId}` : undefined;

  // No poster in the body: Server酱's markdown image rendered full-bleed and the
  // user preferred the clean daily-digest layout (structured text only). The head
  // is NOT repeated as a heading either — every channel shows it as its own title
  // field. `imageUrl` is still emitted for channels with a NATIVE image slot
  // (Bark icon, 企微 news thumbnail), which aren't affected by this.
  const md: string[] = [];
  for (const line of report.lines) {
    md.push(`- ${line}`);
  }
  const size = landedSize(report);
  if (size) {
    md.push(`- ${size.label}：${size.value}`);
  }
  if (report.landingDir) {
    md.push(`- 落盘：${report.landingDir}`);
  }
  if (report.newlyObtained.length > 0) {
    md.push(`- 本次新增：${report.newlyObtained.join("、")}`);
  }
  if (report.realMissing.length > 0) {
    md.push(`- 缺集：${report.realMissing.join("、")}`);
  }
  // Source drive — only the push layer passes this, and only when the account has
  // ≥2 drives mounted (single-drive → opts.sourceLabel absent → line omitted).
  if (opts?.sourceLabel) {
    md.push(`- 来源网盘：${opts.sourceLabel}`);
  }
  if (url) {
    md.push("", `[查看详情 →](${url})`);
  }

  const baseText = formatReportPushText(report);
  const text = opts?.sourceLabel ? `${baseText}\n📦 来源网盘：${opts.sourceLabel}` : baseText;

  return {
    title: head,
    text,
    markdown: md.join("\n"),
    ...(imageUrl ? { imageUrl } : {}),
    ...(url ? { url } : {}),
  };
}

export interface NotifyChannel {
  id: string;
  send(message: NotifyMessage): Promise<void>;
}

export type NotifyFetch = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number }>;

const defaultFetch: NotifyFetch = async (url, init) => {
  const response = await fetch(url, init);
  return { ok: response.ok, status: response.status };
};

function assertDelivered(channelId: string, result: { ok: boolean; status: number }): void {
  if (!result.ok) {
    throw new Error(`${channelId} push failed with HTTP ${result.status}`);
  }
}

/** Bark (iOS, APNs). 3-step user setup: install app, copy key, paste. */
export function createBarkChannel(options: {
  key: string;
  baseUrl?: string;
  fetchImpl?: NotifyFetch;
}): NotifyChannel {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const baseUrl = (options.baseUrl ?? "https://api.day.app").replace(/\/$/, "");
  return {
    id: "bark",
    async send(message) {
      const result = await fetchImpl(`${baseUrl}/${options.key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: message.title,
          body: message.text,
          group: "media-track",
          ...(message.url === undefined ? {} : { url: message.url }),
          ...(message.imageUrl === undefined ? {} : { icon: message.imageUrl }),
        }),
      });
      assertDelivered("bark", result);
    },
  };
}

/** Server酱 Turbo — lands in personal WeChat, zero app install. */
export function createServerChanChannel(options: {
  sendKey: string;
  fetchImpl?: NotifyFetch;
}): NotifyChannel {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  return {
    id: "serverchan",
    async send(message) {
      const body = new URLSearchParams({
        title: message.title,
        desp: message.markdown ?? message.text,
      });
      const result = await fetchImpl(`https://sctapi.ftqq.com/${options.sendKey}.send`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: body.toString(),
      });
      assertDelivered("serverchan", result);
    },
  };
}

/** 企业微信群机器人 webhook. */
export function createWeComChannel(options: {
  webhookUrl: string;
  fetchImpl?: NotifyFetch;
}): NotifyChannel {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  return {
    id: "wecom",
    async send(message) {
      const payload =
        // A poster + tap-through link → a 图文 (news) card: thumbnail + title + link.
        message.imageUrl !== undefined && message.url !== undefined
          ? {
              msgtype: "news",
              news: {
                articles: [
                  { title: message.title, description: message.text, url: message.url, picurl: message.imageUrl },
                ],
              },
            }
          : message.markdown !== undefined
            ? { msgtype: "markdown", markdown: { content: `**${message.title}**\n${message.markdown}` } }
            : { msgtype: "text", text: { content: `${message.title}\n${message.text}` } };
      const result = await fetchImpl(options.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assertDelivered("wecom", result);
    },
  };
}

/** Power-user escape hatch: POST the whole message to any URL. */
export function createWebhookChannel(options: {
  url: string;
  fetchImpl?: NotifyFetch;
}): NotifyChannel {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  return {
    id: "webhook",
    async send(message) {
      const result = await fetchImpl(options.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });
      assertDelivered("webhook", result);
    },
  };
}

export function createNotifyChannelsFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: NotifyFetch,
): NotifyChannel[] {
  const channels: NotifyChannel[] = [];
  const shared = fetchImpl === undefined ? {} : { fetchImpl };
  if (env["MEDIA_TRACK_PUSH_BARK_KEY"]) {
    channels.push(
      createBarkChannel({
        key: env["MEDIA_TRACK_PUSH_BARK_KEY"],
        ...(env["MEDIA_TRACK_PUSH_BARK_BASE_URL"]
          ? { baseUrl: env["MEDIA_TRACK_PUSH_BARK_BASE_URL"] }
          : {}),
        ...shared,
      }),
    );
  }
  if (env["MEDIA_TRACK_PUSH_SERVERCHAN_SENDKEY"]) {
    channels.push(
      createServerChanChannel({ sendKey: env["MEDIA_TRACK_PUSH_SERVERCHAN_SENDKEY"], ...shared }),
    );
  }
  if (env["MEDIA_TRACK_PUSH_WECOM_WEBHOOK"]) {
    channels.push(createWeComChannel({ webhookUrl: env["MEDIA_TRACK_PUSH_WECOM_WEBHOOK"], ...shared }));
  }
  if (env["MEDIA_TRACK_PUSH_WEBHOOK_URL"]) {
    channels.push(createWebhookChannel({ url: env["MEDIA_TRACK_PUSH_WEBHOOK_URL"], ...shared }));
  }
  return channels;
}

export interface NotifyDispatchResult {
  sent: number;
  failures: Array<{ channelId: string; notificationId: string; error: string }>;
}

export async function dispatchNotifications(input: {
  channels: NotifyChannel[];
  notifications: NotificationEvent[];
  /** Public base URL for the tap-through link (absent → no link, e.g. local dev);
   *  sourceLabel tags the source drive (set by the push layer when ≥2 drives). */
  opts?: { posterBaseUrl?: string; webBaseUrl?: string; sourceLabel?: string };
}): Promise<NotifyDispatchResult> {
  let sent = 0;
  const failures: NotifyDispatchResult["failures"] = [];
  for (const notification of input.notifications) {
    // A report → the rich L2 message (poster + markdown + link); otherwise the
    // legacy plain {title, text} (foreign-work / legacy events have no report).
    const message: NotifyMessage = notification.report
      ? buildNotifyMessage(notification.report, input.opts)
      : { title: notification.title, text: notification.body };
    let delivered = false;
    for (const channel of input.channels) {
      try {
        await channel.send(message);
        delivered = true;
      } catch (error) {
        failures.push({
          channelId: channel.id,
          notificationId: notification.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (delivered) {
      sent += 1;
    }
  }
  return { sent, failures };
}

/**
 * Unified push dispatch: reads config from DB (priority: overrideConfig > DB >
 * env), creates channels, and sends. Used by worker routes and test actions.
 * Returns channel IDs that successfully sent.
 */
export async function sendPushNotifications(input: {
  repository: { getSetting(key: string): Promise<string | null> };
  notification: NotificationEvent;
  overrideConfig?: Record<string, string>;
  fetchImpl?: NotifyFetch;
  /** Source-drive tag for the message (set by the push layer when ≥2 drives). */
  sourceLabel?: string;
}): Promise<string[]> {
  const config: Record<string, string> = {};

  for (const key of ["bark", "serverchan", "wecom", "webhook"]) {
    const override = input.overrideConfig?.[key];
    const dbValue = await input.repository.getSetting(`push_${key}`);
    const envKey =
      key === "bark"
        ? "MEDIA_TRACK_PUSH_BARK_KEY"
        : key === "serverchan"
          ? "MEDIA_TRACK_PUSH_SERVERCHAN_SENDKEY"
          : key === "wecom"
            ? "MEDIA_TRACK_PUSH_WECOM_WEBHOOK"
            : "MEDIA_TRACK_PUSH_WEBHOOK_URL";
    const envValue = process.env[envKey];
    config[key] = (override || dbValue || envValue || "").trim();
  }

  const channels: NotifyChannel[] = [];
  const shared = input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl };

  if (config.bark) {
    channels.push(createBarkChannel({ key: config.bark, ...shared }));
  }
  if (config.serverchan) {
    channels.push(createServerChanChannel({ sendKey: config.serverchan, ...shared }));
  }
  if (config.wecom) {
    channels.push(createWeComChannel({ webhookUrl: config.wecom, ...shared }));
  }
  if (config.webhook) {
    channels.push(createWebhookChannel({ url: config.webhook, ...shared }));
  }

  if (channels.length === 0) {
    return [];
  }

  const webBaseUrl = process.env.MEDIA_TRACK_PUBLIC_BASE_URL?.trim();
  const opts: { webBaseUrl?: string; sourceLabel?: string } = {};
  if (webBaseUrl) opts.webBaseUrl = webBaseUrl;
  if (input.sourceLabel) opts.sourceLabel = input.sourceLabel;
  const result = await dispatchNotifications({
    channels,
    notifications: [input.notification],
    ...(opts.webBaseUrl || opts.sourceLabel ? { opts } : {}),
  });
  const sentChannels = channels
    .filter((ch) => !result.failures.some((f) => f.channelId === ch.id))
    .map((ch) => ch.id);
  return sentChannels;
}
