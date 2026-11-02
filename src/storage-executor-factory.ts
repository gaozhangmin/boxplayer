/**
 * Build a protected StorageExecutor for a drive's brand. Replaces the worker's
 * old "assume 115" path: dispatch is by `connected_storages.provider`, so a 115
 * drive and a quark drive under the same account each get the right executor with
 * their own write scope (the drive's category CIDs).
 *
 * Lives here (not in storage-brands.ts) because building the 115 executor pulls
 * in env/protected-wrapper concerns the brand-identity registry must stay free of.
 */
import { GuangYaClient } from "./guangya-client.js";
import type { GuangYaClientOptions } from "./guangya-client.js";
import { GuangYaStorageExecutor } from "./guangya-storage-executor.js";
import { createProtectedPan115CookieStorageExecutorFromEnv } from "./pan115-storage-factory.js";
import { Pan123Client } from "./pan123-client.js";
import type { Pan123Credential } from "./pan123-client.js";
import { Pan123StorageExecutor } from "./pan123-storage-executor.js";
import type { StorageExecutor } from "./ports.js";
import { QuarkCookieClient } from "./quark-cookie-client.js";
import { QuarkStorageExecutor } from "./quark-storage-executor.js";
import { TianyiClient } from "./tianyi-client.js";
import type { TianyiClientOptions, TianyiCredential } from "./tianyi-client.js";
import { TianyiStorageExecutor } from "./tianyi-storage-executor.js";

export function createExecutorForBrand(input: {
  provider: string;
  /** Cookie credential for cookie-auth brands (115/夸克). Optional now that 光鸭
   *  authenticates with a token blob instead — pass `credential` for those. */
  cookie?: string;
  /** Opaque credential blob for token-auth brands (光鸭: {accessToken,refreshToken,deviceId};
   *  天翼: {sessionKey,accessToken,refreshToken,familySessionKey?}; 123: {token}). */
  credential?: unknown;
  /** The drive's write-scope directory ids (rootCid + Movies/TV/Anime). */
  scopeCids: string[];
  /** Base env for the 115 executor (guard pacing etc); defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Persist hook for refreshed token-auth credentials (光鸭 refresh rotates tokens;
   *  天翼 session 自愈轮换 sessionKey/accessToken). */
  onCredentialRefresh?: (creds: unknown) => void | Promise<void>;
}): StorageExecutor {
  if (input.provider === "pan115") {
    const cookie = input.cookie ?? "";
    const env = {
      ...(input.env ?? process.env),
      PAN115_COOKIE: cookie,
      ...(input.scopeCids.length > 0 ? { MEDIA_TRACK_115_WRITE_SCOPE_CIDS: input.scopeCids.join(",") } : {}),
    };
    return createProtectedPan115CookieStorageExecutorFromEnv({ env });
  }
  if (input.provider === "quark") {
    return new QuarkStorageExecutor({
      client: new QuarkCookieClient({ cookie: input.cookie ?? "" }),
      writeScopeDirectoryIds: input.scopeCids,
    });
  }
  if (input.provider === "guangya") {
    const c = (input.credential ?? {}) as {
      accessToken?: string;
      refreshToken?: string;
      deviceId?: string;
    };
    // Build options without ever setting optional keys to `undefined`
    // (exactOptionalPropertyTypes forbids it).
    const clientOptions: GuangYaClientOptions = {
      accessToken: c.accessToken ?? "",
      refreshToken: c.refreshToken ?? "",
    };
    if (c.deviceId !== undefined) {
      clientOptions.deviceId = c.deviceId;
    }
    const onRefresh = input.onCredentialRefresh;
    if (onRefresh) {
      clientOptions.onTokensRefreshed = (t) => onRefresh(t);
    }
    return new GuangYaStorageExecutor({
      client: new GuangYaClient(clientOptions),
      writeScopeDirectoryIds: input.scopeCids,
    });
  }
  if (input.provider === "pan123") {
    const c = (input.credential ?? {}) as Partial<Pan123Credential>;
    // 纯 token 模型:v1 无凭证刷新(web 面无 refresh 端点,401 → Pan123AuthError
    // → registry isAuthError 冻结重扫),故不接 onCredentialRefresh。
    return new Pan123StorageExecutor({
      client: new Pan123Client({ token: c.token ?? "" }),
      writeScopeDirectoryIds: input.scopeCids,
    });
  }
  if (input.provider === "tianyi") {
    const c = (input.credential ?? {}) as Partial<TianyiCredential>;
    // Same exactOptionalPropertyTypes discipline as guangya: never set optional
    // keys to `undefined`.
    const clientOptions: TianyiClientOptions = {
      sessionKey: c.sessionKey ?? "",
      accessToken: c.accessToken ?? "",
      refreshToken: c.refreshToken ?? "",
    };
    if (c.familySessionKey !== undefined) {
      clientOptions.familySessionKey = c.familySessionKey;
    }
    const onRefresh = input.onCredentialRefresh;
    if (onRefresh) {
      clientOptions.onCredentialRefresh = (creds) => onRefresh(creds);
    }
    return new TianyiStorageExecutor({
      client: new TianyiClient(clientOptions),
      writeScopeDirectoryIds: input.scopeCids,
    });
  }
  throw new Error(`unknown storage brand: ${input.provider}`);
}
