import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { PanSouResourceProvider } from "../src/index.js";

describe("PanSouResourceProvider", () => {
  it("maps PanSou 115 and magnet links into a resource snapshot", async () => {
    const provider = new PanSouResourceProvider({
      baseURL: "https://pansou.example",
      now: () => "2026-06-11T00:00:00.000Z",
      maxSearchAttempts: 1,
      fetchJson: async (url, init) => {
        expect(url).toBe("https://pansou.example/api/search");
        expect(init).toMatchObject({
          method: "POST",
          body: JSON.stringify({ kw: "翘楚 4K", res: "all" }),
        });
        return {
          code: 0,
          data: {
            results: [
              {
                title: "翘楚 S01E01 4K",
                channel: "telegram-a",
                links: [
                  {
                    type: "115",
                    url: "https://115.com/s/abc",
                    password: "pw1",
                    datetime: "2026-06-11",
                  },
                  {
                    type: "magnet",
                    url: "magnet:?xt=urn:btih:abc",
                  },
                ],
              },
              {
                title: "翘楚 第2集 1080p",
                channel: "telegram-b",
                links: [
                  {
                    type: "115",
                    url: "https://115.com/s/def",
                  },
                  {
                    type: "115",
                    url: "https://115.com/s/def",
                  },
                ],
              },
            ],
          },
        };
      },
    });

    const snapshot = await provider.search({ keyword: "翘楚 4K" });

    expect(snapshot).toMatchObject({
      id: expect.stringMatching(/^pansou_[0-9a-f]{12}$/),
      provider: "pansou",
      keyword: "翘楚 4K",
      createdAt: "2026-06-11T00:00:00.000Z",
    });
    const sid = snapshot.id;
    expect(snapshot.candidates).toEqual([
      expect.objectContaining({
        id: `${sid}_candidate_1`,
        snapshotId: sid,
        index: 0,
        title: "翘楚 S01E01 4K",
        type: "115",
        source: "telegram-a",
        providerPayload: {
          url: "https://115.com/s/abc",
          password: "pw1",
          datetime: "2026-06-11",
          rawType: "115",
        },
      }),
      expect.objectContaining({
        id: `${sid}_candidate_2`,
        index: 1,
        title: "翘楚 S01E01 4K",
        type: "magnet",
        providerPayload: {
          url: "magnet:?xt=urn:btih:abc",
          password: "",
          datetime: "",
          rawType: "magnet",
        },
      }),
      expect.objectContaining({
        id: `${sid}_candidate_3`,
        index: 2,
        title: "翘楚 第2集 1080p",
        type: "115",
        source: "telegram-b",
      }),
    ]);
  });

  it("recognizes quark links and filters candidates by allowedTypes (per-brand)", async () => {
    const fetchJson = async () => ({
      code: 0,
      data: {
        results: [
          {
            title: "片 1080p",
            channel: "c",
            links: [
              { type: "115", url: "https://115.com/s/a" },
              { type: "quark", url: "https://pan.quark.cn/s/abc", password: "p" },
              { type: "magnet", url: "magnet:?xt=urn:btih:z" },
            ],
          },
        ],
      },
    });

    // quark drive → only quark links
    const quarkOnly = new PanSouResourceProvider({
      baseURL: "https://pansou.example",
      maxSearchAttempts: 1,
      allowedTypes: ["quark"],
      fetchJson,
    });
    const qs = await quarkOnly.search({ keyword: "k" });
    expect(qs.candidates.map((c) => c.type)).toEqual(["quark"]);
    expect(qs.candidates[0]?.providerPayload.url).toBe("https://pan.quark.cn/s/abc");
    expect(qs.candidates[0]?.providerPayload.password).toBe("p");

    // 115 drive → only 115 + magnet (quark hidden)
    const pan115 = new PanSouResourceProvider({
      baseURL: "https://pansou.example",
      maxSearchAttempts: 1,
      allowedTypes: ["115", "magnet"],
      fetchJson,
    });
    const ps = await pan115.search({ keyword: "k" });
    expect(ps.candidates.map((c) => c.type).sort()).toEqual(["115", "magnet"]);
  });

  it("recognizes tianyi links by rawType and by cloud.189.cn share-url shape", async () => {
    const fetchJson = async () => ({
      code: 0,
      data: {
        results: [
          {
            title: "剧 1080p",
            channel: "c",
            links: [
              // PanSou-typed tianyi link (the probe-confirmed /t/<code> shape).
              { type: "tianyi", url: "https://cloud.189.cn/t/AbCd12", password: "" },
              // Loosely-typed links: the share-url shape must still win…
              { type: "others", url: "https://cloud.189.cn/web/share?code=QzYnEr&accessCode=x1y2" },
              // …but a non-share 189 URL (web portal) must NOT be classified tianyi.
              { type: "others", url: "https://cloud.189.cn/web/main/" },
              { type: "115", url: "https://115.com/s/a" },
            ],
          },
        ],
      },
    });

    // tianyi drive → only tianyi links (mirrors allowedResourceTypesForKinds(["pansou-tianyi"])).
    const tianyiOnly = new PanSouResourceProvider({
      baseURL: "https://pansou.example",
      maxSearchAttempts: 1,
      allowedTypes: ["tianyi"],
      fetchJson,
    });
    const snapshot = await tianyiOnly.search({ keyword: "k" });
    expect(snapshot.candidates.map((c) => c.type)).toEqual(["tianyi", "tianyi"]);
    expect(snapshot.candidates.map((c) => c.providerPayload.url)).toEqual([
      "https://cloud.189.cn/t/AbCd12",
      "https://cloud.189.cn/web/share?code=QzYnEr&accessCode=x1y2",
    ]);
  });

  it("recognizes 123 links by rawType and by 123 mirror-domain share-url shape", async () => {
    const fetchJson = async () => ({
      code: 0,
      data: {
        results: [
          {
            title: "剧 1080p",
            channel: "c",
            links: [
              // PanSou-typed 123 link (canonical 123pan.com share shape).
              { type: "123", url: "https://www.123pan.com/s/AbCd-12", password: "" },
              // Loosely-typed links: the mirror-domain share shape must still win
              // (domain set mirrors parsePan123ShareUrl: 123pan/123684/123865/123912 · com/cn)…
              { type: "others", url: "https://www.123684.com/s/abc-1?pwd=x" },
              // …but a non-123 URL must NOT be classified 123.
              { type: "others", url: "https://cloud.189.cn/web/main/" },
              { type: "115", url: "https://115.com/s/a" },
            ],
          },
        ],
      },
    });

    // 123 drive → only 123 links (mirrors allowedResourceTypesForKinds(["pansou-123"])).
    const pan123Only = new PanSouResourceProvider({
      baseURL: "https://pansou.example",
      maxSearchAttempts: 1,
      allowedTypes: ["123"],
      fetchJson,
    });
    const snapshot = await pan123Only.search({ keyword: "k" });
    expect(snapshot.candidates.map((c) => c.type)).toEqual(["123", "123"]);
    expect(snapshot.candidates.map((c) => c.providerPayload.url)).toEqual([
      "https://www.123pan.com/s/AbCd-12",
      "https://www.123684.com/s/abc-1?pwd=x",
    ]);
  });

  it("returns an empty snapshot when PanSou reports a non-zero code", async () => {
    const provider = new PanSouResourceProvider({
      baseURL: "https://pansou.example",
      now: () => "2026-06-11T00:00:00.000Z",
      maxSearchAttempts: 1,
      fetchJson: async () => ({ code: 400, message: "bad request" }),
    });

    const snapshot = await provider.search({ keyword: "翘楚" });

    expect(snapshot.candidates).toEqual([]);
    expect(snapshot.provider).toBe("pansou");
    expect(snapshot.keyword).toBe("翘楚");
  });

  it("gives empty results for different keywords DIFFERENT snapshot ids", async () => {
    // Regression: empty fact lists used to hash the same `[]` regardless of
    // keyword → one shared id that collides across keywords and runs
    // (resource_snapshots.id is a global primary key, which crashed persistence).
    const provider = new PanSouResourceProvider({
      baseURL: "https://pansou.example",
      now: () => "2026-06-11T00:00:00.000Z",
      maxSearchAttempts: 1,
      fetchJson: async () => ({ code: 0, data: { results: [] } }),
    });

    const a = await provider.search({ keyword: "奥本海默" });
    const b = await provider.search({ keyword: "躲在超市后门吸烟的两人" });

    expect(a.candidates).toEqual([]);
    expect(b.candidates).toEqual([]);
    expect(a.id).not.toBe(b.id);
  });

  it("run-scopes snapshot AND candidate ids so a re-acquisition does not collide", async () => {
    // Same keyword, same results, two different runs: a content-hashing provider
    // used to yield the SAME id, so the second run's snapshot was dropped on the
    // global resource_snapshots primary key. The run id must namespace the ids.
    const provider = new PanSouResourceProvider({
      baseURL: "https://pansou.example",
      now: () => "2026-06-11T00:00:00.000Z",
      maxSearchAttempts: 1,
      fetchJson: async () => ({
        code: 0,
        data: {
          results: [
            {
              title: "奥本海默 2023 2160p",
              channel: "telegram-a",
              links: [{ type: "magnet", url: "magnet:?xt=urn:btih:" + "a".repeat(40) }],
            },
          ],
        },
      }),
    });

    const runA = await provider.search({ keyword: "奥本海默", workflowRunId: "run_a" });
    const runB = await provider.search({ keyword: "奥本海默", workflowRunId: "run_b" });
    const anon = await provider.search({ keyword: "奥本海默" });

    // Different runs → different snapshot ids (and the run id is visible in them).
    expect(runA.id).not.toBe(runB.id);
    expect(runA.id).toContain("run_a");
    expect(runB.id).toContain("run_b");
    // Candidate ids inherit the run scope.
    expect(runA.candidates[0]?.id).toContain("run_a");
    expect(runA.candidates[0]?.id).not.toBe(runB.candidates[0]?.id);
    // No run id → the legacy content-addressed form (back-compat for smoke/CLI).
    expect(anon.id).not.toContain("run_a");
    expect(anon.id.startsWith("pansou_")).toBe(true);
  });

  it("polls until PanSou's streaming results stop growing, then uses the fullest set", async () => {
    // PanSou streams: call 1 returns a quick partial slice, later calls carry the
    // async-plugin links. The provider must judge the COMPLETE set, never 抢跑.
    const responses = [
      // Call 1: a single quick 115 link.
      {
        code: 0,
        data: {
          results: [
            {
              title: "奥本海默 2023 (快取)",
              channel: "quick",
              links: [{ type: "115", url: "https://115.com/s/swA?password=aaaa", password: "aaaa", datetime: "" }],
            },
          ],
        },
      },
      // Call 2: more results have streamed in (magnet appears).
      {
        code: 0,
        data: {
          results: [
            {
              title: "奥本海默 2023 (快取)",
              channel: "quick",
              links: [{ type: "115", url: "https://115.com/s/swA?password=aaaa", password: "aaaa", datetime: "" }],
            },
            {
              title: "Oppenheimer 2023 2160p",
              channel: "plugin",
              links: [{ type: "magnet", url: "magnet:?xt=urn:btih:deadbeef", password: "", datetime: "" }],
            },
          ],
        },
      },
      // Call 3: stabilized — same as call 2 (no new links).
      {
        code: 0,
        data: {
          results: [
            {
              title: "奥本海默 2023 (快取)",
              channel: "quick",
              links: [{ type: "115", url: "https://115.com/s/swA?password=aaaa", password: "aaaa", datetime: "" }],
            },
            {
              title: "Oppenheimer 2023 2160p",
              channel: "plugin",
              links: [{ type: "magnet", url: "magnet:?xt=urn:btih:deadbeef", password: "", datetime: "" }],
            },
          ],
        },
      },
    ];
    let calls = 0;
    const waits: number[] = [];
    const provider = new PanSouResourceProvider({
      baseURL: "https://pansou.example",
      now: () => "2026-06-11T00:00:00.000Z",
      maxSearchAttempts: 5,
      searchPollMs: 2500,
      wait: async (ms) => {
        waits.push(ms);
      },
      fetchJson: async () => responses[Math.min(calls++, responses.length - 1)],
    });

    const snapshot = await provider.search({ keyword: "奥本海默" });

    // It kept polling past the partial first slice and surfaced BOTH links.
    expect(snapshot.candidates).toHaveLength(2);
    expect(snapshot.candidates.map((c) => c.type)).toEqual(["115", "magnet"]);
    // Stabilized at call 3 (count stopped growing) — did not burn all 5 attempts.
    expect(calls).toBe(3);
    expect(waits).toEqual([2500, 2500]);
  });
});

