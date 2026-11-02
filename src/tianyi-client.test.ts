import { describe, it, expect, vi } from "vitest";
import type { TianyiFetch, TianyiHttpInit } from "./tianyi-client.js";
import {
  parseTianyiJson,
  parseTianyiUid,
  isTianyiAuthError,
  TianyiAuthError,
  TianyiClient,
} from "./tianyi-client.js";

/** Wrap a synchronous {status, body} handler into a typed TianyiFetch mock
 *  returning {status, text}. `body` may be a raw JSON string (to carry exact
 *  int64 digits) or a plain object (small, safe values only). */
function fetchStub(
  handler: (url: string, init: TianyiHttpInit) => { status: number; body: unknown },
) {
  return vi.fn<TianyiFetch>(async (url, init) => {
    const { status, body } = handler(url, init);
    return { status, text: typeof body === "string" ? body : JSON.stringify(body) };
  });
}

describe("parseTianyiJson (bigint-safe)", () => {
  it("preserves 18-digit int64 ids as strings (JSON.parse would round them)", () => {
    // 924511245739356595 > Number.MAX_SAFE_INTEGER(9007199254740991); plain JSON.parse → ...600
    const raw =
      '{"fileId":924511245739356595,"shareId":123456789012345678,"taskId":987654321098765432,"name":"x","size":42}';
    const parsed = parseTianyiJson(raw) as Record<string, unknown>;
    expect(parsed.fileId).toBe("924511245739356595"); // string, exact
    expect(parsed.shareId).toBe("123456789012345678");
    expect(parsed.taskId).toBe("987654321098765432");
    expect(parsed.size).toBe(42); // small numbers untouched
  });
  it("stringifies nested id fields inside arrays", () => {
    const raw = '{"fileList":[{"id":924511245739356595,"md5":"AB","size":10}]}';
    const parsed = parseTianyiJson(raw) as { fileList: Array<Record<string, unknown>> };
    expect(parsed.fileList[0]?.id).toBe("924511245739356595");
  });
  it("preserves int64 ids even with whitespace/newlines around the colon (formatting-independent)", () => {
    // JSON permits whitespace after (and before) `:`; the guard must still fire or
    // JSON.parse would silently round the int64 — the exact root cause it prevents.
    const raw = '{\n  "fileId": 924511245739356595,\n  "shareId" : 123456789012345678,\n  "size": 42\n}';
    const parsed = parseTianyiJson(raw) as Record<string, unknown>;
    expect(parsed.fileId).toBe("924511245739356595");
    expect(parsed.shareId).toBe("123456789012345678");
    expect(parsed.size).toBe(42);
  });
  it("returns null for non-JSON", () => {
    expect(parseTianyiJson("<html>error</html>")).toBeNull();
  });
});

describe("parseTianyiUid", () => {
  it("returns the trimmed loginName", () => {
    expect(parseTianyiUid("  13800138000 ")).toBe("13800138000");
  });
  it("returns null for empty/blank", () => {
    expect(parseTianyiUid("")).toBeNull();
    expect(parseTianyiUid("   ")).toBeNull();
  });
});

describe("TianyiAuthError", () => {
  it("isTianyiAuthError narrows only real TianyiAuthError instances", () => {
    expect(isTianyiAuthError(new TianyiAuthError("x"))).toBe(true);
    expect(isTianyiAuthError(new Error("x"))).toBe(false);
    expect(isTianyiAuthError(null)).toBe(false);
  });
});

