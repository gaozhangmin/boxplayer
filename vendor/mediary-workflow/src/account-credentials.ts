/**
 * Pure decision logic for §7 multi-account storage binding + category directory
 * provisioning. No I/O here — the Postgres repository (binding) and the real 115
 * storage adapter (dir provisioning) inject their effects. Keeping the rules pure
 * keeps the instance-wide uniqueness invariant and the idempotent find-or-create
 * testable without a database or a live 网盘.
 */
import { DEFAULT_ACCOUNT_ID } from "./domain.js";

export interface ConnectedStorageRow {
  id: string;
  accountId: string;
  provider: string;
  providerUid: string;
}

/** A local account (identity). password_hash empty for the implicit default
 *  account in single-user mode (no login). */
export interface Account {
  id: string;
  username: string;
  passwordHash: string;
  groupId: string | null;
  isOwner: boolean;
  createdAt: string;
}

/** A login session row; the signed httpOnly cookie carries its id. */
export interface Session {
  id: string;
  accountId: string;
  expiresAt: string;
  createdAt: string;
}

/** A network drive bound to an account (full persisted shape). */
export interface ConnectedStorage {
  id: string;
  accountId: string;
  provider: string;
  providerUid: string;
  label: string | null;
  /** Opaque per-provider credentials, e.g. { cookie, cookieMeta, app, userName }. */
  payload: unknown;
  rootCid: string | null;
  moviesCid: string | null;
  tvCid: string | null;
  animeCid: string | null;
  /** active = usable; frozen = cookie died (e.g. logged in elsewhere) → no
   *  acquisition and no patrol run for this drive until re-bound to the same uid.
   *  Data is never lost while frozen. */
  status: "active" | "frozen";
  frozenReason: string | null;
  frozenAt: string | null;
  createdAt: string;
}

/** Upsert payload — nullable directory CIDs are optional at call sites. */
export interface UpsertConnectedStorageInput {
  id: string;
  accountId: string;
  provider: string;
  providerUid: string;
  label?: string | null;
  payload: unknown;
  rootCid?: string | null;
  moviesCid?: string | null;
  tvCid?: string | null;
  animeCid?: string | null;
  createdAt: string;
}

export type StorageBindingDecision =
  | { action: "insert" }
  | { action: "refresh"; storageId: string }
  | { action: "reject"; ownerAccountId: string };

/**
 * Enforce instance-wide UNIQUE(provider, provider_uid):
 * - unseen (provider, uid)        → insert a new connection
 * - already owned by this account → refresh (re-scan updates the cookie payload)
 * - owned by another account      → reject (never let two accounts bind one 网盘)
 */
export function resolveStorageBinding(input: {
  provider: string;
  providerUid: string;
  accountId: string;
  existing: ConnectedStorageRow | null;
}): StorageBindingDecision {
  const { existing, accountId } = input;
  if (!existing) {
    return { action: "insert" };
  }
  if (existing.accountId === accountId) {
    return { action: "refresh", storageId: existing.id };
  }
  return { action: "reject", ownerAccountId: existing.accountId };
}

export interface DirProvisionStorage {
  listChildDirs(parentId: string): Promise<Array<{ name: string; id: string }>>;
  createDirectory(input: { name: string; parentId: string }): Promise<string>;
}

export interface ProvisionedCids {
  rootCid: string;
  moviesCid: string;
  tvCid: string;
  animeCid: string;
}

/**
 * Idempotent: reuse a same-named directory if one already exists under the
 * parent, else create it. Safe to re-run on an already-provisioned 网盘 (the
 * second run finds every dir and creates nothing).
 *
 * Directory names are customisable (rootName / moviesName / tvName / animeName).
 * A blank or whitespace-only name falls back to its brand default — in
 * particular the root ALWAYS resolves to a real container folder, never to the
 * account root, so the drive's write scope can never widen to the whole account.
 */
