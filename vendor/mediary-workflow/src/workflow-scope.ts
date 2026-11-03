import { DEFAULT_ACCOUNT_ID } from "./domain.js";
import { getStorageBrand, isRegisteredStorageProvider } from "./storage-brands.js";

/** The data partition key for the multi-drive tree model: an account (identity)
 *  plus the specific connected storage (workspace). `connectedStorageId` may be
 *  null for unscoped/legacy reads — before backfill, and for the cross-(account,
 *  storage) daily patrol that must see every drive's shows. A non-null value
 *  means "only this drive" (fail-closed isolation). */
export interface WorkflowScope {
  accountId: string;
  connectedStorageId: string | null;
}

export function scopeFromAccount(
  accountId: string,
  connectedStorageId: string | null,
): WorkflowScope {
  return { accountId, connectedStorageId };
}

/** Read methods accept either a bare accountId (legacy, account-only — no storage
 *  filter) or a full WorkflowScope. `undefined` → the default account, no filter. */
export type ScopeArg = string | WorkflowScope | undefined;

export function normalizeScope(arg: ScopeArg): WorkflowScope {
  if (arg === undefined) {
    return { accountId: DEFAULT_ACCOUNT_ID, connectedStorageId: null };
  }
  if (typeof arg === "string") {
    return { accountId: arg, connectedStorageId: null };
  }
  return arg;
}

/** Thrown when a request targets a /w/<storageId> workspace the current account
 *  does not own (or that doesn't exist) — the route layer maps it to a 404. */
export class WorkspaceNotFoundError extends Error {
  constructor(storageId: string) {
    super(`Workspace not found: ${storageId}`);
    this.name = "WorkspaceNotFoundError";
  }
}

/**
 * Resolve which drive a request's workspace targets, from the account's drives:
 * - no `storageIdParam` (root route) → the earliest-created (primary) drive id,
 *   or null when the account has no drive yet (single-user fresh — root works
 *   account-only).
 * - explicit `storageIdParam` that the account owns → that id.
 * - explicit `storageIdParam` the account does NOT own → throw (→ 404).
 * Pure: takes the already-loaded drive list, so it's testable without a DB.
 */
export function pickWorkspaceStorageId(
  storages: ReadonlyArray<{ id: string; createdAt: string }>,
  storageIdParam: string | undefined,
): string | null {
  if (storageIdParam === undefined) {
    if (storages.length === 0) {
      return null;
    }
    return [...storages].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]!.id;
  }
  const owned = storages.some((storage) => storage.id === storageIdParam);
  if (!owned) {
    throw new WorkspaceNotFoundError(storageIdParam);
  }
  return storageIdParam;
}

export interface WorkspaceSwitcherItem {
  id: string;
  href: string;
  label: string;
  isActive: boolean;
  frozen: boolean;
  provider?: string | undefined;
}

/** The switcher chip's brand label, sourced from the brand registry so every
 *  brand (115 / 夸克 / 光鸭) reads correctly — not a 夸克-vs-115 ternary that
 *  mislabels a 光鸭 drive as "115". Falls back to the raw provider for an
 *  unknown / undefined provider. */
function providerLabel(provider: string | undefined): string {
  return provider !== undefined && isRegisteredStorageProvider(provider)
    ? getStorageBrand(provider).label
    : (provider ?? "网盘");
}

/**
 * Build the workspace switcher tabs (pure, testable). The earliest-created drive
 * is primary and routes to "/"; the rest route to /w/<id>. The active tab is the
 * one matching the current pathname (/w/<id>), else the primary (root and any
 * non-workspace page like /settings). Label falls back to a uid tail.
 * The caller renders nothing when fewer than 2 drives exist.
 */
