import {
  createProtectedStorage115Executor,
  Storage115Executor,
  type Pan115ApiGuard,
  type Pan115ApiGuardOptions,
} from "./storage-115-executor.js";
import {
  Pan115CookieClient,
  type Pan115CookieClientOptions,
  type Pan115FetchJson,
} from "./pan115-cookie-client.js";

export interface ProtectedPan115CookieStorageExecutorFromEnvOptions {
  env?: Record<string, string | undefined>;
  fetchJson?: Pan115FetchJson;
  apiGuard?: Pan115ApiGuard;
  apiGuardOptions?: Pan115ApiGuardOptions;
  listLimit?: number;
}

export function createProtectedPan115CookieStorageExecutorFromEnv(
  options: ProtectedPan115CookieStorageExecutorFromEnvOptions = {},
): Storage115Executor {
  const env = options.env ?? process.env;
  const clientOptions: Pan115CookieClientOptions = {
    cookie: env["PAN115_COOKIE"] ?? "",
  };
  if (options.fetchJson !== undefined) {
    clientOptions.fetchJson = options.fetchJson;
  }
  if (options.listLimit !== undefined) {
    clientOptions.listLimit = options.listLimit;
  }
  const api = new Pan115CookieClient(clientOptions);
  const executorOptions: Parameters<typeof createProtectedStorage115Executor>[0] = {
    api,
    env,
  };
  if (options.apiGuard !== undefined) {
    executorOptions.apiGuard = options.apiGuard;
  }
  if (options.apiGuardOptions !== undefined) {
    executorOptions.apiGuardOptions = options.apiGuardOptions;
  }
  return createProtectedStorage115Executor(executorOptions);
}

/**
 * Bootstrap 115 executor with an EMPTY write scope = unrestricted writes. ONLY for
 * the connect-time `provisionCategoryDirs` bootstrap — find-or-create of the media
 * tree (`Mediary Scout/{Movies,TV,Anime}`) under the 115 account root.
 *
 * The protected factory REQUIRES a write scope, but a fresh drive's scope is meant
 * to come FROM the provisioned dirs → catch-22 (115 drives stuck "目录待建"). This
 * variant breaks it, mirroring Quark's `QuarkStorageExecutor({writeScopeDirectoryIds:[]})`.
 * Bounded + idempotent (find-or-create, no deletes); steady-state acquisition always
 * uses a scoped executor built from the drive's provisioned CIDs.
 */
export function createBootstrapPan115CookieStorageExecutor(options: {
  cookie: string;
  env?: Record<string, string | undefined>;
  fetchJson?: Pan115FetchJson;
}): Storage115Executor {
  const env = options.env ?? process.env;
  const clientOptions: Pan115CookieClientOptions = { cookie: options.cookie };
  if (options.fetchJson !== undefined) {
    clientOptions.fetchJson = options.fetchJson;
  }
  const api = new Pan115CookieClient(clientOptions);
  const minDelayMs = Number(env["MEDIA_TRACK_115_MIN_DELAY_MS"]);
  const maxCalls = Number(env["MEDIA_TRACK_115_MAX_API_CALLS"]);
  return new Storage115Executor({
    api,
    writeScopeDirectoryIds: [],
    apiGuardOptions: {
      minDelayMs: Number.isFinite(minDelayMs) && minDelayMs > 0 ? minDelayMs : 1_200,
      // HARD limit (default 300, env-overridable) — kept in sync with
      // createProtectedStorage115Executor; the agent's SOFT warning is derived from it.
      maxCallsPerOperation: Number.isFinite(maxCalls) && maxCalls > 0 ? maxCalls : 300,
      maxListItemsPerResponse: 1_000,
    },
  });
}