describe("TianyiClient WEB face", () => {
  it("listFiles(-11) puts sessionKey in query, merges folderList+fileList, keeps int64 id as string", async () => {
    const calls: string[] = [];
    // NOTE: response bodies with int64 ids are given as RAW JSON strings (exact
    // digits). A JS number literal like `id: 924511245739356595` would already be
    // rounded before the stub could stringify it — that's the very bug under test,
    // so the stub must emit the real bytes, not a corrupted JS number.
    const fetchImpl = fetchStub((url) => {
      calls.push(url);
      return {
        status: 200,
        body:
          '{"res_code":0,"fileListAO":{"folderList":[{"id":111222333444555666,"name":"Movies"}],' +
          '"fileList":[{"id":924511245739356595,"name":"a.mkv","size":42,"md5":"AB"}]}}',
      };
    });
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl });
    const items = await c.listFiles("-11");
    expect(calls[0]).toContain("sessionKey=SK");
    expect(calls[0]).toContain("folderId=-11");
    expect(calls[0]).toContain("noCach="); // R2: cache-bust on every WEB call
    expect(items).toEqual([
      { id: "111222333444555666", name: "Movies", size: 0, md5: "", isFolder: true },
      { id: "924511245739356595", name: "a.mkv", size: 42, md5: "AB", isFolder: false },
    ]);
  });

  it("rejects loudly on a non-JSON HTTP-error body (must NOT collapse a 502/WAF page into [])", async () => {
    // Upstream outage / gateway HTML must fail loud, never masquerade as an empty
    // directory — the TMDB-outage-as-empty bug this codebase was burned by.
    const fetchImpl = fetchStub(() => ({ status: 502, body: "<html>gateway timeout</html>" }));
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl });
    await expect(c.listFiles("-11")).rejects.toThrow(/TIANYI_HTTP_FAILED/);
  });

  it("self-heals a dead session: re-mints via getSessionForPC, persists creds, retries the call", async () => {
    const refreshed: unknown[] = [];
    let sessionMinted = false;
    const fetchImpl = fetchStub((url) => {
      if (url.includes("getSessionForPC")) {
        sessionMinted = true;
        return {
          status: 200,
          body: {
            res_code: 0,
            sessionKey: "SK2",
            accessToken: "AT2",
            refreshToken: "RT2",
            familySessionKey: "FSK2",
            loginName: "13800138000",
          },
        };
      }
      if (!sessionMinted) {
        // first WEB call: dead session
        return { status: 200, body: { res_code: "InvalidSessionKey", res_message: "userSessionBO is null" } };
      }
      // after re-mint: success
      return { status: 200, body: { res_code: 0, fileListAO: { folderList: [], fileList: [] } } };
    });
    const c = new TianyiClient({
      sessionKey: "SK",
      accessToken: "AT",
      refreshToken: "RT",
      fetchImpl,
      onCredentialRefresh: (creds) => {
        refreshed.push(creds);
      },
    });
    const items = await c.listFiles("-11");
    expect(items).toEqual([]);
    expect(refreshed).toEqual([
      { sessionKey: "SK2", accessToken: "AT2", refreshToken: "RT2", familySessionKey: "FSK2", loginName: "13800138000" },
    ]);
  });

  it("refreshes accessToken via refreshToken.do when getSessionForPC(accessToken) fails, then re-mints", async () => {
    const seq: string[] = [];
    let refreshedOnce = false;
    let sessionMinted = false;
    const fetchImpl = fetchStub((url) => {
      if (url.includes("getSessionForPC")) {
        seq.push("session");
        if (!refreshedOnce) {
          return { status: 200, body: { res_code: -1, res_message: "accessToken expired" } };
        }
        sessionMinted = true;
        return { status: 200, body: { res_code: 0, sessionKey: "SK3", accessToken: "AT3", refreshToken: "RT3" } };
      }
      if (url.includes("refreshToken.do")) {
        seq.push("refresh");
        refreshedOnce = true;
        return { status: 200, body: { accessToken: "AT3", refreshToken: "RT3", expiresIn: 604800 } };
      }
      if (!sessionMinted) {
        return { status: 200, body: { res_code: "InvalidSessionKey", res_message: "sessionKey invalid" } };
      }
      return { status: 200, body: { res_code: 0, fileListAO: { folderList: [], fileList: [] } } };
    });
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl });
    await c.listFiles("-11");
    expect(seq).toEqual(["session", "refresh", "session"]);
  });

  it("throws TianyiAuthError on InvalidSessionKey after a failed re-mint", async () => {
    const fetchImpl = fetchStub((url) => {
      if (url.includes("getSessionForPC")) return { status: 200, body: { res_code: -1, res_message: "refresh failed" } };
      if (url.includes("refreshToken.do")) return { status: 200, body: { res_code: -1, res_message: "refresh failed" } };
      return { status: 200, body: { res_code: "InvalidSessionKey", res_message: "sessionKey invalid" } };
    });
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl });
    await expect(c.listFiles("-11")).rejects.toBeInstanceOf(TianyiAuthError);
  });

  it("throws a generic (non-auth) Error on a non-zero business res_code", async () => {
    const fetchImpl = fetchStub(() => ({ status: 200, body: { res_code: "FileNotFound", res_message: "no such dir" } }));
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl });
    await expect(c.listFiles("-11")).rejects.toThrow(/FileNotFound/);
    await c.listFiles("-11").catch((e) => expect(isTianyiAuthError(e)).toBe(false));
  });

  it("dead-share ShareNotFound (shareUserRightcheck mentions sessionKey=null) is a DEAD LINK, not a session death", async () => {
    // Ground truth (live 2026-07-17, replayed against real cloud.189.cn with a
    // cancelled share): getShareInfoByCodeV2 returns res_code "ShareNotFound" with
    //   "shareUserRightcheck() - sessionKey=null, shareId=…, share not found or invalid. "
    // The greedy /sessionKey.*invalid/ used to span "sessionKey=null, … or invalid"
    // → misread a dead share as session-dead → pointless renew → TIANYI_AUTH_FAILED
    // (which the systemic-block vocabulary then treats as an ACCOUNT-level block).
    const calls: string[] = [];
    const fetchImpl = fetchStub((url) => {
      calls.push(url);
      if (url.includes("getSessionForPC") || url.includes("refreshToken.do")) {
        return { status: 200, body: { res_code: 0, sessionKey: "SK2", accessToken: "AT2", refreshToken: "RT2" } };
      }
      return {
        status: 200,
        body: {
          res_code: "ShareNotFound",
          res_message:
            "shareUserRightcheck() - sessionKey=null, shareId=99900011122233344, share not found or invalid. ",
        },
      };
    });
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl });
    await expect(c.getShareInfo("deadcode01")).rejects.toThrow(/ShareNotFound/);
    await c.getShareInfo("deadcode01").catch((e) => expect(isTianyiAuthError(e)).toBe(false));
    // A dead share must never trigger the session self-heal round-trip.
    expect(calls.some((u) => u.includes("getSessionForPC") || u.includes("refreshToken.do"))).toBe(false);
  });

  it("detects the errorCode/errorMsg auth envelope (HTTP 400 InvalidSessionKey / IP mismatch) and self-heals — never returns []", async () => {
    // Ground truth from real cloud.189.cn with an expired/IP-mismatched session:
    // HTTP 400 + {"errorCode":"InvalidSessionKey","errorMsg":"check ip error - curIp=…, cookiesIp=…"}
    // The auth envelope uses errorCode/errorMsg (NOT res_code/res_message). If unwrap
    // only read res_code, code=undefined → treated as success → listFiles returns [] →
    // a dead session masquerades as an EMPTY account (the fail-quiet class).
    const refreshed: unknown[] = [];
    let sessionMinted = false;
    const fetchImpl = fetchStub((url) => {
      if (url.includes("getSessionForPC")) {
        sessionMinted = true;
        return { status: 200, body: '{"res_code":0,"sessionKey":"SK2","accessToken":"AT2","refreshToken":"RT2"}' };
      }
      if (!sessionMinted) {
        return {
          status: 400,
          body: '{"errorCode":"InvalidSessionKey","errorMsg":"check ip error - curIp=1.2.3.4, cookiesIp=5.6.7.8","success":null}',
        };
      }
      return { status: 200, body: '{"res_code":0,"fileListAO":{"folderList":[{"id":111222333444555666,"name":"Movies"}],"fileList":[]}}' };
    });
    const c = new TianyiClient({
      sessionKey: "SK",
      accessToken: "AT",
      refreshToken: "RT",
      fetchImpl,
      onCredentialRefresh: (creds) => {
        refreshed.push(creds);
      },
    });
    const items = await c.listFiles("-11");
    expect(refreshed).toHaveLength(1); // renewSession actually fired
    expect(items).toEqual([{ id: "111222333444555666", name: "Movies", size: 0, md5: "", isFolder: true }]); // retried result, NOT []
  });

  it("throws TianyiAuthError (never []) when the HTTP-400 errorCode auth envelope persists and renew fails", async () => {
    const fetchImpl = fetchStub((url) => {
      if (url.includes("getSessionForPC")) return { status: 200, body: '{"res_code":-1,"res_message":"renew failed"}' };
      if (url.includes("refreshToken.do")) return { status: 200, body: '{"res_code":-1,"res_message":"refresh failed"}' };
      return { status: 400, body: '{"errorCode":"InvalidSessionKey","errorMsg":"check ip error - curIp=1.2.3.4","success":null}' };
    });
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl });
    await expect(c.listFiles("-11")).rejects.toBeInstanceOf(TianyiAuthError);
  });

  it("throws a loud non-auth error on an HTTP 400 with a non-auth errorCode (does not return [])", async () => {
    const fetchImpl = fetchStub(() => ({ status: 400, body: '{"errorCode":"FileNotFound","errorMsg":"no such dir","success":null}' }));
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl });
    await expect(c.listFiles("-11")).rejects.toThrow(/FileNotFound|status=400/);
    await c.listFiles("-11").catch((e) => expect(isTianyiAuthError(e)).toBe(false));
  });
});