export function switcherItems(
  storages: ReadonlyArray<{
    id: string;
    label: string | null;
    provider?: string;
    providerUid: string;
    createdAt: string;
    status: "active" | "frozen";
  }>,
  pathname: string,
): WorkspaceSwitcherItem[] {
  const sorted = [...storages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const activeWorkspaceId = (() => {
    const match = /^\/w\/([^/]+)/.exec(pathname);
    return match ? match[1]! : null;
  })();
  return sorted.map((storage, index) => {
    const isPrimary = index === 0;
    const href = isPrimary ? "/" : `/w/${storage.id}`;
    const isActive = activeWorkspaceId
      ? storage.id === activeWorkspaceId
      : isPrimary; // root / non-workspace page → primary is active
    return {
      id: storage.id,
      href,
      label:
        storage.label?.trim() ||
        `${providerLabel(storage.provider)} …${storage.providerUid.slice(-4)}`,
      isActive,
      frozen: storage.status === "frozen",
      provider: storage.provider,
    };
  });
}

/** True when a stored row belongs to the scope: account must match; storage only
 *  filters when the scope pins one (connectedStorageId != null). fail-closed. */
export function scopeMatches(
  scope: WorkflowScope,
  rowAccountId: string | null | undefined,
  rowStorageId: string | null | undefined,
): boolean {
  if ((rowAccountId ?? DEFAULT_ACCOUNT_ID) !== scope.accountId) {
    return false;
  }
  if (scope.connectedStorageId != null && (rowStorageId ?? null) !== scope.connectedStorageId) {
    return false;
  }
  return true;
}

/** Build a global-page link (通知/活动/设置) that carries the active drive as a
 *  `?w` query param. Primary drive is represented by `activeStorageId === undefined`
 *  → bare base (mirrors how the primary library is "/" not "/w/<id>"). */
export function globalNavHref(base: string, activeStorageId: string | undefined): string {
  return activeStorageId ? `${base}?w=${encodeURIComponent(activeStorageId)}` : base;
}

/** Resolve a global page's active workspace from its `?w` param + the account's
 *  drives. A stale/unknown `w` gracefully falls back to primary (NOT a 404 —
 *  unlike the /w/<id> route). The primary drive is canonicalized to a bare path
 *  with `activeStorageId: undefined` so its global links stay `?w`-free. */
export function resolveWorkspaceFromParam(
  storages: ReadonlyArray<{ id: string; createdAt: string }>,
  w: string | undefined,
): { connectedStorageId: string | null; basePath: string; activeStorageId: string | undefined } {
  const primaryId = pickWorkspaceStorageId(storages, undefined); // never throws (undefined param)
  const owned = w != null && storages.some((storage) => storage.id === w);
  const resolved = owned ? w! : primaryId;
  const isPrimary = resolved == null || resolved === primaryId;
  return {
    connectedStorageId: resolved,
    basePath: isPrimary ? "/" : `/w/${resolved}`,
    activeStorageId: isPrimary ? undefined : resolved!,
  };
}

/** Which top-level section a path is in — drives switcher "keep same section". */
export type WorkspaceSection =
  | "search"
  | "library"
  | "notifications"
  | "activity"
  | "settings"
  | "other";

/** Classify the current location into a section. Content routes ("/" or "/w/<id>")
 *  are search by default, library when ?tab=library. Unknown routes → "other". */
export function workspaceSection(pathname: string, tabParam: string | null): WorkspaceSection {
  if (pathname.startsWith("/notifications")) return "notifications";
  if (pathname.startsWith("/activity")) return "activity";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname === "/" || /^\/w\/[^/]+\/?$/.test(pathname)) {
    return tabParam === "library" ? "library" : "search";
  }
  return "other";
}

/** Where a drive tab should go to KEEP the current section (not always search).
 *  Content sections route to the target drive's content path (primary → "/", else
 *  "/w/<id>"); global sections carry the drive as `?w` (primary omits it). The
 *  search section's `&q=` is injected client-side from per-drive memory, so this
 *  returns the q-less base. */
export function switcherTabHref(
  section: WorkspaceSection,
  targetDriveId: string,
  primaryDriveId: string,
): string {
  const isPrimary = targetDriveId === primaryDriveId;
  const basePath = isPrimary ? "/" : `/w/${targetDriveId}`;
  const activeId = isPrimary ? undefined : targetDriveId;
  switch (section) {
    case "library":
      return `${basePath}?tab=library`;
    case "search":
      return `${basePath}?tab=search`;
    case "notifications":
      return globalNavHref("/notifications", activeId);
    case "activity":
      return globalNavHref("/activity", activeId);
    case "settings":
      return globalNavHref("/settings", activeId);
    default:
      return basePath;
  }
}

/** sessionStorage key for the last search query, scoped per drive by its basePath
 *  ("/" = primary, "/w/<id>" = others) so each drive remembers its own search. */
export function lastQueryKey(basePath: string): string {
  return `media-track.lastQuery.${basePath}`;
}

/** Link to a title's detail page, carrying the originating surface (`from`) AND the
 *  active drive (`?w`). The drive is REQUIRED for correctness, not just nav: the
 *  detail page resolves the title against this drive's tracked state, and TMDB's
 *  movie/TV id namespaces collide (movie 278 ≠ tv 278) — without the drive a
 *  non-primary title falls back to the primary scope and renders an unrelated
 *  show. Primary (activeStorageId undefined) omits `?w`, matching the rest. */
export function showHref(
  tmdbId: number,
  from: "search" | "library",
  activeStorageId: string | undefined,
  type?: "movie" | "tv" | "anime",
): string {
  let href = `/show/${tmdbId}?from=${from}`;
  if (activeStorageId) {
    href += `&w=${encodeURIComponent(activeStorageId)}`;
  }
  // `t` disambiguates TMDB's separate movie/tv id namespaces for an UNTRACKED
  // title (the card knows the type; the detail page can't guess it). Tracked
  // titles resolve by DB type and ignore this.
  if (type) {
    href += `&t=${type}`;
  }
  return href;
}