// 2026-07-06 field incident: a stalled PanSou instance hung the pre-agent
// search for 4.5 minutes because the default fetch had no timeout — the
// same failure class as the TMDB hang (#68). This pins the bounded-wait
// contract so a dead upstream degrades to "fewer candidates", never a
// frozen run. Uses a real HTTP server (not a fake fetchJson) because the
// timeout lives in defaultFetchJson itself.
describe("PanSouResourceProvider request timeout", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server!.close((err) => (err ? reject(err) : resolve())),
    );
    server = undefined;
  });

  it("returns an empty snapshot instead of hanging when the server never responds", async () => {
    server = createServer(() => {
      // Accept the request and go silent — no headers, no body, no end.
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    const provider = new PanSouResourceProvider({
      baseURL: `http://127.0.0.1:${port}`,
      requestTimeoutMs: 200,
      maxSearchAttempts: 2,
      searchPollMs: 1,
    });

    const startedAt = Date.now();
    const snapshot = await provider.search({ keyword: "闪灵" });
    const elapsedMs = Date.now() - startedAt;

    expect(snapshot.candidates).toEqual([]);
    // One stalled attempt aborts at ~200ms and the poll loop bails on the
    // error path; well under a second proves the wait is bounded.
    expect(elapsedMs).toBeLessThan(2000);
  }, 10_000);
});
