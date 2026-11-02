import { describe, it, expect, vi } from "vitest";
import type { Pan123Fetch } from "./pan123-client.js";
import {
  crc32,
  signPath,
  parsePan123Json,
  parsePan123Uid,
  isPan123AuthError,
  Pan123AuthError,
  Pan123Client,
} from "./pan123-client.js";

describe("crc32 (IEEE)", () => {
  it("matches the reference vector crc32('123') === 2286445522", () => {
    expect(crc32(Buffer.from("123"))).toBe(2286445522);
  });
  it("crc32('') is 0", () => {
    expect(crc32(Buffer.from(""))).toBe(0);
  });
});

describe("signPath", () => {
  it("returns {k,v}: k is a pure-digit string, v is `<ts>-<rand>-<sign>`", () => {
    const s = signPath("/b/api/share/get");
    expect(typeof s.k).toBe("string");
    expect(s.k).toMatch(/^\d+$/);
    expect(s.v).toMatch(/^\d+-\d+-\d+$/);
  });
});

/** Wrap a synchronous {status, body} handler into a typed Pan123Fetch mock.
 *  `body` may be a raw JSON STRING (to carry exact int64 digits — a JS number
 *  literal would already be rounded before the stub could stringify it, the very
 *  bug under test) or a plain object (small, safe values only). */
function fetchStub(
  handler: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    status: number;
    body: unknown;
  },
) {
  return vi.fn<Pan123Fetch>(async (url, init) => {
    const { status, body } = handler(url, init);
    return { status, text: typeof body === "string" ? body : JSON.stringify(body) };
  });
}

describe("parsePan123Json (bigint-safe)", () => {
  it("preserves 18/19-digit int64 ids as strings (JSON.parse would round them)", () => {
    const raw =
      '{"FileId":9007199254740993123,"ShareId":123456789012345678,"parent_file_id":924511245739356595,"Size":42}';
    const parsed = parsePan123Json(raw) as Record<string, unknown>;
    expect(parsed.FileId).toBe("9007199254740993123"); // string, exact
    expect(parsed.ShareId).toBe("123456789012345678");
    expect(parsed.parent_file_id).toBe("924511245739356595");
    expect(parsed.Size).toBe(42); // small numbers untouched
  });
  it("stringifies id fields with whitespace after the colon (formatting-independent)", () => {
    const parsed = parsePan123Json('{"FileId" : 9007199254740993123}') as Record<string, unknown>;
    expect(parsed.FileId).toBe("9007199254740993123");
  });
  it("returns null for non-JSON", () => {
    expect(parsePan123Json("<html>error</html>")).toBeNull();
  });
});

describe("parsePan123Uid", () => {
  it("extracts the numeric `id` from a JWT payload", () => {
    // synthetic JWT: header.payload.signature, payload = {"id":10086,"exp":9999999999}
    const b64url = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const token = `${b64url({ alg: "HS256" })}.${b64url({ id: 10086, exp: 9999999999 })}.sig`;
    expect(parsePan123Uid(token)).toBe("10086");
  });
  it("returns null for a non-JWT / empty string", () => {
    expect(parsePan123Uid("not-a-jwt")).toBeNull();
    expect(parsePan123Uid("")).toBeNull();
    expect(parsePan123Uid("  ")).toBeNull();
  });
});

describe("Pan123AuthError", () => {
  it("isPan123AuthError narrows only real Pan123AuthError instances", () => {
    expect(isPan123AuthError(new Pan123AuthError("x"))).toBe(true);
    expect(isPan123AuthError(new Error("x"))).toBe(false);
    expect(isPan123AuthError(null)).toBe(false);
  });
});