export async function provisionCategoryDirs(input: {
  storage: DirProvisionStorage;
  baseParentId: string;
  rootName?: string;
  moviesName?: string;
  tvName?: string;
  animeName?: string;
}): Promise<ProvisionedCids> {
  const named = (value: string | undefined, fallback: string) => value?.trim() || fallback;
  const rootName = named(input.rootName, "Mediary Scout");
  const moviesName = named(input.moviesName, "Movies");
  const tvName = named(input.tvName, "TV");
  const animeName = named(input.animeName, "Anime");
  const findOrCreate = async (name: string, parentId: string): Promise<string> => {
    const existing = (await input.storage.listChildDirs(parentId)).find((dir) => dir.name === name);
    return existing ? existing.id : input.storage.createDirectory({ name, parentId });
  };
  const rootCid = await findOrCreate(rootName, input.baseParentId);
  const moviesCid = await findOrCreate(moviesName, rootCid);
  const tvCid = await findOrCreate(tvName, rootCid);
  const animeCid = await findOrCreate(animeName, rootCid);
  return { rootCid, moviesCid, tvCid, animeCid };
}

/** Extract the stable 115 user id from a cookie string (`UID=<digits>_...`). */
export function parsePan115Uid(cookie: string): string | null {
  const match = /(?:^|;|\s)UID=(\d+)/.exec(cookie);
  return match ? match[1]! : null;
}

/** Minimal repository surface the legacy-cookie migration needs (structural, so
 *  this file doesn't import WorkflowRepository and create a cycle). */
export interface LegacyCookieMigrationRepo {
  getSetting(key: string): Promise<string | null>;
  findConnectedStorageByUid(provider: string, providerUid: string): Promise<ConnectedStorage | null>;
  upsertConnectedStorage(row: UpsertConnectedStorageInput): Promise<void>;
}

const LEGACY_COOKIE_KEY = "pan115.cookie";
const LEGACY_COOKIE_META_KEY = "pan115.cookieMeta";

/**
 * §7 P0 migration (idempotent, startup): a pre-multi-account deployment stored
 * the single 115 cookie in the global `app_settings`. Move it into a
 * `connected_storages` row owned by the implicit default account, with directory
 * CIDs backfilled from the env the worker used to read. Re-running is a no-op
 * once the connection exists. Returns whether it created the connection.
 *
 * Single-user zero-change: the migrated cookie is byte-identical to the global
 * one, so the worker (which now resolves credentials per-account) sees the same
 * 115 session it always did.
 */
export async function migrateLegacyCookieToDefaultAccount(input: {
  repository: LegacyCookieMigrationRepo;
  env: NodeJS.ProcessEnv;
  now: string;
}): Promise<{ migrated: boolean; providerUid: string | null }> {
  const cookie = (await input.repository.getSetting(LEGACY_COOKIE_KEY))?.trim();
  if (!cookie) {
    return { migrated: false, providerUid: null };
  }
  // provider_uid keys the instance-wide UNIQUE(provider, provider_uid). Parse the
  // real 115 uid; fall back to a stable placeholder a later QR scan corrects.
  const providerUid = parsePan115Uid(cookie) ?? "pan115_default";
  const existing = await input.repository.findConnectedStorageByUid("pan115", providerUid);
  if (existing) {
    return { migrated: false, providerUid };
  }
  const metaRaw = await input.repository.getSetting(LEGACY_COOKIE_META_KEY);
  let meta: { userName?: string; app?: string; connectedAt?: string } = {};
  try {
    meta = metaRaw ? (JSON.parse(metaRaw) as typeof meta) : {};
  } catch {
    meta = {};
  }
  const env = input.env;
  await input.repository.upsertConnectedStorage({
    id: `cs_${providerUid}`,
    accountId: DEFAULT_ACCOUNT_ID,
    provider: "pan115",
    providerUid,
    label: meta.userName ?? null,
    payload: { cookie, meta },
    rootCid: env.MEDIA_TRACK_115_TEST_ROOT_CID ?? null,
    moviesCid: env.MEDIA_TRACK_MOVIES_PARENT_CID ?? null,
    tvCid: env.MEDIA_TRACK_TV_PARENT_CID ?? null,
    animeCid: env.MEDIA_TRACK_ANIME_PARENT_CID ?? null,
    createdAt: input.now,
  });
  return { migrated: true, providerUid };
}
