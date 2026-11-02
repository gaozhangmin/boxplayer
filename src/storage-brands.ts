/**
 * Storage brand registry — the per-(account, drive) capabilities the worker and
 * web share, keyed by `connected_storages.provider`. Replaces the old global
 * `MEDIA_TRACK_STORAGE_ADAPTER==="115"` switch: dispatch is now per-drive, so one
 * account can hold a 115 drive and a quark drive side by side (tree model).
 *
 * NOTE: `createExecutor` deliberately does NOT live here — building a protected
 * executor needs env (write-scope CIDs) + the apps/web protected wrapper, which
 * the pure workflow package must not import. apps/web owns the factory
 * (`createExecutorForBrand`); this registry holds only the pure, brand-identity
 * capabilities (uid parsing, auth-error classification, applicable resource kinds).
 */
import { parsePan115Uid } from "./account-credentials.js";
import type { ResourceType } from "./domain.js";
import { isGuangYaAuthError, parseGuangYaUid } from "./guangya-client.js";
import { isPan115AuthError } from "./pan115-cookie-client.js";
import { isPan123AuthError, parsePan123Uid } from "./pan123-client.js";
import { isQuarkAuthError, parseQuarkUid } from "./quark-cookie-client.js";
import { isTianyiAuthError, parseTianyiUid } from "./tianyi-client.js";

export type StorageProvider = "pan115" | "quark" | "guangya" | "tianyi" | "pan123";
export type ResourceProviderKind =
  | "pansou-115"
  | "pansou-quark"
  | "pansou-magnet"
  | "pansou-tianyi"
  | "pansou-123"
  | "prowlarr";

export interface StorageBrand {
  provider: StorageProvider;
  /** Display name shown in the UI (switcher chip, settings tab). */
  label: string;
  /** Extract the instance-wide-unique account id from the brand's credential —
   *  a cookie string for cookie brands (115/夸克), a JWT access token for 光鸭,
   *  the loginName for 天翼. Callers pass the brand-appropriate string, never a
   *  JSON blob (a blob would rotate with tokens and destabilize
   *  UNIQUE(provider, provider_uid)). */
  parseUid: (credential: string) => string | null;
  /** Whether an error is this brand's dead-credential signal (drives freeze on it). */
  isAuthError: (err: unknown) => boolean;
  /** Resource providers applicable to this brand. Share-link brands (夸克/天翼)
   *  have no magnet web API, so they omit "prowlarr" — magnet is 115/光鸭 only. */
  resourceProviderKinds: ResourceProviderKind[];
  /** Whether to strengthen the Chinese-subs soft default for this brand. When true,
   *  the agent prompt emphasizes that Chinese-titled resources from this drive are
   *  more likely to carry Chinese subs (these are Chinese-world drives where resources
   *  mostly come from the Chinese community). Set to false for magnet-only drives. */
  assumeChineseSubsFromChineseTitle: boolean;
  /** Credential shape: "cookie" brands (115/夸克) store a raw cookie string;
   *  "token" brands (光鸭/天翼) store a JSON token blob. workflow-runtime routes
   *  credential extraction, executor dispatch, and refresh persistence on this
   *  field — replacing the old hardcoded `provider === "guangya"` checks. */
  authKind: "cookie" | "token";
  /** Parent directory id under which connect-time provisioning creates the
   *  Mediary Scout/{Movies,TV,Anime} tree — per-brand DATA, not logic. 115 & 夸克
   *  both root at "0"; 光鸭 roots at "" (account root); 天翼 personal-cloud roots
   *  at "-11". Consumed as `provisionCategoryDirs`' baseParentId so the root is
   *  registry-driven instead of hardcoded at each provision call site. */
  provisionRootId: string;
  /** For "token" brands only: the credential-blob keys that MUST each be a
   *  non-empty string for the drive to count as connected — 光鸭 needs
   *  accessToken+refreshToken (deviceId optional, rides in the blob); 天翼 needs
   *  the sessionKey+accessToken+refreshToken trio. `extractStorageCredential`
   *  reads this instead of a per-brand `if`, returning the raw blob when every
   *  key is present (the client trims/validates the rest downstream). Undefined
   *  for cookie brands (115/夸克), which authenticate with a cookie string. */
  requiredCredentialKeys?: string[];
}