describe("Pan123Client transport / listFiles", () => {
  it("listFiles signs the request, sends Bearer token, and keeps int64 FileId as a string", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = fetchStub((url, init) => {
      calls.push({ url, headers: init.headers });
      return {
        status: 200,
        body:
          '{"code":0,"data":{"InfoList":[' +
          '{"FileId":100,"FileName":"Movies","Size":0,"Etag":"","Type":1},' +
          '{"FileId":9007199254740993123,"FileName":"a.mkv","Size":42,"Etag":"ETAGA","Type":0}' +
          '],"Next":"-1"}}',
      };
    });
    const c = new Pan123Client({ token: "TK", fetchImpl });
    const items = await c.listFiles("777");
    expect(calls[0]?.url).toContain("yun.123pan.com/b/api/file/list/new");
    expect(calls[0]?.url).toContain("parentFileId=777");
    expect(calls[0]?.url).toContain("trashed=false");
    expect(calls[0]?.headers.authorization).toBe("Bearer TK");
    expect(calls[0]?.headers.platform).toBe("web");
    expect(items).toEqual([
      { id: "100", name: "Movies", size: 0, etag: "", isFolder: true },
      { id: "9007199254740993123", name: "a.mkv", size: 42, etag: "ETAGA", isFolder: false },
    ]);
  });

  it("listFiles follows the `next` cursor across pages until Next is a stop sentinel", async () => {
    const nexts: string[] = [];
    const fetchImpl = fetchStub((url) => {
      const next = new URL(url).searchParams.get("next") ?? "";
      nexts.push(next);
      if (next === "0") {
        return { status: 200, body: '{"code":0,"data":{"InfoList":[{"FileId":1,"FileName":"p1","Size":1,"Etag":"E1","Type":0}],"Next":"55"}}' };
      }
      return { status: 200, body: '{"code":0,"data":{"InfoList":[{"FileId":2,"FileName":"p2","Size":2,"Etag":"E2","Type":0}],"Next":"-1"}}' };
    });
    const c = new Pan123Client({ token: "TK", fetchImpl });
    const items = await c.listFiles("0");
    expect(nexts).toEqual(["0", "55"]);
    expect(items.map((i) => i.name)).toEqual(["p1", "p2"]);
  });

  it("listFiles maxPages:1 sends exactly ONE request even when a next-page cursor exists (cheap probe)", async () => {
    // probeStorageConnection 契约是 cheap read:验活只需第一页,大账号不能付全量翻页
    // (至多 100 个串行签名往返)的代价。默认(不传 opts)行为不变=全量翻页。
    const nexts: string[] = [];
    const fetchImpl = fetchStub((url) => {
      const next = new URL(url).searchParams.get("next") ?? "";
      nexts.push(next);
      return {
        status: 200,
        body: '{"code":0,"data":{"InfoList":[{"FileId":1,"FileName":"p1","Size":1,"Etag":"E1","Type":0}],"Next":"55"}}',
      };
    });
    const c = new Pan123Client({ token: "TK", fetchImpl });
    const items = await c.listFiles("0", { maxPages: 1 });
    expect(nexts).toEqual(["0"]); // exactly one request despite Next="55"
    expect(items.map((i) => i.name)).toEqual(["p1"]); // first page still returned
  });

  it("throws Pan123AuthError on code===401 (dead token — no retry/refresh)", async () => {
    const fetchImpl = fetchStub(() => ({ status: 401, body: { code: 401, message: "tokens number has exceeded the limit" } }));
    const c = new Pan123Client({ token: "DEAD", fetchImpl });
    await expect(c.listFiles("0")).rejects.toBeInstanceOf(Pan123AuthError);
  });

  it("coerces a non-string token to \"\" — a malformed blob fails as a clean auth error, not a TypeError", async () => {
    // callers cast `credential` from unknown; a bad DB row can deliver token: number.
    const fetchImpl = fetchStub(() => ({ status: 401, body: { code: 401, message: "unauthorized" } }));
    const c = new Pan123Client({ token: 123 as unknown as string, fetchImpl });
    await expect(c.listFiles("0")).rejects.toBeInstanceOf(Pan123AuthError);
  });

  it("throws a generic (non-auth) Error on a non-zero business code (e.g. 5050)", async () => {
    const fetchImpl = fetchStub(() => ({ status: 200, body: { code: 5050, message: "size required" } }));
    const c = new Pan123Client({ token: "TK", fetchImpl });
    await expect(c.listFiles("0")).rejects.toThrow(/5050/);
    await c.listFiles("0").catch((e) => expect(isPan123AuthError(e)).toBe(false));
  });

  it("fails LOUD on a non-JSON HTTP-error body (never collapses a 500/WAF page into [])", async () => {
    const fetchImpl = fetchStub(() => ({ status: 500, body: "<html>gateway</html>" }));
    const c = new Pan123Client({ token: "TK", fetchImpl });
    await expect(c.listFiles("0")).rejects.toThrow(/PAN123_HTTP_FAILED/);
  });

  it("fails LOUD on HTTP 200 + a non-JSON body (WAF/challenge page must NOT become [])", async () => {
    // outage-as-empty 病:被墙/挑战页常回 HTTP 200 + HTML。null→{}→code=0→空成功 = 上游中断
    // 伪装成空目录。必须无条件 fail-loud,不看 status。
    const fetchImpl = fetchStub(() => ({ status: 200, body: "<html>blocked</html>" }));
    const c = new Pan123Client({ token: "TK", fetchImpl });
    await expect(c.listFiles("0")).rejects.toThrow(/PAN123_HTTP_FAILED/);
  });

  it("fails LOUD on HTTP 200 + JSON that is missing `code` (abnormal response, not code:0 empty success)", async () => {
    const fetchImpl = fetchStub(() => ({ status: 200, body: { ok: true } }));
    const c = new Pan123Client({ token: "TK", fetchImpl });
    await expect(c.listFiles("0")).rejects.toThrow(/PAN123_HTTP_FAILED/);
  });
});

