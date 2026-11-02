import { describe, expect, it, vi } from "vitest";
import type { GuangYaFetch } from "./guangya-client.js";
import {
  GUANGYA_CLIENT_ID,
  GuangYaAuthError,
  GuangYaClient,
  isGuangYaAuthError,
  parseGuangYaUid,
} from "./guangya-client.js";

/** A typed mock fetch so `mock.calls` tuples are `[url, init]` under strict tsc. */
function mockFetch(impl: GuangYaFetch) {
  return vi.fn<GuangYaFetch>(impl);
}

const AUTH_HOST = "https://account.guangyapan.com";
const API_HOST = "https://api.guangyapan.com";

/** Build a fake JWT whose payload (2nd segment, base64url) carries `payload`. */
function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

/** A fetch-Response stub matching what GuangYaClient consumes (status + json()). */
function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const ACCESS = makeJwt({ sub: "aj6Qo5l86EF4O2AM" });
const REFRESH = "refresh-token-0";

describe("parseGuangYaUid", () => {
  it("extracts sub from a JWT payload", () => {
    expect(parseGuangYaUid(ACCESS)).toBe("aj6Qo5l86EF4O2AM");
  });

  it("returns null for a non-JWT string", () => {
    expect(parseGuangYaUid("not-a-jwt")).toBeNull();
  });
});

describe("GuangYaAuthError", () => {
  it("isGuangYaAuthError narrows the error", () => {
    expect(isGuangYaAuthError(new GuangYaAuthError("x"))).toBe(true);
    expect(isGuangYaAuthError(new Error("x"))).toBe(false);
  });
});

describe("GUANGYA_CLIENT_ID", () => {
  it("is the live-validated client id", () => {
    expect(GUANGYA_CLIENT_ID).toBe("aMe-8VSlkrbQXpUR");
  });
});

describe("GuangYaClient.validateToken", () => {
  it("GETs account/v1/user/me with Bearer and returns sub", async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(200, { sub: "aj6Qo5l86EF4O2AM", name: "Tester" }),
    );
    const client = new GuangYaClient({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      deviceId: "dev123",
      fetchImpl,
    });

    const sub = await client.validateToken();

    expect(sub).toBe("aj6Qo5l86EF4O2AM");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${AUTH_HOST}/v1/user/me`);
    expect((init as RequestInit).method ?? "GET").toBe("GET");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${ACCESS}`,
    });
  });

  it("throws when /user/me returns 200 but the body has no sub", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, { name: "Tester" }));
    const client = new GuangYaClient({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      deviceId: "dev123",
      fetchImpl,
    });

    await expect(client.validateToken()).rejects.toBeInstanceOf(GuangYaAuthError);
  });

  it("trims whitespace-padded tokens before they reach the Bearer header", async () => {
    // The credential extraction now hands over the raw stored blob, so the client
    // is the single place that sanitizes tokens (mirrors TianyiClient).
    const fetchImpl = mockFetch(async () => jsonResponse(200, { sub: "aj6Qo5l86EF4O2AM" }));
    const client = new GuangYaClient({
      accessToken: `  ${ACCESS}  `,
      refreshToken: `\t${REFRESH}\n`,
      deviceId: "dev123",
      fetchImpl,
    });

    await client.validateToken();

    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${ACCESS}`, // trimmed, not "Bearer   ACCESS  "
    });
  });
});

describe("GuangYaClient.listFiles", () => {
  it("sends Bearer+Did+Dt:4 to get_file_list and parses data.list (code is null)", async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(200, {
        code: null,
        msg: "success",
        data: {
          list: [
            {
              fileId: "f1",
              parentId: "p0",
              fileName: "a.mkv",
              fileSize: 100,
              resType: 1,
            },
          ],
        },
      }),
    );
    const client = new GuangYaClient({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      deviceId: "dev123",
      fetchImpl,
    });

    const items = await client.listFiles("p0");

    expect(items).toEqual([
      { fileId: "f1", parentId: "p0", fileName: "a.mkv", fileSize: 100, resType: 1 },
    ]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${API_HOST}/userres/v1/file/get_file_list`);
    const ri = init as RequestInit;
    expect(ri.method).toBe("POST");
    expect(ri.headers).toMatchObject({
      Authorization: `Bearer ${ACCESS}`,
      Did: "dev123",
      Dt: "4",
    });
    expect(JSON.parse(ri.body as string)).toEqual({
      parentId: "p0",
      page: 0,
      pageSize: 100,
      orderBy: 3,
      sortType: 1,
      fileTypes: [],
    });
  });
});