export const STORAGE_BRANDS: StorageBrand[] = [
  {
    provider: "pan115",
    label: "115 网盘",
    parseUid: parsePan115Uid,
    isAuthError: isPan115AuthError,
    resourceProviderKinds: ["pansou-115", "prowlarr"],
    assumeChineseSubsFromChineseTitle: true,
    authKind: "cookie",
    provisionRootId: "0", // 115 account root
  },
  {
    provider: "quark",
    label: "夸克网盘",
    parseUid: parseQuarkUid,
    isAuthError: isQuarkAuthError,
    resourceProviderKinds: ["pansou-quark"],
    assumeChineseSubsFromChineseTitle: true,
    authKind: "cookie",
    provisionRootId: "0", // 夸克 account root
  },
  {
    provider: "guangya",
    label: "光鸭云盘",
    parseUid: parseGuangYaUid,
    isAuthError: isGuangYaAuthError,
    resourceProviderKinds: ["pansou-magnet", "prowlarr"],
    assumeChineseSubsFromChineseTitle: false,
    authKind: "token",
    provisionRootId: "", // 光鸭 account root
    requiredCredentialKeys: ["accessToken", "refreshToken"],
  },
  {
    provider: "tianyi",
    label: "天翼云盘",
    parseUid: parseTianyiUid,
    isAuthError: isTianyiAuthError,
    resourceProviderKinds: ["pansou-tianyi"],
    assumeChineseSubsFromChineseTitle: true,
    authKind: "token",
    provisionRootId: "-11", // 天翼个人云 root folder id
    requiredCredentialKeys: ["sessionKey", "accessToken", "refreshToken"],
  },
  {
    provider: "pan123",
    label: "123网盘",
    parseUid: parsePan123Uid,
    isAuthError: isPan123AuthError,
    resourceProviderKinds: ["pansou-123"],
    assumeChineseSubsFromChineseTitle: true,
    authKind: "token",
    provisionRootId: "0", // 123 个人云根
    requiredCredentialKeys: ["token"],
  },
];

/**
 * Map a brand's resource-provider kinds to the PanSou link types its acquisitions
 * may transfer. A 夸克 drive can only save 夸克 share links; a 光鸭(磁力) drive can
 * only offline-download magnets; a 115 drive takes both 115 links and magnets.
 * Pure + brand-table-driven so the resource assembly stays testable.
 */
export function allowedResourceTypesForKinds(kinds: readonly string[]): ResourceType[] {
  if (kinds.includes("pansou-quark")) {
    return ["quark"];
  }
  if (kinds.includes("pansou-tianyi")) {
    return ["tianyi"];
  }
  if (kinds.includes("pansou-123")) {
    return ["123"];
  }
  if (kinds.includes("pansou-magnet")) {
    return ["magnet"];
  }
  return ["115", "magnet"];
}

export function getStorageBrand(provider: string): StorageBrand {
  const brand = STORAGE_BRANDS.find((b) => b.provider === provider);
  if (!brand) {
    throw new Error(`unknown storage brand: ${provider}`);
  }
  return brand;
}

/** Whether a provider string names a registered brand (used to widen the old
 *  `provider==="pan115"` filters to "any registered brand"). */
export function isRegisteredStorageProvider(provider: string): provider is StorageProvider {
  return STORAGE_BRANDS.some((b) => b.provider === provider);
}

/** Whether a brand can use Prowlarr (磁力/PT) — 115 yes, 夸克 no (no magnet API).
 *  Settings hides the Prowlarr block when no connected drive supports it. Safe on
 *  unknown providers (returns false, never throws). */
export function brandSupportsProwlarr(provider: string): boolean {
  return (
    isRegisteredStorageProvider(provider) &&
    getStorageBrand(provider).resourceProviderKinds.includes("prowlarr")
  );
}
