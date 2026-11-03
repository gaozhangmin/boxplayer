import { describe, expect, it } from "vitest";
import { AssrtSubtitleProvider, type AssrtFetchJson } from "../src/subtitle-provider.js";

function fakeFetch(byUrl: Record<string, unknown>): AssrtFetchJson {
  return async (url: string) => {
    for (const [needle, body] of Object.entries(byUrl)) {
      if (url.includes(needle)) return body;
    }
    throw new Error(`unexpected url ${url}`);
  };
}

describe("AssrtSubtitleProvider.search", () => {
  it("maps a hit's sub.subs[] to {id,title,lang} candidates", async () => {
    const provider = new AssrtSubtitleProvider({
      token: "T",
      fetchJson: fakeFetch({
        "sub/search": {
          status: 0,
          sub: {
            subs: [
              { id: 713570, videoname: "Breaking.Bad.S02", native_name: "绝命毒师 第二季", lang: { desc: "英 简 双语" } },
            ],
          },
        },
      }),
    });
    const out = await provider.search("绝命毒师");
    expect(out).toEqual([{ id: 713570, title: "绝命毒师 第二季 · Breaking.Bad.S02", lang: "英 简 双语" }]);
  });

  it("returns [] when sub.subs is the empty OBJECT the API sends for no results", async () => {
    const provider = new AssrtSubtitleProvider({
      token: "T",
      fetchJson: fakeFetch({ "sub/search": { status: 0, sub: { subs: {}, result: "succeed" } } }),
    });
    expect(await provider.search("庆余年")).toEqual([]);
  });

  it("returns [] on quota-exceeded (status 30900) without throwing", async () => {
    const provider = new AssrtSubtitleProvider({
      token: "T",
      fetchJson: fakeFetch({ "sub/search": { status: 30900, errmsg: "exceeding request limits" } }),
    });
    expect(await provider.search("x")).toEqual([]);
  });

  it("returns [] when the fetch itself throws (network / timeout)", async () => {
    const provider = new AssrtSubtitleProvider({
      token: "T",
      fetchJson: async () => { throw new Error("network down"); },
    });
    expect(await provider.search("x")).toEqual([]);
  });
});

describe("AssrtSubtitleProvider.detail", () => {
  it("maps sub.subs[0].filelist to {filename,url} entries", async () => {
    const provider = new AssrtSubtitleProvider({
      token: "T",
      fetchJson: fakeFetch({
        "sub/detail": {
          status: 0,
          sub: {
            subs: [
              {
                filename: "Breaking.Bad.S02.zip",
                url: "http://file0.assrt.net/download/713570/x.zip?api=1",
                filelist: [
                  { f: "Breaking.Bad.S02E01.ass", s: "718KB", url: "http://file0.assrt.net/onthefly/713570/-/1/x.ass?api=1" },
                  { f: "Breaking.Bad.S02E02.ass", s: "708KB", url: "http://file0.assrt.net/onthefly/713570/-/2/y.ass?api=1" },
                ],
              },
            ],
          },
        },
      }),
    });
    const out = await provider.detail(713570);
    expect(out).toEqual([
      { filename: "Breaking.Bad.S02E01.ass", url: "http://file0.assrt.net/onthefly/713570/-/1/x.ass?api=1" },
      { filename: "Breaking.Bad.S02E02.ass", url: "http://file0.assrt.net/onthefly/713570/-/2/y.ass?api=1" },
    ]);
  });

  it("falls back to the whole-package zip when filelist is absent", async () => {
    const provider = new AssrtSubtitleProvider({
      token: "T",
      fetchJson: fakeFetch({
        "sub/detail": {
          status: 0,
          sub: { subs: [{ filename: "pack.zip", url: "http://file0.assrt.net/download/1/pack.zip?api=1" }] },
        },
      }),
    });
    expect(await provider.detail(1)).toEqual([
      { filename: "pack.zip", url: "http://file0.assrt.net/download/1/pack.zip?api=1" },
    ]);
  });

  it("returns [] on a malformed / error detail response", async () => {
    const provider = new AssrtSubtitleProvider({
      token: "T",
      fetchJson: fakeFetch({ "sub/detail": { status: 20001, errmsg: "invalid token" } }),
    });
    expect(await provider.detail(1)).toEqual([]);
  });
});

describe("AssrtSubtitleProvider.search — community-pick evidence fields", () => {
  it("carries vote_score / release_site / upload_time when the API sends them", async () => {
    const provider = new AssrtSubtitleProvider({
      token: "T",
      fetchJson: fakeFetch({
        "sub/search": {
          status: 0,
          sub: {
            subs: [
              {
                id: 5, videoname: "V", native_name: "N", lang: { desc: "简" },
                vote_score: 50, release_site: "YYeTs", upload_time: "2023-05-01 12:00:00",
              },
            ],
          },
        },
      }),
    });
    const out = await provider.search("k");
    expect(out[0]).toMatchObject({ voteScore: 50, releaseSite: "YYeTs", uploadTime: "2023-05-01 12:00:00" });
  });

  it("omits the evidence keys entirely when absent (keeps the lean shape)", async () => {
    const provider = new AssrtSubtitleProvider({
      token: "T",
      fetchJson: fakeFetch({
        "sub/search": { status: 0, sub: { subs: [{ id: 6, videoname: "V", native_name: "", lang: { desc: "" } }] } },
      }),
    });
    const out = await provider.search("k");
    expect(Object.keys(out[0]!).sort()).toEqual(["id", "lang", "title"]);
  });
});