describe("Pan123Client 转存链 (share/get → file/copy/async)", () => {
  it("lists the share top level, then copies with the four-piece file_list (event=transfer)", async () => {
    const seq: string[] = [];
    let copyBody: Record<string, unknown> = {};
    const fetchImpl = fetchStub((url, init) => {
      if (url.includes("/share/get")) {
        seq.push("get");
        expect(url).toContain("ShareKey=KEY1");
        expect(url).toContain("SharePwd=PWD1");
        return {
          status: 200,
          body:
            '{"code":0,"data":{"InfoList":[' +
            '{"FileId":9007199254740993001,"FileName":"S01E01.mkv","Size":1000000000,"Etag":"ETG","Type":0}' +
            "]}}",
        };
      }
      if (url.includes("/file/copy/async")) {
        seq.push("copy");
        copyBody = JSON.parse(init.body ?? "{}");
        return { status: 200, body: { code: 0, message: "" } };
      }
      throw new Error("unexpected " + url);
    });
    const c = new Pan123Client({ token: "TK", fetchImpl });
    const r = await c.saveShare({ shareKey: "KEY1", sharePwd: "PWD1", targetParentId: "888" });
    expect(r).toEqual({ ok: true, message: "" });
    expect(seq).toEqual(["get", "copy"]);
    expect(copyBody.share_key).toBe("KEY1");
    expect(copyBody.share_pwd).toBe("PWD1");
    expect(copyBody.current_level).toBe(1);
    expect(copyBody.event).toBe("transfer");
    const list = copyBody.file_list as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    // Four-piece REQUIRED: file_id + file_name + etag + size (missing size → code 5050),
    // plus parent_file_id + drive_id + type.
    expect(list[0]).toMatchObject({
      file_id: "9007199254740993001", // int64 kept as string
      file_name: "S01E01.mkv",
      etag: "ETG",
      size: 1000000000,
      parent_file_id: "888",
      drive_id: 0,
      type: 0,
    });
  });

  it("follows the share Next cursor: saveShare copies ALL pages (no >100 silent truncation)", async () => {
    // no-silent-caps:分享顶层 >100 个文件时,只转第 1 页 = 静默丢失。listShareDir 必须翻页。
    const nexts: string[] = [];
    let copyBody: Record<string, unknown> = {};
    const fetchImpl = fetchStub((url, init) => {
      if (url.includes("/share/get")) {
        const next = new URL(url).searchParams.get("next") ?? "";
        nexts.push(next);
        if (next === "0") {
          return {
            status: 200,
            body: '{"code":0,"data":{"InfoList":[{"FileId":9007199254740993001,"FileName":"A.mkv","Size":1,"Etag":"EA","Type":0}],"Next":"1"}}',
          };
        }
        return {
          status: 200,
          body: '{"code":0,"data":{"InfoList":[{"FileId":9007199254740993002,"FileName":"B.mkv","Size":2,"Etag":"EB","Type":0}],"Next":"-1"}}',
        };
      }
      if (url.includes("/file/copy/async")) {
        copyBody = JSON.parse(init.body ?? "{}");
        return { status: 200, body: { code: 0 } };
      }
      throw new Error("unexpected " + url);
    });
    const c = new Pan123Client({ token: "TK", fetchImpl });
    const r = await c.saveShare({ shareKey: "KEY", sharePwd: "", targetParentId: "0" });
    expect(r.ok).toBe(true);
    expect(nexts).toEqual(["0", "1"]); // both pages fetched
    const list = copyBody.file_list as Array<Record<string, unknown>>;
    expect(list.map((f) => f.file_name)).toEqual(["A.mkv", "B.mkv"]); // BOTH pages copied, not just page 1
  });

  it("returns ok:false (does NOT throw) for an empty / dead share", async () => {
    const fetchImpl = fetchStub((url) => {
      if (url.includes("/share/get")) return { status: 200, body: { code: 0, data: { InfoList: [] } } };
      throw new Error("must not attempt copy for an empty share: " + url);
    });
    const c = new Pan123Client({ token: "TK", fetchImpl });
    const r = await c.saveShare({ shareKey: "DEAD", sharePwd: "", targetParentId: "0" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/empty|dead|空/i);
  });
});

describe("Pan123Client directory write ops", () => {
  it("createFolder posts the upload_request body and returns the new int64 id as string", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = fetchStub((url, init) => {
      expect(url).toContain("/file/upload_request");
      body = JSON.parse(init.body ?? "{}");
      return { status: 200, body: '{"code":0,"data":{"Info":{"FileId":9007199254740993777}}}' };
    });
    const c = new Pan123Client({ token: "TK", fetchImpl });
    const id = await c.createFolder({ name: "Movies", parentId: "888" });
    expect(id).toBe("9007199254740993777");
    expect(body).toMatchObject({ driveId: 0, etag: "", fileName: "Movies", parentFileId: "888", size: 0, type: 1 });
  });

  it("trash posts fileTrashInfoList (FileId/FileName/Type) with event=intoRecycle", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = fetchStub((url, init) => {
      expect(url).toContain("/file/trash");
      body = JSON.parse(init.body ?? "{}");
      return { status: 200, body: { code: 0 } };
    });
    const c = new Pan123Client({ token: "TK", fetchImpl });
    await c.trash([
      { id: "9007199254740993777", name: "mediary-123-probe", isFolder: true },
      { id: "42", name: "ep.mkv", isFolder: false },
    ]);
    expect(body).toMatchObject({ driveId: 0, event: "intoRecycle", operation: true });
    expect(body.fileTrashInfoList).toEqual([
      { FileId: "9007199254740993777", FileName: "mediary-123-probe", Type: 1 },
      { FileId: "42", FileName: "ep.mkv", Type: 0 },
    ]);
  });

  it("trash omits FileName for a name-less entry (removeDirectory only has an id); Type stays correct", async () => {
    // removeDirectory hands trash a bare {id, isFolder:true} — no name. The
    // authoritative file/trash only needs FileId (FileName optional), so a
    // name-less entry must NOT ship an empty/undefined FileName key.
    let raw = "";
    const fetchImpl = fetchStub((url, init) => {
      expect(url).toContain("/file/trash");
      raw = init.body ?? "";
      return { status: 200, body: { code: 0 } };
    });
    const c = new Pan123Client({ token: "TK", fetchImpl });
    await c.trash([
      { id: "9007199254740993777", isFolder: true },
      { id: "42", name: "ep.mkv", isFolder: false },
    ]);
    const list = (JSON.parse(raw).fileTrashInfoList ?? []) as Array<Record<string, unknown>>;
    expect(Object.keys(list[0] ?? {}).sort()).toEqual(["FileId", "Type"]); // no FileName key at all
    expect(list[0]).toEqual({ FileId: "9007199254740993777", Type: 1 });
    expect(list[1]).toEqual({ FileId: "42", FileName: "ep.mkv", Type: 0 });
  });

  it("trash is a no-op for an empty entry list (no network call)", async () => {
    const fetchImpl = fetchStub(() => {
      throw new Error("must not call the network");
    });
    const c = new Pan123Client({ token: "TK", fetchImpl });
    await c.trash([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("moveFiles posts fileIdList ([{FileId}]) + parentFileId with event=fileMove", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = fetchStub((url, init) => {
      expect(url).toContain("/file/mod_pid");
      body = JSON.parse(init.body ?? "{}");
      return { status: 200, body: { code: 0 } };
    });
    const c = new Pan123Client({ token: "TK", fetchImpl });
    await c.moveFiles({ fileIds: ["9007199254740993001", "42"], targetParentId: "888" });
    expect(body).toMatchObject({ parentFileId: "888", event: "fileMove" });
    expect(body.fileIdList).toEqual([{ FileId: "9007199254740993001" }, { FileId: "42" }]);
  });

  it("moveFiles is a no-op for an empty fileIds list", async () => {
    const fetchImpl = fetchStub(() => {
      throw new Error("must not call the network");
    });
    const c = new Pan123Client({ token: "TK", fetchImpl });
    await c.moveFiles({ fileIds: [], targetParentId: "888" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("renameFile posts FileId/fileName with the fixed rename fields (driveId/duplicate/event)", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = fetchStub((url, init) => {
      expect(url).toContain("/file/rename");
      body = JSON.parse(init.body ?? "{}");
      return { status: 200, body: { code: 0 } };
    });
    const c = new Pan123Client({ token: "TK", fetchImpl });
    await c.renameFile({ fileId: "9007199254740993001", name: "S01E01.mkv" });
    expect(body).toEqual({
      FileId: "9007199254740993001",
      fileName: "S01E01.mkv",
      driveId: 0,
      duplicate: 0,
      event: "fileRename",
    });
  });
});
