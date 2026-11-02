import { describe, expect, it } from "vitest";
import {
  isQuarkAuthError,
  parseQuarkUid,
  QuarkAuthError,
  QuarkCookieClient,
} from "../src/index.js";

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** Records every request and returns the result of `handler` (a canned response). */
function record(
  requests: RecordedRequest[],
  handler: (url: string) => Promise<unknown>,
): (url: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string }) => Promise<unknown> {
  return async (url, init) => {
    requests.push({ url, method: init.method, headers: init.headers, body: init.body ?? "" });
    return handler(url);
  };
}

describe("QuarkCookieClient", () => {
  it("lists directory items from file/sort (data.list passthrough)", async () => {
    const requests: RecordedRequest[] = [];
    const client = new QuarkCookieClient({
      cookie: "__uid=u",
      fetchJson: record(requests, async () => ({
        code: 0,
        message: "ok",
        data: { list: [{ fid: "f1", file_name: "a.mkv", dir: false, size: 100 }] },
      })),
    });

    const items = await client.listItems({ directoryId: "root_dir" });

    expect(items).toEqual([{ fid: "f1", file_name: "a.mkv", dir: false, size: 100 }]);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toContain("/1/clouddrive/file/sort");
    expect(requests[0]?.url).toContain("pdir_fid=root_dir");
    expect(requests[0]?.headers["Referer"]).toBe("https://pan.quark.cn/");
    expect(requests[0]?.headers["Cookie"]).toBe("__uid=u");
  });

  it("createFolder posts to /file and returns the new fid", async () => {
    const requests: RecordedRequest[] = [];
    const client = new QuarkCookieClient({
      cookie: "__uid=u",
      fetchJson: record(requests, async () => ({ code: 0, data: { fid: "NEW" } })),
    });

    await expect(client.createFolder({ name: "X", parentId: "P" })).resolves.toBe("NEW");
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toContain("/1/clouddrive/file?");
    expect(JSON.parse(requests[0]!.body)).toEqual({
      pdir_fid: "P",
      file_name: "X",
      dir_path: "",
      dir_init_lock: false,
    });
  });

  it("getShareToken returns data.stoken", async () => {
    const client = new QuarkCookieClient({
      cookie: "__uid=u",
      fetchJson: async () => ({ code: 0, data: { stoken: "ST" } }),
    });
    await expect(client.getShareToken({ pwd_id: "p", passcode: "" })).resolves.toBe("ST");
  });

  it("getShareToken on code 41006 → fail-loud generic error carrying the message", async () => {
    const client = new QuarkCookieClient({
      cookie: "__uid=u",
      fetchJson: async () => ({ code: 41006, message: "分享不存在" }),
    });
    let caught: unknown;
    try {
      await client.getShareToken({ pwd_id: "x", passcode: "" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("分享不存在");
    expect(isQuarkAuthError(caught)).toBe(false); // 41006 is NOT auth failure
  });

  it("listShareDetail returns share files (fid + share_fid_token)", async () => {
    const requests: RecordedRequest[] = [];
    const client = new QuarkCookieClient({
      cookie: "__uid=u",
      fetchJson: record(requests, async () => ({
        code: 0,
        data: { list: [{ fid: "sf", share_fid_token: "sft", file_name: "m.mkv", dir: false, size: 5 }] },
      })),
    });

    const list = await client.listShareDetail({ pwd_id: "p", stoken: "s", pdirFid: "0" });

    expect(list).toEqual([{ fid: "sf", share_fid_token: "sft", file_name: "m.mkv", dir: false, size: 5 }]);
    expect(requests[0]?.url).toContain("/1/clouddrive/share/sharepage/detail");
    expect(requests[0]?.url).toContain("pwd_id=p");
    expect(requests[0]?.url).toContain("stoken=s");
    expect(requests[0]?.url).toContain("pdir_fid=0");
  });

  it("saveShare posts the share/save body and returns data.task_id", async () => {
    const requests: RecordedRequest[] = [];
    const client = new QuarkCookieClient({
      cookie: "__uid=u",
      fetchJson: record(requests, async () => ({ code: 0, data: { task_id: "T1" } })),
    });

    await expect(
      client.saveShare({
        fid_list: ["a"],
        fid_token_list: ["t"],
        to_pdir_fid: "dst",
        pwd_id: "p",
        stoken: "s",
      }),
    ).resolves.toBe("T1");
    expect(requests[0]?.url).toContain("/1/clouddrive/share/sharepage/save");
    expect(JSON.parse(requests[0]!.body)).toEqual({
      fid_list: ["a"],
      fid_token_list: ["t"],
      to_pdir_fid: "dst",
      pwd_id: "p",
      stoken: "s",
      pdir_fid: "0",
      scene: "link",
    });
  });

  it("pollTask resolves true once data.status===2 (polling)", async () => {
    let calls = 0;
    const client = new QuarkCookieClient({
      cookie: "__uid=u",
      sleep: async () => {},
      fetchJson: async () => ({ code: 0, data: { status: calls++ < 2 ? 0 : 2 } }),
    });
    await expect(client.pollTask("T1")).resolves.toBe(true);
    expect(calls).toBe(3);
  });

  it("pollTask returns false if status never reaches 2 within maxAttempts", async () => {
    const client = new QuarkCookieClient({
      cookie: "__uid=u",
      sleep: async () => {},
      fetchJson: async () => ({ code: 0, data: { status: 0 } }),
    });
    await expect(client.pollTask("T1", { maxAttempts: 3 })).resolves.toBe(false);
  });

  it("deleteFiles posts file/delete with action_type 2, then polls the task", async () => {
    const requests: RecordedRequest[] = [];
    const client = new QuarkCookieClient({
      cookie: "__uid=u",
      sleep: async () => {},
      // shared response: the delete returns task_id, the subsequent poll reads status 2
      fetchJson: record(requests, async () => ({ code: 0, data: { task_id: "D", status: 2 } })),
    });
    await client.deleteFiles(["f1", "f2"]);
    expect(requests[0]?.url).toContain("/1/clouddrive/file/delete");
    expect(JSON.parse(requests[0]!.body)).toEqual({
      action_type: 2,
      filelist: ["f1", "f2"],
      exclude_fids: [],
    });
    expect(requests.some((r) => r.url.includes("/1/clouddrive/task"))).toBe(true); // polled
  });

  it("moveFiles posts file/move, then polls the task to completion", async () => {
    const requests: RecordedRequest[] = [];
    const client = new QuarkCookieClient({
      cookie: "__uid=u",
      sleep: async () => {},
      fetchJson: record(requests, async () => ({ code: 0, data: { task_id: "M", status: 2 } })),
    });
    await client.moveFiles({ fids: ["f1"], to: "dst" });
    expect(requests[0]?.url).toContain("/1/clouddrive/file/move");
    expect(JSON.parse(requests[0]!.body)).toMatchObject({ filelist: ["f1"], to_pdir_fid: "dst" });
    expect(requests.some((r) => r.url.includes("/1/clouddrive/task"))).toBe(true); // polled
  });

  it("renameFile posts file/rename", async () => {
    const requests: RecordedRequest[] = [];
    const client = new QuarkCookieClient({
      cookie: "__uid=u",
      fetchJson: record(requests, async () => ({ code: 0, data: {} })),
    });
    await client.renameFile({ fid: "f1", name: "new.mkv" });
    expect(requests[0]?.url).toContain("/1/clouddrive/file/rename");
    expect(JSON.parse(requests[0]!.body)).toEqual({ fid: "f1", file_name: "new.mkv" });
  });

  it("getFileInfo returns fid/name/pdir_fid/dir for ancestry walks", async () => {
    const requests: RecordedRequest[] = [];
    const client = new QuarkCookieClient({
      cookie: "__uid=u",
      fetchJson: record(requests, async () => ({
        code: 0,
        data: { fid: "F", file_name: "Season 1", pdir_fid: "PARENT", dir: true },
      })),
    });
    await expect(client.getFileInfo("F")).resolves.toEqual({
      fid: "F",
      file_name: "Season 1",
      pdir_fid: "PARENT",
      dir: true,
    });
    expect(requests[0]?.url).toContain("/1/clouddrive/file/info");
    expect(requests[0]?.url).toContain("fid=F");
  });

  it("a dead cookie (code 31001 / require login) → QuarkAuthError", async () => {
    const client = new QuarkCookieClient({
      cookie: "__uid=dead",
      fetchJson: async () => ({ status: 401, code: 31001, message: "require login [guest]" }),
    });
    await expect(client.listItems({ directoryId: "x" })).rejects.toThrowError(QuarkAuthError);
  });

  it("a non-auth failure → generic Error, not QuarkAuthError", async () => {
    const client = new QuarkCookieClient({
      cookie: "__uid=u",
      fetchJson: async () => ({ code: 32003, message: "参数错误" }),
    });
    let caught: unknown;
    try {
      await client.listItems({ directoryId: "x" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(isQuarkAuthError(caught)).toBe(false);
  });

  it("isQuarkAuthError narrows correctly", () => {
    expect(isQuarkAuthError(new QuarkAuthError("x"))).toBe(true);
    expect(isQuarkAuthError(new Error("x"))).toBe(false);
    expect(isQuarkAuthError(null)).toBe(false);
  });

  it("parseQuarkUid extracts __uid, falls back to __kps, else null", () => {
    expect(parseQuarkUid("foo=1; __uid=ABC123; __kps=XYZ")).toBe("ABC123");
    expect(parseQuarkUid("__kps=KPSONLY; bar=2")).toBe("KPSONLY");
    expect(parseQuarkUid("nope=1")).toBeNull();
  });

  it("requires a cookie", () => {
    expect(() => new QuarkCookieClient({ cookie: "" })).toThrow("QUARK_COOKIE is required");
  });
});