describe("TianyiClient SHARE_SAVE chain", () => {
  it("resolves shareCode→shareId(int64 as string), lists share dir, submits SHARE_SAVE with stringified fileId, polls to status 4", async () => {
    const seq: string[] = [];
    // int64-bearing responses are RAW JSON strings so the exact digits survive.
    const raw = (text: string) => ({ status: 200, text });
    const fetchImpl = vi.fn<TianyiFetch>(async (url, init) => {
      if (url.includes("getShareInfoByCodeV2")) {
        seq.push("info");
        return raw('{"res_code":0,"shareId":123456789012345678,"fileId":924511245739356595,"shareMode":1,"needAccessCode":0}');
      }
      if (url.includes("listShareDir")) {
        seq.push("list");
        return raw(
          '{"res_code":0,"fileListAO":{"folderList":[],"fileList":[{"id":924511245739356595,"name":"S01E01.mkv","size":1000000000,"md5":"MD5A"}]}}',
        );
      }
      if (url.includes("createBatchTask")) {
        seq.push("create");
        const params = new URLSearchParams(init.body);
        const taskInfos = JSON.parse(params.get("taskInfos") ?? "[]");
        expect(taskInfos[0].fileId).toBe("924511245739356595"); // string, not rounded number
        expect(params.get("type")).toBe("SHARE_SAVE");
        expect(params.get("shareId")).toBe("123456789012345678");
        expect(params.get("targetFolderId")).toBe("-11");
        // R1: POST auth lives in the QUERY (probe-proven), NOT the body.
        expect(url).toContain("sessionKey=SK");
        expect(params.get("sessionKey")).toBeNull();
        // R2: cache-bust on the POST query too.
        expect(url).toContain("noCach=");
        return raw('{"res_code":0,"taskId":987654321098765432}');
      }
      if (url.includes("checkBatchTask")) {
        seq.push("check");
        return raw('{"res_code":0,"taskStatus":4,"successedCount":1,"failedCount":0}');
      }
      throw new Error("unexpected " + url);
    });
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl });
    const r = await c.saveShare({ shareCode: "abc123", accessCode: "", targetFolderId: "-11" });
    expect(r.ok).toBe(true);
    expect(r.failed).toBe(0);
    expect(seq).toEqual(["info", "list", "create", "check"]);
  });

  it("SHARE_SAVE with failedCount>0 reports partial failure (被和谐文件)", async () => {
    // int64-bearing responses are RAW JSON strings (exact digits) — never bare JS
    // number literals, which JS rounds before the stub could stringify them.
    const raw = (text: string) => ({ status: 200, text });
    const fetchImpl = vi.fn<TianyiFetch>(async (url) => {
      if (url.includes("getShareInfoByCodeV2"))
        return raw('{"res_code":0,"shareId":123456789012345678,"fileId":924511245739356595,"shareMode":1,"needAccessCode":0}');
      if (url.includes("listShareDir"))
        return raw('{"res_code":0,"fileListAO":{"folderList":[],"fileList":[{"id":924511245739356595,"name":"x.mkv","size":1000000000,"md5":"M"}]}}');
      if (url.includes("createBatchTask")) return raw('{"res_code":0,"taskId":987654321098765432}');
      if (url.includes("checkBatchTask")) return raw('{"res_code":0,"taskStatus":4,"successedCount":0,"failedCount":1}');
      throw new Error("unexpected " + url);
    });
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl });
    const r = await c.saveShare({ shareCode: "abc", accessCode: "", targetFolderId: "-11" });
    expect(r.ok).toBe(false);
    expect(r.failed).toBe(1);
    expect(r.message).toMatch(/和谐|被拦|1/);
  });

  it("resolves a taskStatus=2 conflict via getConflictTaskInfo→manageBatchTask(dealWay=1 忽略) then completes", async () => {
    const seq: string[] = [];
    let checks = 0;
    const raw = (text: string) => ({ status: 200, text });
    const fetchImpl = vi.fn<TianyiFetch>(async (url, init) => {
      if (url.includes("getShareInfoByCodeV2"))
        return raw('{"res_code":0,"shareId":123456789012345678,"fileId":924511245739356595,"shareMode":1,"needAccessCode":0}');
      if (url.includes("listShareDir"))
        return raw('{"res_code":0,"fileListAO":{"folderList":[],"fileList":[{"id":924511245739356595,"name":"x.mkv","size":1000000000,"md5":"M"}]}}');
      if (url.includes("createBatchTask")) return raw('{"res_code":0,"taskId":987654321098765432}');
      if (url.includes("getConflictTaskInfo")) {
        seq.push("conflict");
        return raw('{"res_code":0,"taskInfos":[{"fileId":924511245739356595,"fileName":"x.mkv","isFolder":0}],"targetFolderId":111222333444555666}');
      }
      if (url.includes("manageBatchTask")) {
        seq.push("manage");
        const p = new URLSearchParams(init.body);
        const tis = JSON.parse(p.get("taskInfos") ?? "[]");
        expect(tis[0].dealWay).toBe(1); // R3: probe adds BOTH dealWay:1 …
        expect(tis[0].isConflict).toBe(1); // R3: … AND isConflict:1
        expect(tis[0].fileId).toBe("924511245739356595");
        expect(p.get("targetFolderId")).toBe("111222333444555666"); // R3: from getConflictTaskInfo
        return raw('{"res_code":0}');
      }
      if (url.includes("checkBatchTask")) {
        checks += 1;
        return raw(`{"res_code":0,"taskStatus":${checks === 1 ? 2 : 4},"successedCount":1,"failedCount":0}`);
      }
      throw new Error("unexpected " + url);
    });
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl, sleepImpl: async () => {} });
    const r = await c.saveShare({ shareCode: "abc", accessCode: "", targetFolderId: "-11" });
    expect(r.ok).toBe(true);
    expect(seq).toEqual(["conflict", "manage"]);
  });

  it("returns ok:false for an empty / dead share (no files listed)", async () => {
    const raw = (text: string) => ({ status: 200, text });
    const fetchImpl = vi.fn<TianyiFetch>(async (url) => {
      if (url.includes("getShareInfoByCodeV2"))
        return raw('{"res_code":0,"shareId":123456789012345678,"fileId":924511245739356595,"shareMode":1,"needAccessCode":0}');
      if (url.includes("listShareDir")) return raw('{"res_code":0,"fileListAO":{"folderList":[],"fileList":[]}}');
      throw new Error("unexpected " + url);
    });
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl });
    const r = await c.saveShare({ shareCode: "dead", accessCode: "", targetFolderId: "-11" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/empty|dead|空/i);
  });
});