describe("GuangYaClient 401 -> refresh -> retry", () => {
  it("refreshes tokens on 401, retries once, and reports new tokens", async () => {
    const newAccess = makeJwt({ sub: "aj6Qo5l86EF4O2AM" });
    const newRefresh = "refresh-token-1";
    const fetchImpl = mockFetch(async (url: string) => {
      if (url === `${API_HOST}/userres/v1/file/get_file_list`) {
        // first call 401, second (after refresh) success
        if (fetchImpl.mock.calls.filter((c) => c[0] === url).length === 1) {
          return jsonResponse(401, { msg: "unauthorized" });
        }
        return jsonResponse(200, { code: null, msg: "success", data: { list: [] } });
      }
      if (url === `${AUTH_HOST}/v1/auth/token`) {
        return jsonResponse(200, {
          access_token: newAccess,
          refresh_token: newRefresh,
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const onTokensRefreshed = vi.fn();
    const client = new GuangYaClient({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      deviceId: "dev123",
      onTokensRefreshed,
      fetchImpl,
    });

    const items = await client.listFiles("p0");

    expect(items).toEqual([]);
    expect(onTokensRefreshed).toHaveBeenCalledWith({
      accessToken: newAccess,
      refreshToken: newRefresh,
      deviceId: "dev123",
    });
    // refresh body shape
    const refreshCall = fetchImpl.mock.calls.find((c) => c[0] === `${AUTH_HOST}/v1/auth/token`);
    expect(refreshCall).toBeDefined();
    expect(JSON.parse((refreshCall![1] as RequestInit).body as string)).toEqual({
      client_id: GUANGYA_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: REFRESH,
    });
    // retry used the refreshed access token
    const retryCall = fetchImpl.mock.calls.filter(
      (c) => c[0] === `${API_HOST}/userres/v1/file/get_file_list`,
    )[1]!;
    expect((retryCall[1] as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${newAccess}`,
    });
  });

  it("rejects with GuangYaAuthError when refresh fails", async () => {
    const fetchImpl = mockFetch(async (url: string) => {
      if (url === `${API_HOST}/userres/v1/file/get_file_list`) {
        return jsonResponse(401, { msg: "unauthorized" });
      }
      if (url === `${AUTH_HOST}/v1/auth/token`) {
        return jsonResponse(400, {
          error: "invalid_grant",
          error_description: "refresh token expired",
        });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const client = new GuangYaClient({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      deviceId: "dev123",
      fetchImpl,
    });

    await expect(client.listFiles("p0")).rejects.toBeInstanceOf(GuangYaAuthError);
  });
});

describe("GuangYaClient file ops", () => {
  it("createDir returns data.fileId", async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(200, { code: null, msg: "success", data: { fileId: "newdir" } }),
    );
    const client = new GuangYaClient({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      deviceId: "dev123",
      fetchImpl,
    });

    const fileId = await client.createDir("p0", "Movies");

    expect(fileId).toBe("newdir");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${API_HOST}/nd.bizuserres.s/v1/file/create_dir`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      parentId: "p0",
      dirName: "Movies",
    });
  });

  it("renameFile posts fileId+newName", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, { msg: "success", data: {} }));
    const client = new GuangYaClient({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      deviceId: "dev123",
      fetchImpl,
    });

    await client.renameFile("f1", "b.mkv");

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${API_HOST}/nd.bizuserres.s/v1/file/rename`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      fileId: "f1",
      newName: "b.mkv",
    });
  });

  it("deleteFiles posts fileIds[]", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, { msg: "success", data: {} }));
    const client = new GuangYaClient({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      deviceId: "dev123",
      fetchImpl,
    });

    await client.deleteFiles(["f1", "f2"]);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${API_HOST}/nd.bizuserres.s/v1/file/delete_file`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      fileIds: ["f1", "f2"],
    });
  });

  it("moveFiles posts fileIds[]+parentId", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, { msg: "success", data: {} }));
    const client = new GuangYaClient({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      deviceId: "dev123",
      fetchImpl,
    });

    await client.moveFiles(["f1"], "p2");

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${API_HOST}/nd.bizuserres.s/v1/file/move_file`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      fileIds: ["f1"],
      parentId: "p2",
    });
  });
});

describe("GuangYaClient offline ops", () => {
  it("resolveRes posts url and returns data", async () => {
    const data = {
      resType: 2,
      url: "magnet:?xt=urn:btih:abc",
      btResInfo: {
        infoHash: "abc",
        fileName: "Show",
        subfiles: [{ fileName: "ep1.mkv", fileIndex: 0, fileSize: 100 }],
      },
    };
    const fetchImpl = mockFetch(async () => jsonResponse(200, { code: null, msg: "success", data }));
    const client = new GuangYaClient({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      deviceId: "dev123",
      fetchImpl,
    });

    const result = await client.resolveRes("magnet:?xt=urn:btih:abc");

    expect(result).toEqual(data);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${API_HOST}/cloudcollection/v1/resolve_res`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      url: "magnet:?xt=urn:btih:abc",
    });
  });

  it("createTask posts {url,parentId,newName,fileIndexes?} and returns taskId", async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(200, { msg: "success", data: { taskId: "t1" } }),
    );
    const client = new GuangYaClient({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      deviceId: "dev123",
      fetchImpl,
    });

    const taskId = await client.createTask({
      url: "magnet:?xt=urn:btih:abc",
      parentId: "p0",
      newName: "Show",
      fileIndexes: [0, 1],
    });

    expect(taskId).toBe("t1");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${API_HOST}/cloudcollection/v1/create_task`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      url: "magnet:?xt=urn:btih:abc",
      parentId: "p0",
      newName: "Show",
      fileIndexes: [0, 1],
    });
  });

  it("listTask posts taskIds[] and returns data.list", async () => {
    const tasks = [{ taskId: "t1", status: 2, progress: 100, fileId: "f9" }];
    const fetchImpl = mockFetch(async () =>
      jsonResponse(200, { code: null, msg: "success", data: { list: tasks } }),
    );
    const client = new GuangYaClient({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      deviceId: "dev123",
      fetchImpl,
    });

    const result = await client.listTask(["t1"]);

    expect(result).toEqual(tasks);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${API_HOST}/cloudcollection/v1/list_task`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      taskIds: ["t1"],
    });
  });
});

describe("GuangYaClient deviceId", () => {
  it("auto-generates a 32 hex deviceId when empty", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, { msg: "success", data: { list: [] } }));
    const client = new GuangYaClient({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      fetchImpl,
    });

    await client.listFiles("p0");

    const did = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(did.Did).toMatch(/^[0-9a-f]{32}$/);
  });
});