describe("TianyiClient directory write ops", () => {
  it("createFolder posts parentFolderId+folderName and returns the new int64 id as string", async () => {
    const fetchImpl = fetchStub((url, init) => {
      expect(url).toContain("createFolder.action");
      const p = new URLSearchParams(init.body);
      expect(p.get("parentFolderId")).toBe("-11");
      expect(p.get("folderName")).toBe("Movies");
      return { status: 200, body: '{"res_code":0,"id":111222333444555666}' };
    });
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl });
    expect(await c.createFolder({ name: "Movies", parentId: "-11" })).toBe("111222333444555666");
  });

  it("renameFile posts fileId+destFileName", async () => {
    const seen: Record<string, string | null> = {};
    const fetchImpl = fetchStub((url, init) => {
      expect(url).toContain("renameFile.action");
      const p = new URLSearchParams(init.body);
      seen.fileId = p.get("fileId");
      seen.name = p.get("destFileName");
      return { status: 200, body: { res_code: 0 } };
    });
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl });
    await c.renameFile({ fileId: "924511245739356595", name: "S01E01.mkv" });
    expect(seen).toEqual({ fileId: "924511245739356595", name: "S01E01.mkv" });
  });

  it("batchDelete sends probe-verified taskInfos ({fileId,fileName?,isFolder:1|0}) and polls to completion", async () => {
    const seq: string[] = [];
    let taskInfos = "";
    const fetchImpl = fetchStub((url, init) => {
      const p = new URLSearchParams(init.body);
      if (url.includes("createBatchTask")) {
        seq.push("create");
        expect(p.get("type")).toBe("DELETE");
        taskInfos = p.get("taskInfos") ?? "";
        return { status: 200, body: '{"res_code":0,"taskId":987654321098765432}' };
      }
      if (url.includes("checkBatchTask")) {
        seq.push("check");
        expect(p.get("type")).toBe("DELETE");
        return { status: 200, body: { res_code: 0, taskStatus: 4, failedCount: 0 } };
      }
      throw new Error("unexpected " + url);
    });
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl, sleepImpl: async () => {} });
    await c.batchDelete([
      { id: "924511245739356595", name: "mediary-tianyi-probe", isFolder: true },
      { id: "111", isFolder: false },
    ]);
    expect(seq).toEqual(["create", "check"]);
    // Probe ground truth (tianyi-save-bigint.mjs cleanup, line ~81): a FOLDER was
    // really deleted with {fileId, fileName, isFolder: 1}; isFolder: 0 killed nothing.
    expect(JSON.parse(taskInfos)).toEqual([
      { fileId: "924511245739356595", fileName: "mediary-tianyi-probe", isFolder: 1 },
      { fileId: "111", isFolder: 0 },
    ]);
  });

  it("batchDelete is a no-op for an empty entry list", async () => {
    const fetchImpl = fetchStub(() => {
      throw new Error("must not call the network");
    });
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl });
    await c.batchDelete([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("batchDelete THROWS when the DELETE task completes with failedCount>0 (never silent success)", async () => {
    const fetchImpl = fetchStub((url) => {
      if (url.includes("createBatchTask")) return { status: 200, body: '{"res_code":0,"taskId":987654321098765432}' };
      if (url.includes("checkBatchTask")) return { status: 200, body: { res_code: 0, taskStatus: 4, failedCount: 1 } };
      throw new Error("unexpected " + url);
    });
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl, sleepImpl: async () => {} });
    await expect(c.batchDelete([{ id: "9", isFolder: true }])).rejects.toThrow(/TIANYI_DELETE_FAILED/);
  });

  it("batchDelete THROWS on poll exhaustion (task never reaches status 4)", async () => {
    const fetchImpl = fetchStub((url) => {
      if (url.includes("createBatchTask")) return { status: 200, body: '{"res_code":0,"taskId":987654321098765432}' };
      if (url.includes("checkBatchTask")) return { status: 200, body: { res_code: 0, taskStatus: 1 } };
      throw new Error("unexpected " + url);
    });
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl, sleepImpl: async () => {} });
    await expect(c.batchDelete([{ id: "9", isFolder: true }])).rejects.toThrow(/TIANYI_DELETE_FAILED/);
  });

  it("moveFiles creates a MOVE batch task with {fileId,fileName?,isFolder} taskInfos to targetFolderId", async () => {
    let type = "";
    let target = "";
    let taskInfos = "";
    const fetchImpl = fetchStub((url, init) => {
      const p = new URLSearchParams(init.body);
      if (url.includes("createBatchTask")) {
        type = p.get("type") ?? "";
        target = p.get("targetFolderId") ?? "";
        taskInfos = p.get("taskInfos") ?? "";
        return { status: 200, body: '{"res_code":0,"taskId":987654321098765432}' };
      }
      if (url.includes("checkBatchTask")) return { status: 200, body: { res_code: 0, taskStatus: 4, failedCount: 0 } };
      throw new Error("unexpected " + url);
    });
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl, sleepImpl: async () => {} });
    await c.moveFiles({
      entries: [
        { id: "1", isFolder: false },
        { id: "2", name: "ep2.mkv", isFolder: false },
      ],
      targetFolderId: "-11",
    });
    expect(type).toBe("MOVE");
    expect(target).toBe("-11");
    expect(JSON.parse(taskInfos)).toEqual([
      { fileId: "1", isFolder: 0 },
      { fileId: "2", fileName: "ep2.mkv", isFolder: 0 },
    ]);
  });

  it("moveFiles THROWS when createBatchTask returns no taskId (a MOVE that never started must not look like success)", async () => {
    const fetchImpl = fetchStub((url) => {
      if (url.includes("createBatchTask")) return { status: 200, body: { res_code: 0 } };
      throw new Error("unexpected " + url);
    });
    const c = new TianyiClient({ sessionKey: "SK", accessToken: "AT", refreshToken: "RT", fetchImpl, sleepImpl: async () => {} });
    await expect(
      c.moveFiles({ entries: [{ id: "1", isFolder: false }], targetFolderId: "-11" }),
    ).rejects.toThrow(/TIANYI_MOVE_FAILED/);
  });
});
